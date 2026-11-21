#!/usr/bin/env bash
# deploy.sh —— 清流生产部署。
#
# 清流只有**一套生产环境**（qingliu.bujiaban.top）。
# 测试环境不在清流侧：AI 与解析能力的测试走不加班后端（no996 AI）。
#
# 用法：
#   ./scripts/deploy.sh
#
# 前置：本机能 ssh 到生产（~/.ssh/no996_prod_ed25519），本机有 go / pnpm。

set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/no996_prod_ed25519}"
SSH_HOST="${SSH_HOST:-root@115.191.68.41}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
BIN="/tmp/qingliu-$TS.bin"
DIST="/tmp/qingliu-dist-$TS"

PROD_BIN=/opt/qingliu/qingliu
PROD_DIST=/opt/qingliu/frontend/dist
PROD_SVC=qingliu
PROD_URL=https://qingliu.bujiaban.top

log() { printf '\n=== %s ===\n' "$*"; }

# ---------- 1. 编译 ----------
log "编译 linux/amd64"
cd "$ROOT/server"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags="-s -w" -o "$BIN" .

log "构建前端"
cd "$ROOT/frontend"
pnpm build >/dev/null
rm -rf "$DIST" && mkdir -p "$DIST"
cp -a "$ROOT/frontend/dist/." "$DIST/"

LOCAL_SHA="$(sha256sum "$BIN" | awk '{print $1}')"
echo "binary sha256 = $LOCAL_SHA"

# ---------- 2. 上传并校验 ----------
log "上传产物"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$BIN" "$SSH_HOST:/tmp/qingliu-bin"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST" "rm -rf /tmp/qingliu-dist && mkdir -p /tmp/qingliu-dist"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r "$DIST/." "$SSH_HOST:/tmp/qingliu-dist/"

REMOTE_SHA="$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST" 'sha256sum /tmp/qingliu-bin' | awk '{print $1}')"
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "❌ 二进制传输损坏：local=$LOCAL_SHA remote=$REMOTE_SHA" >&2
  exit 1
fi
echo "✅ 哈希一致"

# ---------- 3. 部署 ----------
log "部署生产"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST" bash -s <<EOF
set -e
TS=$TS
if [ -f "$PROD_BIN" ]; then cp "$PROD_BIN" "$PROD_BIN.bak-\$TS"; fi
if [ -d "$PROD_DIST" ]; then cp -a "$PROD_DIST" "$PROD_DIST.bak-\$TS"; fi
systemctl stop "$PROD_SVC"
cp /tmp/qingliu-bin "$PROD_BIN"
chmod +x "$PROD_BIN"
if id qingliu >/dev/null 2>&1; then chown qingliu:qingliu "$PROD_BIN" || true; fi
rm -rf "$PROD_DIST.n" && mkdir -p "$PROD_DIST.n"
cp -a /tmp/qingliu-dist/. "$PROD_DIST.n/"
rm -rf "$PROD_DIST" && mv "$PROD_DIST.n" "$PROD_DIST"
if id qingliu >/dev/null 2>&1; then chown -R qingliu:qingliu "$(dirname "$PROD_DIST")" || true; fi
systemctl start "$PROD_SVC"
sleep 5
systemctl is-active "$PROD_SVC" >/dev/null || { echo "❌ 服务未启动"; journalctl -u "$PROD_SVC" -n 20 --no-pager; exit 1; }
curl -sf -o /dev/null http://127.0.0.1:8787/health || { echo "❌ 健康检查失败"; exit 1; }
# 只保留最新一份备份
ls -1t "$PROD_BIN".bak-* 2>/dev/null | tail -n +2 | xargs -r rm -f
ls -1dt "$PROD_DIST".bak-* 2>/dev/null | tail -n +2 | xargs -r rm -rf
echo "✅ 已更新（备份 \$TS）"
EOF

curl -s -o /dev/null -w "$PROD_URL → %{http_code}\n" "$PROD_URL" || true

# ---------- 4. 收尾 ----------
log "版本核对"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST" \
  "sha256sum $PROD_BIN; rm -f /tmp/qingliu-bin; rm -rf /tmp/qingliu-dist"

rm -f "$BIN"
echo
echo "完成。$PROD_URL"
