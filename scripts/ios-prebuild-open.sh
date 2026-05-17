#!/usr/bin/env bash
# Run from anywhere: regenerate ios/, pods, DerivedData wipe, open Xcode workspace.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="${REPO}/frontend/ReactNativeApp"
cd "$APP"

if [[ ! -d node_modules/expo ]]; then
  echo "[ios-prebuild] Installing npm deps in frontend/ReactNativeApp…"
  npm install
fi

exec bash scripts/prebuild-ios-open.sh
