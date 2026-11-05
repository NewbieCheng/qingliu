#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  echo '请先 cp .env.example .env，填写现有 MySQL 连接、域名和随机密钥。' >&2
  exit 1
fi
chmod 600 .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
