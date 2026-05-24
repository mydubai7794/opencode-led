import http from "node:http";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PID_FILE = path.join(os.tmpdir(), "claude-led-daemon.pid");
const PORT_FILE = path.join(os.tmpdir(), "claude-led-daemon.port");
const DEFAULT_PORT = 4578;

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

function getPort() {
  try {
    return parseInt(fs.readFileSync(PORT_FILE, "utf-8").trim(), 10) || DEFAULT_PORT;
  } catch { return DEFAULT_PORT; }
}

function postEvent(port, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/event",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 2000,
    }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

function startDaemon() {
  const daemonPath = path.join(__dirname, "claude-led-daemon.mjs");
  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  let payload;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    payload = JSON.parse(Buffer.concat(chunks).toString());
  } catch { return; }

  const { hook_event_name: hookEvent, session_id, tool_name, stop_reason } = payload;
  if (!hookEvent) return;

  const ledState = STATE_MAP[hookEvent];
  if (!ledState) return;

  const port = getPort();
  const data = {
    hook_event: hookEvent,
    session_id: session_id || "unknown",
    detail: tool_name ? `${hookEvent}:${tool_name}` : hookEvent,
    cwd: process.cwd(),
  };

  try {
    await postEvent(port, data);
  } catch (e) {
    if (e.code === "ECONNREFUSED") {
      startDaemon();
      await sleep(800);
      const newPort = getPort();
      try { await postEvent(newPort, data); } catch {}
    }
  }
}

main();
