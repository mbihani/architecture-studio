#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node tests/check-scripts.cjs
node --test tests/*.test.cjs
