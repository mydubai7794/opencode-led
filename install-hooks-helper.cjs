const fs = require("fs");
const path = require("path");
const os = require("os");

const settingsPath = path.join(os.homedir(), ".claude", "settings.json");

const hookScript = path.resolve(__dirname, "claude-led-hook.mjs").replace(/\\/g, "/");
const hookCmd = 'node "' + hookScript + '"';

const events = [
  "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolBatch",
  "PermissionRequest", "Stop", "StopFailure", "SubagentStart",
  "SubagentStop", "Notification", "SessionEnd",
];

const hookEntry = {
  matcher: "",
  hooks: [{ type: "command", command: hookCmd, timeout: 5 }],
};

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
} catch {}

if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};

for (const evt of events) {
  const existing = settings.hooks[evt];
  if (!existing || !Array.isArray(existing)) {
    settings.hooks[evt] = [hookEntry];
    continue;
  }
  // Check if our hook is already configured
  const alreadyPresent = existing.some((group) =>
    group.hooks && group.hooks.some((h) => h.command && h.command.includes("claude-led-hook"))
  );
  if (!alreadyPresent) {
    existing.push(hookEntry);
  }
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log("OK: hooks configured for " + events.length + " events");
