#!/usr/bin/env bash
# Databricks Apps entrypoint: install deps, serve Amr extension HTML.
# The Amr extension is a self-contained HTML file — no Vite build needed.
set -ex
cd "$(dirname "$0")"
echo "=== Node $(node --version) npm $(npm --version) ==="
[ -d node_modules ] || npm install
echo "=== Serving Amr extension HTML ==="
mkdir -p dist
cp index.html dist/index.html
echo "=== Starting server on PORT ${PORT:-8080} ==="
NODE_ENV=production exec ./node_modules/.bin/tsx server/index.ts
