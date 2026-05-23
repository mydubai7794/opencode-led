#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

BROKER_PID=$(cat /tmp/ai-led-broker.pid 2>/dev/null)
SUB_PID=$(cat /tmp/ai-led-subscriber.pid 2>/dev/null)

if [ -n "$BROKER_PID" ] && kill -0 "$BROKER_PID" 2>/dev/null; then
  echo "Broker 已在运行 (PID: $BROKER_PID)"
else
  rm -f /tmp/ai-led-broker.pid /tmp/ai-led-subscriber.pid /tmp/ai-led-*.log
  node "$DIR/broker.js" > /tmp/ai-led-broker.log 2>&1 &
  sleep 1
  echo "Broker 已启动 (PID: $(cat /tmp/ai-led-broker.pid 2>/dev/null))"
fi

if [ -n "$SUB_PID" ] && kill -0 "$SUB_PID" 2>/dev/null; then
  echo "Subscriber 已在运行 (PID: $SUB_PID)"
else
  node "$DIR/subscriber.js" > /tmp/ai-led-subscriber.log 2>&1 &
  sleep 1
  echo "Subscriber 已启动 (PID: $(cat /tmp/ai-led-subscriber.pid 2>/dev/null))"
fi

echo ""
echo "=== 服务就绪 ==="
echo "Broker log: /tmp/ai-led-broker.log"
echo "Subscriber log: /tmp/ai-led-subscriber.log"
echo "Event log: /tmp/ai-led-events.log"
