#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -p '管理员账号: ' ADMIN_USERNAME
read -r -s -p '初始密码（10至72字节）: ' ADMIN_PASSWORD
printf '\n'
export ADMIN_USERNAME ADMIN_PASSWORD
# Password is passed through the process environment, never as a command argument.
docker compose run --rm -e ADMIN_USERNAME -e ADMIN_PASSWORD web init-admin
unset ADMIN_PASSWORD ADMIN_USERNAME
