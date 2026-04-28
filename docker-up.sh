#!/bin/bash
set -e

echo "Building and starting containers..."
docker compose up -d --build

echo "Waiting for Ollama to be ready..."
until docker compose exec ollama ollama list &>/dev/null; do
  sleep 2
done

MODEL=$(grep OLLAMA_MODEL .env | cut -d= -f2 | tr -d '[:space:]')
MODEL=${MODEL:-qwen2.5:3b}

echo "Pulling Ollama model: $MODEL"
docker compose exec ollama ollama pull "$MODEL"

echo ""
echo "All services running:"
docker compose ps
echo ""
echo "App → http://localhost:3001"
