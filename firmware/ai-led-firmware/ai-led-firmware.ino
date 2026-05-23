#define LED_PIN 8
#define NUM_PIXELS 3
#define BUTTON_PIN 9
#define BUTTON_ENABLED false
#define EEPROM_SIZE 512
#define CONFIG_VALID 0xA5
#define MSG_TIMEOUT 180000

#include <WiFi.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <Adafruit_NeoPixel.h>
#include <EEPROM.h>
#include <ArduinoJson.h>

Adafruit_NeoPixel strip(NUM_PIXELS, LED_PIN, NEO_GRB + NEO_KHZ800);
WebServer server(80);
WiFiClient espClient;
PubSubClient mqtt(espClient);
DNSServer dnsServer;

struct Config {
  char valid;
  char ssid[33];
  char password[65];
  char broker[65];
  int brokerPort;
  char mqttUser[33];
  char mqttPass[65];
};

Config cfg;
char currentState[20] = "idle";
unsigned long lastMsgTime = 0;
bool apMode = false;
bool buttonPressed = false;

const char portalHTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head>
<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>AI LED</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#16213e;border-radius:16px;padding:32px;width:90%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.3)}
h1{text-align:center;font-size:24px;margin-bottom:8px}
.sub{text-align:center;color:#888;margin-bottom:24px}
.field{margin-bottom:16px}
label{display:block;font-size:13px;color:#aaa;margin-bottom:4px}
input{width:100%;padding:12px;border:1px solid #333;border-radius:8px;background:#0f0f23;color:#fff;font-size:16px;outline:none}
input:focus{border-color:#4fc3f7}
button{width:100%;padding:14px;border:none;border-radius:8px;background:linear-gradient(135deg,#4fc3f7,#2196f3);color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-top:8px}
button:active{opacity:.8}
.status{text-align:center;margin-top:16px;padding:12px;border-radius:8px;display:none}
.ok{display:block;background:#1b5e20;color:#a5d6a7}
.fail{display:block;background:#b71c1c;color:#ef9a9a}
.hint{color:#666;font-size:12px;margin-top:4px}
</style>
</head><body>
<div class='card'>
<h1>&#x1F4A1; AI LED</h1>
<p class='sub'>WiFi &amp; MQTT</p>
<form onsubmit='return save(event)'>
<div class='field'><label>WiFi</label><input id='ssid' placeholder='SSID' required></div>
<div class='field'><label>Password</label><input id='pass' type='password' placeholder='password'></div>
<div class='field'><label>MQTT Broker</label><input id='broker' placeholder='192.168.1.100' required><p class='hint'>broker.js IP</p></div>
<div class='field'><label>Port</label><input id='port' value='1883' required></div>
<div class='field'><label>MQTT User</label><input id='mqttuser' placeholder='(optional)'></div>
<div class='field'><label>MQTT Password</label><input id='mqttpass' type='password' placeholder='(optional)'></div>
<button type='submit'>Save</button>
</form>
<div id='status' class='status'></div>
</div>
<script>
async function save(e){
e.preventDefault();
const s=document.getElementById('status');
s.className='status';s.textContent='...';s.style.display='block';
const body=new URLSearchParams({ssid:document.getElementById('ssid').value,pass:document.getElementById('pass').value,broker:document.getElementById('broker').value,port:document.getElementById('port').value,mqttuser:document.getElementById('mqttuser').value,mqttpass:document.getElementById('mqttpass').value});
try{
const r=await fetch('/save',{method:'POST',body:body});
const j=await r.json();
if(j.ok){s.className='status ok';s.textContent='OK! Rebooting...';}
else{s.className='status fail';s.textContent='Error: '+j.error;}
}catch(ex){s.className='status fail';s.textContent='Failed';}
}
</script>
</body></html>
)rawliteral";

void loadConfig() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.get(0, cfg);
  EEPROM.end();
  if (cfg.valid != CONFIG_VALID || cfg.ssid[0] == 0 || cfg.ssid[0] == 0xFF) {
    memset(&cfg, 0, sizeof(cfg));
  }
}

void saveConfig() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.put(0, cfg);
  EEPROM.commit();
  EEPROM.end();
}

void clearConfig() {
  memset(&cfg, 0, sizeof(cfg));
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.put(0, cfg);
  EEPROM.commit();
  EEPROM.end();
}

void setAllPixels(uint8_t r, uint8_t g, uint8_t b) {
  for (int i = 0; i < NUM_PIXELS; i++) {
    strip.setPixelColor(i, strip.Color(r, g, b));
  }
}

void solidLED(uint8_t r, uint8_t g, uint8_t b) {
  setAllPixels(r, g, b);
  strip.show();
}

void breathLED(uint8_t r, uint8_t g, uint8_t b, unsigned long period) {
  float t = (float)(millis() % period) / period;
  float brightness = (sin(t * 2 * PI) + 1) / 2;
  setAllPixels((uint8_t)(r * brightness), (uint8_t)(g * brightness), (uint8_t)(b * brightness));
  strip.show();
}

void blinkLED(uint8_t r, uint8_t g, uint8_t b, unsigned long period) {
  bool on = (millis() % period) < (period / 2);
  if (on) solidLED(r, g, b);
  else { setAllPixels(0, 0, 0); strip.show(); }
}

void marqueeLED(uint8_t r, uint8_t g, uint8_t b, unsigned long period) {
  unsigned long phase = millis() % period;
  float angle = ((float)phase / period) * 2 * PI;
  for (int i = 0; i < NUM_PIXELS; i++) {
    float a = angle + (float)i * (2 * PI / NUM_PIXELS);
    float brightness = (sin(a) + 1) / 2;
    float br = brightness * brightness;
    strip.setPixelColor(i, strip.Color((uint8_t)(r * br), (uint8_t)(g * br), (uint8_t)(b * br)));
  }
  strip.show();
}

void updateLED() {
  if (strcmp(currentState, "thinking") == 0) {
    marqueeLED(255, 200, 0, 800);
  } else if (strcmp(currentState, "auth_required") == 0) {
    solidLED(255, 0, 0);
  } else if (strcmp(currentState, "done") == 0) {
    solidLED(0, 255, 0);
  } else if (strcmp(currentState, "idle") == 0) {
    breathLED(0, 100, 255, 2000);
  } else if (strcmp(currentState, "error") == 0) {
    blinkLED(255, 0, 0, 1600);
  } else if (strcmp(currentState, "config") == 0) {
    breathLED(128, 0, 255, 800);
  } else if (strcmp(currentState, "off") == 0) {
    setAllPixels(0, 0, 0);
    strip.show();
  } else {
    solidLED(0, 0, 0);
  }
}

void setState(const char* state) {
  if (strcmp(currentState, state) != 0) {
    strncpy(currentState, state, sizeof(currentState) - 1);
    currentState[sizeof(currentState) - 1] = 0;
    lastMsgTime = millis();
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  char buf[128];
  int len = length < 127 ? length : 127;
  memcpy(buf, payload, len);
  buf[len] = 0;

  StaticJsonDocument<128> doc;
  DeserializationError err = deserializeJson(doc, buf);
  if (err) return;

  const char* state = doc["state"];
  if (state) setState(state);
}

void reconnectMQTT() {
  int attempts = 0;
  while (!mqtt.connected() && attempts < 3) {
    String clientId = "ai-led-" + String(random(0xffff), HEX);
    bool ok;
    if (cfg.mqttUser[0]) {
      ok = mqtt.connect(clientId.c_str(), cfg.mqttUser, cfg.mqttPass);
    } else {
      ok = mqtt.connect(clientId.c_str());
    }
    if (ok) {
      mqtt.subscribe("ai-led/state", 1);
    } else {
      delay(2000);
    }
    attempts++;
  }
  if (!mqtt.connected()) {
    setState("error");
  }
}

bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.ssid, cfg.password);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    updateLED();
  }
  return WiFi.status() == WL_CONNECTED;
}

void startAP() {
  apMode = true;
  WiFi.mode(WIFI_AP);
  String apName = "AI-LED-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  WiFi.softAP(apName.c_str());
  setState("config");

  server.on("/", HTTP_GET, []() {
    server.send_P(200, "text/html", portalHTML);
  });

  server.on("/save", HTTP_POST, []() {
    String ssid = server.arg("ssid");
    String pass = server.arg("pass");
    String broker = server.arg("broker");
    int port = server.arg("port").toInt();
    String mqttuser = server.arg("mqttuser");
    String mqttpass = server.arg("mqttpass");

    strncpy(cfg.ssid, ssid.c_str(), sizeof(cfg.ssid) - 1);
    cfg.ssid[sizeof(cfg.ssid) - 1] = 0;
    strncpy(cfg.password, pass.c_str(), sizeof(cfg.password) - 1);
    cfg.password[sizeof(cfg.password) - 1] = 0;
    strncpy(cfg.broker, broker.c_str(), sizeof(cfg.broker) - 1);
    cfg.broker[sizeof(cfg.broker) - 1] = 0;
    strncpy(cfg.mqttUser, mqttuser.c_str(), sizeof(cfg.mqttUser) - 1);
    cfg.mqttUser[sizeof(cfg.mqttUser) - 1] = 0;
    strncpy(cfg.mqttPass, mqttpass.c_str(), sizeof(cfg.mqttPass) - 1);
    cfg.mqttPass[sizeof(cfg.mqttPass) - 1] = 0;
    cfg.brokerPort = port ? port : 1883;
    cfg.valid = CONFIG_VALID;
    saveConfig();

    server.send(200, "application/json", "{\"ok\":true}");
    delay(500);
    ESP.restart();
  });

  server.onNotFound([]() {
    server.sendHeader("Location", "http://" + WiFi.softAPIP().toString());
    server.send(302);
  });

  dnsServer.start(53, "*", WiFi.softAPIP());
  server.begin();
}

void setup() {
  Serial.begin(115200);
  delay(100);
  strip.begin();
  strip.setBrightness(40);
  strip.show();
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  delay(200);

  loadConfig();

  Serial.printf("[AI-LED] cfg.valid=0x%02X ssid='%s' broker='%s'\n", cfg.valid, cfg.ssid, cfg.broker);

  if (cfg.valid != CONFIG_VALID || strlen(cfg.ssid) == 0) {
    Serial.println("[AI-LED] No valid config, starting AP mode");
    startAP();
    return;
  }

  Serial.println("[AI-LED] Connecting WiFi...");
  if (!connectWiFi()) {
    Serial.println("[AI-LED] WiFi failed, starting AP mode");
    startAP();
    return;
  }

  Serial.println("[AI-LED] WiFi connected, connecting MQTT...");
  mqtt.setServer(cfg.broker, cfg.brokerPort);
  mqtt.setCallback(mqttCallback);
  mqtt.setKeepAlive(10);
  reconnectMQTT();
}

String serialBuf;

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuf.length() > 0) {
        serialBuf.trim();
        if (serialBuf == "RESET") {
          Serial.println("[AI-LED] Serial RESET command, clearing config");
          clearConfig();
          delay(100);
          ESP.restart();
        }
        serialBuf = "";
      }
    } else {
      serialBuf += c;
    }
  }
}

void loop() {
  handleSerial();

  if (BUTTON_ENABLED && digitalRead(BUTTON_PIN) == LOW && !buttonPressed) {
    delay(100);
    if (digitalRead(BUTTON_PIN) == LOW) {
      buttonPressed = true;
      delay(2000);
      if (digitalRead(BUTTON_PIN) == LOW) {
        Serial.println("[AI-LED] Button long-press, clearing config");
        clearConfig();
        delay(100);
        ESP.restart();
      }
      buttonPressed = false;
    }
  }

  if (apMode) {
    server.handleClient();
    dnsServer.processNextRequest();
    updateLED();
    return;
  }

  if (!mqtt.connected()) {
    reconnectMQTT();
  }
  mqtt.loop();
  if (lastMsgTime > 0 && millis() - lastMsgTime > MSG_TIMEOUT && strcmp(currentState, "off") != 0) {
    setState("off");
    Serial.println("[AI-LED] No MQTT message for 3min, LED off");
  }
  updateLED();
}
