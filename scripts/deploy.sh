#!/usr/bin/env bash
# deploy.sh —— 清流一键部署：把**同一份产物**同时发到测试与生产。
#
# 为什么必须同一份：以前测试环境和生产环境各编各的，测试通过的东西上线后
# 行为不一致。这里先编译一次，再用同一个 sha256 校验两个环境，杜绝差异。
#
# 用法：
#   ./scripts/deploy.sh test    # 只发测试环境
#   ./scripts/deploy.sh prod    # 只发生产（要求测试已验证）
#   ./scripts/deploy.sh both    # 测试 + 生产（默认）
#
# 前置：本机能 ssh 到生产（~/.ssh/no996_prod_ed25519），本机有 go / pnpm。

set -euo pipefail

TARGET="${1:-both}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/no996_prod_ed25519}"
SSH_HOST="${SSH_HOST:-root@115.191.68.41}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
BIN="/tmp/qingliu-$TS.bin"
DIST="/tmp/qingliu-dist-$TS"

# 两个环境的落点
TEST_BIN=/opt/qingliu-test/qingliu
TEST_DIST=/opt/qingliu-test/frontend/dist
TEST_SVC=qingliu-test
TEST_URL=https://qingliu-test.bujiaban.top
PROD_BIN=/opt/qingliu/qingliu
PROD_DIST=/opt/qingliu/frontend/dist
PROD_SVC=qingliu
PROD_URL=https://qingliu.bujiaban.top

log() { printf '\n=== %s ===\n' "$*"; }

# ---------- 1. 编译（一次） ----------
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

# ---------- 2. 上传（一次） ----------
log "上传产物"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$BIN" "$SSH_HOST:/tmp/qingliu-bin"
rm -rf "$DIST.tmp"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST" "rm -rf /tmp/qingliu-dist && mkdir -p /tmp/qingliu-dist"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r "$DIST/." "$SSH_HOST:/tmp/qingliu-dist/"

REMOTE_SHA="$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST" 'sha256sum /tmp/qingliu-bin' | awk '{print $1}')"
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "❌ 二进制传输损坏：local=$LOCAL_SHA remote=$REMOTE_SHA" >&2
  exit 1
fi
echo "✅ 哈希一致"

# ---------- 3. 部署函数 ----------
deploy_env() {
  local name="$1" bin="$2" dist="$3" svc="$4" url="$5" health="$6"
  log "部署 $name"
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST" bash -s <<EOF
set -e
TS=$TS
# 备份现有产物（各保留最新一份）
if [ -f "$bin" ]; then cp "$bin" "$bin.bak-\$TS"; fi
if [ -d "$dist" ]; then cp -a "$dist" "$dist.bak-\$TS"; fi
systemctl stop "$svc"
cp /tmp/qingliu-bin "$bin"
chmod +x "$bin"
if id qingliu >/dev/null 2>&1; then chown qingliu:qingliu "$bin" || true; fi
rm -rf "$dist.n" && mkdir -p "$dist.n"
cp -a /tmp/qingliu-dist/. "$dist.n/"
rm -rf "$dist" && mv "$dist.n" "$dist"
if id qingliu >/dev/null 2>&1; then chown -R qingliu:qingliu "$(dirname "$dist")" || true; fi
systemctl start "$svc"
sleep 5
systemctl is-active "$svc" >/dev/null || { echo "❌ $svc 未启动"; journalctl -u "$svc" -n 15 --no-pager; exit 1; }
curl -sf -o /dev/null "$health" || { echo "❌ $name 健康检查失败"; exit 1; }
# 清理旧备份，只留最新
ls -1t "$bin".bak-* 2>/dev/null | tail -n +2 | xargs -r rm -f
ls -1dt "$dist".bak-* 2>/dev/null | tail -n +2 | xargs -r rm -rf
echo "✅ $name 已更新（备份 \$TS）"
EOF
  curl -s -o /dev/null -w "   $url → %{http_code}\n" "$url" || true
}

case "$TARGET" in
  test)
    deploy_env "TEST" "$TEST_BIN" "$TEST_DIST" "$TEST_SVC" "$TEST_URL" "http://127.0.0.1:8789/health"
    ;;
  prod)
    deploy_env "PROD" "$PROD_BIN" "$PROD_DIST" "$PROD_SVC" "$PROD_URL" "http://127.0.0.1:8787/health"
    ;;
  both|*)
    deploy_env "TEST" "$TEST_BIN" "$TEST_DIST" "$TEST_SVC" "$TEST_URL" "http://127.0.0.1:8789/health"
    deploy_env "PROD" "$PROD_BIN" "$PROD_DIST" "$PROD_SVC" "$PROD_URL" "http://127.0.0.1:8787/health"
    ;;
esac

# ---------- 4. 收尾：确认两环境版本一致 ----------
log "版本核对"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_HOST" \
  "sha256sum $TEST_BIN $PROD_BIN 2>/dev/null || true; rm -f /tmp/qingliu-bin; rm -rf /tmp/qingliu-dist"

rm -f "$BIN"
echo
echo "完成。测试：$TEST_URL  生产：$PROD_URL"
