import http from "node:http";
import fs from "fs";
import path from "path";
import os from "os";
import {
  TOPIC, PROJECT_TOPIC, PRIORITY, BROKER_PORT,
  loadMqttConfig, startEmbeddedBroker, connectMqtt, computeWinner, createLogger,
} from "./mqtt-shared.mjs";

const PREFER_PORT = parseInt(process.env.CLAUDE_LED_PORT || "4578", 10);
const PID_FILE = path.join(os.tmpdir(), "claude-led-daemon.pid");
const PORT_FILE = path.join(os.tmpdir(), "claude-led-daemon.port");
const LOG_FILE = path.join(os.tmpdir(), "claude-led-daemon.log");
const DONE_TIMEOUT = 10_000;
const DEBOUNCE_MS = 300;
const ERROR_TIMEOUT = 30_000;
const SESSION_TTL = 300_000;
const PORT_MAX_ATTEMPTS = 20;
const PENDING_DONE_MS = 1000;
const SUPPRESS_MS = 3000;

const STATE_MAP = {
  UserPromptSubmit: "thinking",
  PreToolUse: "thinking",
  PostToolUse: "thinking",
  PostToolBatch: "thinking",
  PermissionRequest: "auth_required",
  SubagentStart: "thinking",
  SubagentStop: "thinking",
  Notification: "thinking",
  Stop: "done",
  StopFailure: "error",
  SessionEnd: "_cleanup",
};

const log = createLogger(LOG_FILE);
const sessionStates = new Map();
const doneTimers = new Map();
const errorTimers = new Map();
const pendingDoneTimers = new Map();
const suppressUntil = new Map();

let mqttClient = null;
let brokerServer = null;
let lastWinnerState = "";
let httpServer = null;
let actualPort = 0;

// --- PID / port file management ---

function isProcessAlive(pid) {
  try { return process.kill(pid, 0); } catch { return false; }
}

function checkExistingInstance() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (pid && isProcessAlive(pid)) {
      console.error(`Daemon already running (PID ${pid}). Exiting.`);
      process.exit(0);
    }
    log(`Stale PID file found (PID ${pid} dead), cleaning up`);
    fs.unlinkSync(PID_FILE);
    try { fs.unlinkSync(PORT_FILE); } catch {}
  } catch {}
}

function writePidAndPort() {
  fs.writeFileSync(PID_FILE, String(process.pid));
  fs.writeFileSync(PORT_FILE, String(actualPort));
}

function cleanPidAndPort() {
  try { fs.unlinkSync(PID_FILE); } catch {}
  try { fs.unlinkSync(PORT_FILE); } catch {}
}

// --- MQTT ---

function getClient() {
  if (!mqttClient || mqttClient.disconnected || mqttClient.closed) {
    const config = loadMqttConfig();
    mqttClient = connectMqtt(config, "claude-led-daemon");
    mqttClient.on("error", (e) => log("MQTT error: " + e.message));
    mqttClient.on("connect", () => {
      log("MQTT connected");
      mqttClient.subscribe(PROJECT_TOPIC, { qos: 1 }, (err) => {
        if (err) log("Subscribe failed: " + err.message);
      });
    });
    mqttClient.on("message", (topic, message) => {
      if (topic === PROJECT_TOPIC) handleCoordinationMessage(message);
    });
  }
  return mqttClient;
}

function handleCoordinationMessage(message) {
  try {
    const data = JSON.parse(message.toString());
    if (!data.project || !data.state) return;
    if (data.project.startsWith("claude:")) return;
    sessionStates.set(data.project, { state: data.state, ts: data.ts, external: true });
    resolveWinner();
  } catch (e) {
    log("coordination parse error: " + e.message);
  }
}

// --- State management ---

function publish(topic, payload) {
  const c = getClient();
  if (c && c.connected) {
    c.publish(topic, JSON.stringify(payload), { qos: 1 });
  }
}

function publishSession(sessionId, state, detail) {
  publish(PROJECT_TOPIC, {
    state, ts: Date.now(), detail, project: "claude:" + sessionId,
  });
  log(`[session:${sessionId}] state=${state} detail=${detail}`);
}

function resolveWinner() {
  const winner = computeWinner(sessionStates);
  if (winner && winner.state !== lastWinnerState) {
    lastWinnerState = winner.state;
    publish(TOPIC, { state: winner.state, ts: Date.now(), source: winner.id });
    log(`[coordinator] winner=${winner.state} from=${winner.id}`);
  }
}

function cleanupSession(sessionId) {
  sessionStates.delete(sessionId);
  clearTimeout(doneTimers.get(sessionId));
  clearTimeout(errorTimers.get(sessionId));
  clearTimeout(pendingDoneTimers.get(sessionId));
  doneTimers.delete(sessionId);
  errorTimers.delete(sessionId);
  pendingDoneTimers.delete(sessionId);
  suppressUntil.delete(sessionId);
  resolveWinner();
  log(`[session:${sessionId}] cleaned up`);
}

function cancelPendingDone(sessionId) {
  clearTimeout(pendingDoneTimers.get(sessionId));
  pendingDoneTimers.delete(sessionId);
}

function activateSession(sessionId, eventDetail) {
  if (Date.now() < (suppressUntil.get(sessionId) || 0)) {
    log(`[suppressed] ${eventDetail}`);
    return false;
  }
  cancelPendingDone(sessionId);
  clearTimeout(doneTimers.get(sessionId));
  suppressUntil.delete(sessionId);
  return true;
}

function markThinking(sessionId, eventDetail) {
  if (Date.now() < (suppressUntil.get(sessionId) || 0)) {
    log(`[suppressed] ${eventDetail}`);
    return;
  }
  cancelPendingDone(sessionId);
  clearTimeout(doneTimers.get(sessionId));

  const prev = sessionStates.get(sessionId);
  if (prev && prev.state === "thinking" && Date.now() - prev.lastPublish < DEBOUNCE_MS) {
    prev.ts = Date.now();
    return;
  }

  sessionStates.set(sessionId, {
    state: "thinking",
    ts: Date.now(),
    lastPublish: Date.now(),
    detail: eventDetail,
  });
  publishSession(sessionId, "thinking", eventDetail);
  resolveWinner();
}

function handleEvent(data) {
  const { hook_event, session_id, detail, tool_name, stop_reason } = data;
  if (!session_id || !hook_event) return;

  const ledState = STATE_MAP[hook_event];
  if (!ledState) return;

  if (ledState === "_cleanup") {
    cleanupSession(session_id);
    return;
  }

  const eventDetail = detail || hook_event;

  switch (hook_event) {
    case "UserPromptSubmit":
      if (!activateSession(session_id, eventDetail)) break;
      markThinking(session_id, eventDetail);
      break;

    case "PreToolUse":
      if (!activateSession(session_id, eventDetail)) break;
      sessionStates.set(session_id, {
        state: "thinking",
        ts: Date.now(),
        lastPublish: Date.now(),
        detail: eventDetail,
      });
      publishSession(session_id, "thinking", eventDetail);
      resolveWinner();
      break;

    case "PostToolUse":
    case "PostToolBatch":
    case "SubagentStart":
    case "SubagentStop":
    case "Notification":
      markThinking(session_id, eventDetail);
      break;

    case "PermissionRequest":
      if (!activateSession(session_id, eventDetail)) break;
      clearTimeout(doneTimers.get(session_id));
      sessionStates.set(session_id, {
        state: "auth_required",
        ts: Date.now(),
        lastPublish: Date.now(),
        detail: eventDetail,
      });
      publishSession(session_id, "auth_required", eventDetail);
      resolveWinner();
      break;

    case "Stop": {
      const prev = sessionStates.get(session_id);
      if (!prev) break;
      cancelPendingDone(session_id);
      clearTimeout(doneTimers.get(session_id));
      suppressUntil.set(session_id, Date.now() + SUPPRESS_MS);
      pendingDoneTimers.set(session_id, setTimeout(() => {
        pendingDoneTimers.delete(session_id);
        sessionStates.set(session_id, {
          state: "done",
          ts: Date.now(),
          lastPublish: Date.now(),
          detail: eventDetail,
        });
        publishSession(session_id, "done", eventDetail);
        resolveWinner();
        doneTimers.set(session_id, setTimeout(() => {
          doneTimers.delete(session_id);
          const s = sessionStates.get(session_id);
          if (s && s.state === "done") {
            sessionStates.set(session_id, { ...s, state: "idle", ts: Date.now() });
            publishSession(session_id, "idle", "done→idle timeout");
            resolveWinner();
          }
        }, DONE_TIMEOUT));
      }, PENDING_DONE_MS));
      break;
    }

    case "StopFailure":
      cancelPendingDone(session_id);
      clearTimeout(doneTimers.get(session_id));
      suppressUntil.delete(session_id);
      sessionStates.set(session_id, {
        state: "error",
        ts: Date.now(),
        lastPublish: Date.now(),
        detail: eventDetail,
      });
      publishSession(session_id, "error", eventDetail);
      resolveWinner();
      errorTimers.set(session_id, setTimeout(() => {
        errorTimers.delete(session_id);
        const s = sessionStates.get(session_id);
        if (s && s.state === "error") {
          sessionStates.set(session_id, { ...s, state: "idle", ts: Date.now() });
          publishSession(session_id, "idle", "error→idle timeout");
          resolveWinner();
        }
      }, ERROR_TIMEOUT));
      break;

    default:
      break;
  }
}

function pruneStaleSessions() {
  const now = Date.now();
  for (const [id, info] of sessionStates) {
    if (info.external) continue;
    if ((info.state === "idle" || info.state === "done") && now - info.ts > SESSION_TTL) {
      cleanupSession(id);
    }
  }
}

// --- HTTP server ---

function createHttpServer() {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        uptime_ms: process.uptime() * 1000 | 0,
        sessions: sessionStates.size,
        mqtt_connected: mqttClient?.connected ?? false,
        last_state: lastWinnerState || "none",
        port: actualPort,
      }));
      return;
    }

    if (req.method === "POST" && req.url === "/shutdown") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      log("Shutdown requested via HTTP");
      gracefulShutdown();
      return;
    }

    if (req.method === "POST" && req.url === "/event") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          handleEvent(data);
          const session = sessionStates.get(data.session_id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, state: session?.state || "unknown" }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });
}

function listenOnPort(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", (e) => reject(e));
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(port);
    });
  });
}

async function findFreePort(server, startPort) {
  for (let offset = 0; offset < PORT_MAX_ATTEMPTS; offset++) {
    const port = startPort + offset;
    try {
      await listenOnPort(server, port);
      return port;
    } catch (e) {
      if (e.code === "EADDRINUSE" || e.code === "EACCES") {
        log(`Port ${port} unavailable (${e.code}), trying next`);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`No available port found after ${PORT_MAX_ATTEMPTS} attempts from ${startPort}`);
}

// --- Lifecycle ---

function gracefulShutdown() {
  log("Shutting down...");
  clearInterval(pruneStaleSessions._interval);

  for (const [id, info] of sessionStates) {
    if (!info.external) publishSession(id, "idle", "daemon shutdown");
  }

  if (mqttClient) {
    mqttClient.unsubscribe(PROJECT_TOPIC);
    mqttClient.end(true);
  }
  if (brokerServer) brokerServer.close();
  if (httpServer) httpServer.close();
  cleanPidAndPort();
  log("Shutdown complete");
  process.exit(0);
}

async function main() {
  checkExistingInstance();

  const config = loadMqttConfig();
  const modeLabel = config.mode === "remote" ? "remote" : "local";
  log(`Claude LED daemon starting (mode=${modeLabel}, prefer port=${PREFER_PORT})`);

  brokerServer = await startEmbeddedBroker();
  if (brokerServer) log("Embedded MQTT broker started on " + BROKER_PORT);

  getClient();

  httpServer = createHttpServer();
  actualPort = await findFreePort(httpServer, PREFER_PORT);
  writePidAndPort();
  log(`HTTP server listening on 127.0.0.1:${actualPort}`);
  console.log(`Claude LED daemon ready on port ${actualPort}`);

  pruneStaleSessions._interval = setInterval(pruneStaleSessions, 60_000);

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
  process.on("exit", () => cleanPidAndPort());
}

main().catch((e) => {
  console.error("Daemon failed:", e.message);
  log("Fatal: " + e.message);
  process.exit(1);
});
