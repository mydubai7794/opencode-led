import mqtt from "mqtt";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PID_FILE = "/tmp/ai-led-subscriber.pid";

function loadMqttConfig() {
  const configPaths = [
    path.join(__dirname, "mqtt-config.json"),
    path.join(process.cwd(), "mqtt-config.json"),
  ];
  for (const p of configPaths) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      return JSON.parse(raw);
    } catch {}
  }
  return { mode: "local", local: { host: "127.0.0.1", port: 1883 } };
}

const mqttConfig = loadMqttConfig();
const isRemoteMode = mqttConfig.mode === "remote";
const cfg = isRemoteMode ? mqttConfig.remote : mqttConfig.local;
const brokerUrl = `mqtt://${cfg.host}:${cfg.port}`;

const connectOpts = {
  clientId: "ai-led-subscriber-" + Date.now(),
};
if (isRemoteMode && cfg.username) {
  connectOpts.username = cfg.username;
  connectOpts.password = cfg.password;
}

const client = mqtt.connect(brokerUrl, connectOpts);

const STATE_LABELS = {
  thinking: "\x1b[33m🟡 黄灯慢闪 (AI 思考中)\x1b[0m",
  auth_required: "\x1b[31m🔴 红灯快闪 (需要授权)\x1b[0m",
  done: "\x1b[32m🟢 绿灯常亮 (任务完成)\x1b[0m",
  idle: "\x1b[34m🔵 蓝灯呼吸 (空闲待机)\x1b[0m",
  error: "\x1b[31m🔴 红灯慢闪 (出错)\x1b[0m",
};

let msgCount = 0;

client.on("connect", () => {
  fs.writeFileSync(PID_FILE, String(process.pid));
  console.log(`[SUB] 已连接到 MQTT Broker (${isRemoteMode ? "remote" : "local"}: ${brokerUrl}), PID: ${process.pid}`);
  client.subscribe("ai-led/state", { qos: 1 }, (err) => {
    if (err) console.error("[SUB] 订阅失败:", err);
    else console.log("[SUB] 已订阅: ai-led/state，等待消息...\n");
  });
});

client.on("message", (topic, message) => {
  msgCount++;
  const data = JSON.parse(message.toString());
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false, fractionalSecondDigits: 3 });
  const label = STATE_LABELS[data.state] || data.state;
  console.log(`[#${String(msgCount).padStart(3, "0")}] ${time} | ${label}`);
  console.log(`        原始数据: ${message.toString()}\n`);
});

client.on("error", (err) => {
  console.error("[SUB] 连接错误:", err.message);
});

process.on("SIGINT", () => { fs.unlinkSync(PID_FILE); process.exit(0); });
process.on("SIGTERM", () => { fs.unlinkSync(PID_FILE); process.exit(0); });
