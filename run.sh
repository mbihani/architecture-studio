#!/usr/bin/env bash
# Databricks Apps entrypoint: install deps (if missing), build, then serve.
# The --registry flag is required on hosts that block npmjs.org (this Mac
# blackholes it in /etc/hosts); registry.npmmirror.com is reachable.
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --registry=https://registry.npmmirror.com
npm run build
exec npx tsx server/index.ts
