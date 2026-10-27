#!/bin/bash
# Start Ollama, make sure the configured model is present, then keep serving.
set -e
ollama serve &
SERVER_PID=$!
for _ in $(seq 1 60); do
  ollama list >/dev/null 2>&1 && break
  sleep 1
done
MODEL="${OFRENDA_MODEL:-gemma3:1b}"
echo "Ensuring model ${MODEL} is available..."
ollama pull "${MODEL}"
wait $SERVER_PID
