#!/bin/bash

BROKER_PID=$(cat /tmp/ai-led-broker.pid 2>/dev/null)
SUB_PID=$(cat /tmp/ai-led-subscriber.pid 2>/dev/null)

[ -n "$BROKER_PID" ] && kill "$BROKER_PID" 2>/dev/null && echo "Broker 已停止 (PID: $BROKER_PID)" || echo "Broker 未运行"
[ -n "$SUB_PID" ] && kill "$SUB_PID" 2>/dev/null && echo "Subscriber 已停止 (PID: $SUB_PID)" || echo "Subscriber 未运行"
rm -f /tmp/ai-led-broker.pid /tmp/ai-led-subscriber.pid
