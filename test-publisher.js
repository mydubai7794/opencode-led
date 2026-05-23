import mqtt from "mqtt";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  clientId: "ai-led-test-publisher",
};
if (isRemoteMode && cfg.username) {
  connectOpts.username = cfg.username;
  connectOpts.password = cfg.password;
}

const client = mqtt.connect(brokerUrl, connectOpts);

const STATES = [
  { state: "thinking", delay: 1500, desc: "模拟 AI 开始思考" },
  { state: "thinking", delay: 1000, desc: "模拟 AI 继续思考（执行工具）" },
  { state: "auth_required", delay: 2000, desc: "模拟需要授权" },
  { state: "thinking", delay: 1000, desc: "模拟授权后继续" },
  { state: "done", delay: 3000, desc: "模拟任务完成" },
  { state: "idle", delay: 0, desc: "模拟空闲待机" },
];

client.on("connect", () => {
  console.log(`[TEST] 已连接 (${isRemoteMode ? "remote" : "local"}: ${brokerUrl})，开始发送测试消息...\n`);

  let totalDelay = 0;
  for (const s of STATES) {
    setTimeout(() => {
      const payload = JSON.stringify({ state: s.state, ts: Date.now() });
      client.publish("ai-led/state", payload, { qos: 1 });
      console.log(`[TEST] → ${s.desc}: ${s.state}`);
    }, totalDelay);
    totalDelay += s.delay;
  }

  setTimeout(() => {
    console.log("\n[TEST] 测试消息发送完毕，共 " + STATES.length + " 条");
    client.end();
  }, totalDelay + 500);
});

client.on("error", (err) => {
  console.error("[TEST] 连接错误:", err.message);
});
