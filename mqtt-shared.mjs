import mqtt from "mqtt";
import aedes from "aedes";
import { createServer } from "net";
import fs from "fs";
import path from "path";
import os from "os";

export const TOPIC = "ai-led/state";
export const PROJECT_TOPIC = "ai-led/project";
export const PRIORITY = { error: 10, auth_required: 8, thinking: 5, done: 3, idle: 0 };
export const BROKER_PORT = 1883;

export function loadMqttConfig() {
  const configPaths = [
    path.join(process.cwd(), "mqtt-config.json"),
    path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "mqtt-config.json"),
  ];
  for (const p of configPaths) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      return JSON.parse(raw);
    } catch {}
  }
  return { mode: "local", local: { host: "127.0.0.1", port: 1883 } };
}

export function getBrokerUrl(config) {
  const isRemote = config.mode === "remote";
  const cfg = isRemote ? config.remote : config.local;
  return `mqtt://${cfg.host}:${cfg.port}`;
}

export function getMqttOptions(config, clientIdPrefix) {
  const isRemote = config.mode === "remote";
  const base = {
    clientId: clientIdPrefix + "-" + process.pid,
    reconnectPeriod: 3000,
    connectTimeout: 5000,
  };
  if (isRemote && config.remote.username) {
    base.username = config.remote.username;
    base.password = config.remote.password;
  }
  return base;
}

export function startEmbeddedBroker() {
  const config = loadMqttConfig();
  if (config.mode === "remote") return Promise.resolve(false);
  return new Promise((resolve) => {
    const broker = aedes();
    const server = createServer(broker.handle);
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") resolve(false);
    });
    server.listen(BROKER_PORT, () => resolve(server));
  });
}

export function connectMqtt(config, clientIdPrefix) {
  return mqtt.connect(getBrokerUrl(config), getMqttOptions(config, clientIdPrefix));
}

export function computeWinner(stateMap) {
  let best = null;
  let bestPriority = -1;
  for (const [id, info] of stateMap) {
    const p = PRIORITY[info.state] ?? 0;
    if (p > bestPriority) {
      bestPriority = p;
      best = { id, state: info.state };
    }
  }
  return best;
}

export function createLogger(logFile) {
  const file = logFile || path.join(os.tmpdir(), "ai-led-shared.log");
  return (line) => {
    try {
      fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
    } catch {}
  };
}
