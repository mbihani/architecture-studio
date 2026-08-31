#!/usr/bin/env bash
# Databricks Apps entrypoint: serve the self-contained Amr extension HTML.
# No Vite build, no Express, no external deps — just Node's built-in http module.
set -ex
cd "$(dirname "$0")"
echo "=== Node $(node --version) ==="
echo "=== Serving Amr extension HTML ==="
mkdir -p dist
cp index.html dist/index.html
echo "=== Starting server on PORT ${PORT:-8080} ==="
exec node server.mjs
