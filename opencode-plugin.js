import mqtt from "mqtt";
import aedes from "aedes";
import { createServer } from "net";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client = null;
let brokerServer = null;
let idleTimer = null;
let doneTimer = null;
let debounceTimer = null;
let msgCount = 0;
let lastWinnerState = "";
let isSessionActive = false;
let suppressThinkingUntil = 0;
const projectStates = new Map();

const TOPIC = "ai-led/state";
const PROJECT_TOPIC = "ai-led/project";
const LOG_FILE = path.join(os.tmpdir(), "ai-led-events.log");
const DONE_TIMEOUT = 10_000;
const IDLE_TIMEOUT = 60_000;
const DEBOUNCE_MS = 300;
const SUPPRESS_MS = 2000;
const BROKER_PORT = 1883;
const PROJECT_ID = crypto.createHash("sha256").update(process.cwd()).digest("hex").slice(0, 8);

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

function getBrokerUrl() {
  const cfg = isRemoteMode ? mqttConfig.remote : mqttConfig.local;
  return `mqtt://${cfg.host}:${cfg.port}`;
}

function getMqttOptions() {
  const base = {
    clientId: "opencode-ai-led-" + process.pid,
    reconnectPeriod: 3000,
    connectTimeout: 5000,
  };
  if (isRemoteMode && mqttConfig.remote.username) {
    base.username = mqttConfig.remote.username;
    base.password = mqttConfig.remote.password;
  }
  return base;
}

const PRIORITY = { error: 10, auth_required: 8, thinking: 5, done: 3, idle: 0 };

function log(line) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

function startEmbeddedBroker() {
  if (isRemoteMode) {
    log("远程 MQTT 模式，跳过内嵌 Broker 启动");
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const broker = aedes();
    const server = createServer(broker.handle);
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        log(`端口 ${BROKER_PORT} 已被占用，降级为纯客户端模式`);
        resolve(false);
      } else {
        log(`Broker 错误: ${e.message}`);
      }
    });
    server.listen(BROKER_PORT, () => {
      brokerServer = server;
      log(`嵌入式 MQTT Broker 已启动，端口: ${BROKER_PORT}`);
      resolve(true);
    });
  });
}

function getClient() {
  if (!client || client.disconnected || client.closed) {
    const brokerUrl = getBrokerUrl();
    client = mqtt.connect(brokerUrl, getMqttOptions());
    client.on("error", (e) => log("MQTT error: " + e.message));
    client.on("connect", () => {
      log("MQTT 已连接");
      client.subscribe(PROJECT_TOPIC, { qos: 1 }, (err) => {
        if (err) log("协调订阅失败: " + err.message);
        else log("已订阅协调 topic: " + PROJECT_TOPIC);
      });
    });
  }
  return client;
}

function publishProject(state, eventDetail) {
  const payload = JSON.stringify({
    state,
    ts: Date.now(),
    seq: ++msgCount,
    detail: eventDetail,
    project: PROJECT_ID,
  });
  const c = getClient();
  c.publish(PROJECT_TOPIC, payload, { qos: 1 });
  log(`[project:${PROJECT_ID}] state=${state} event=${eventDetail}`);
}

function computeWinner() {
  let best = null;
  let bestPriority = -1;
  for (const [pid, info] of projectStates) {
    const p = PRIORITY[info.state] ?? 0;
    if (p > bestPriority) {
      bestPriority = p;
      best = { pid, state: info.state };
    }
  }
  return best;
}

function handleProjectMessage(topic, message) {
  try {
    const data = JSON.parse(message.toString());
    const pid = data.project;
    const state = data.state;
    if (!pid || !state) return;
    projectStates.set(pid, { state, ts: data.ts });
    const winner = computeWinner();
    if (winner && winner.state !== lastWinnerState) {
      lastWinnerState = winner.state;
      clearTimeout(idleTimer);
      clearTimeout(doneTimer);
      const payload = JSON.stringify({
        state: winner.state,
        ts: Date.now(),
        source: winner.pid,
      });
      const c = getClient();
      c.publish(TOPIC, payload, { qos: 1 });
      log(`[coordinator] winner=${winner.state} from=${winner.pid} total_projects=${projectStates.size}`);
      if (winner.state === "done") {
        doneTimer = setTimeout(() => {
          lastWinnerState = "idle";
          publishProject("idle", "done→idle timeout");
        }, IDLE_TIMEOUT);
      }
    }
  } catch (e) {
    log("协调消息处理错误: " + e.message);
  }
}

function markThinking(eventDetail) {
  if (Date.now() < suppressThinkingUntil) {
    log(`[suppressed] ${eventDetail}`);
    return;
  }
  clearTimeout(doneTimer);
  isSessionActive = true;
  if (debounceTimer) return;
  publishProject("thinking", eventDetail);
  debounceTimer = setTimeout(() => { debounceTimer = null; }, DEBOUNCE_MS);
}

function cleanup() {
  clearTimeout(idleTimer);
  clearTimeout(doneTimer);
  clearTimeout(debounceTimer);
  isSessionActive = false;
  if (client) {
    client.unsubscribe(PROJECT_TOPIC);
    client.end(true);
  }
  if (brokerServer) brokerServer.close();
  log("AiLedPlugin 已清理");
}

export const AiLedPlugin = async () => {
  const modeLabel = isRemoteMode ? "remote" : "local";
  const brokerUrl = getBrokerUrl();
  log(`AiLedPlugin 加载 (v7 - ${modeLabel} mode) project=${PROJECT_ID} broker=${brokerUrl}`);

  await startEmbeddedBroker();

  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });

  const c = getClient();

  c.on("message", (topic, message) => {
    if (topic === PROJECT_TOPIC) handleProjectMessage(topic, message);
  });

  publishProject("idle", "plugin loaded");

  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "message.updated":
          if (event.data?.role === "assistant") markThinking("message.updated:assistant");
          break;
        case "message.part.updated":
          markThinking("message.part.updated");
          break;
        case "message.part.delta":
          markThinking("message.part.delta");
          break;
        case "session.diff":
          markThinking("session.diff");
          break;
        case "tool.execute.before":
          clearTimeout(doneTimer);
          isSessionActive = true;
          suppressThinkingUntil = 0;
          publishProject("thinking", `tool.execute.before:${event.data?.tool || "?"}`);
          break;
        case "tool.execute.after":
          markThinking(`tool.execute.after:${event.data?.tool || "?"}`);
          break;
        case "permission.asked":
          clearTimeout(doneTimer);
          isSessionActive = true;
          suppressThinkingUntil = 0;
          publishProject("auth_required", "permission.asked");
          break;
        case "permission.replied":
          markThinking("permission.replied");
          break;
        case "question.asked":
          clearTimeout(doneTimer);
          isSessionActive = true;
          suppressThinkingUntil = 0;
          publishProject("auth_required", "question.asked");
          break;
        case "question.replied":
          markThinking("question.replied");
          break;
        case "session.idle":
          if (isSessionActive) {
            isSessionActive = false;
            clearTimeout(doneTimer);
            suppressThinkingUntil = Date.now() + SUPPRESS_MS;
            publishProject("done", "session.idle");
          }
          break;
        case "session.error":
          clearTimeout(doneTimer);
          isSessionActive = false;
          suppressThinkingUntil = 0;
          publishProject("error", "session.error");
          break;
        case "session.status":
          clearTimeout(idleTimer);
          clearTimeout(doneTimer);
          doneTimer = setTimeout(() => {
            if (isSessionActive) {
              isSessionActive = false;
              publishProject("done", "no-event timeout");
            }
          }, DONE_TIMEOUT);
          break;
        default:
          log(`event: ${event.type}`);
          break;
      }
    },
  };
};
