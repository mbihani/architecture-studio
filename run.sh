#!/usr/bin/env bash
# Databricks Apps entrypoint: install deps, build frontend, then serve.
set -ex
cd "$(dirname "$0")"
echo "=== Node $(node --version) npm $(npm --version) ==="
[ -d node_modules ] || npm install
echo "=== Building ==="
npm run build
echo "=== Starting server on PORT ${PORT:-8080} ==="
NODE_ENV=production exec ./node_modules/.bin/tsx server/index.ts
