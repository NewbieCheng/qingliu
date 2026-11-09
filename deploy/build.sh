#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Build on a developer machine/CI, not the shared 4GB production server.
(cd frontend && pnpm install --frozen-lockfile && pnpm build)
mkdir -p bin
(cd server && go test ./... && go vet ./...)
for arch in amd64 arm64; do
  (cd server && CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -ldflags='-s -w' -o "../bin/qingliu-$arch" .)
done
