import aedes from "aedes";
import { createServer } from "net";
import fs from "fs";

const PORT = 1883;
const PID_FILE = "/tmp/ai-led-broker.pid";
const broker = aedes();
const server = createServer(broker.handle);

broker.on("clientReady", (client) => {
  console.log(`[BROKER] 客户端已连接: ${client.id}`);
});

broker.on("clientDisconnect", (client) => {
  console.log(`[BROKER] 客户端断开: ${client.id}`);
});

broker.on("publish", (packet, client) => {
  if (client && packet.topic === "ai-led/state") {
    const msg = packet.payload.toString();
    console.log(`[BROKER] 消息转发: ${packet.topic} → ${msg}`);
  }
});

server.listen(PORT, () => {
  fs.writeFileSync(PID_FILE, String(process.pid));
  console.log(`[BROKER] MQTT Broker 已启动，端口: ${PORT}, PID: ${process.pid}`);
  console.log(`[BROKER] 等待客户端连接...`);
});

process.on("SIGINT", () => {
  fs.unlinkSync(PID_FILE);
  process.exit(0);
});
process.on("SIGTERM", () => {
  fs.unlinkSync(PID_FILE);
  process.exit(0);
});
