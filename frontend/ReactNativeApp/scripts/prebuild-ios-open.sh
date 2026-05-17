#!/usr/bin/env bash
# Regenerate native iOS project, clear Xcode DerivedData for Settld, open workspace.
# Must be run with cwd = frontend/ReactNativeApp (see ../../scripts/ios-prebuild-open.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules/expo ]]; then
  echo "[prebuild-ios-open] expo not installed. Run: npm install"
  exit 1
fi

npx expo prebuild --platform ios --clean

# CocoaPods yields Settld.xcworkspace — run pod install if prebuild skipped it (e.g. CI).
if [[ ! -d "ios/Settld.xcworkspace" ]]; then
  (cd ios && pod install)
fi

# Wipe DerivedData for this app — use find so zsh's nomatch won't break pasted one-liners.
DERIVED="${HOME}/Library/Developer/Xcode/DerivedData"
if [[ -d "$DERIVED" ]]; then
  find "$DERIVED" -maxdepth 1 -name 'Settld-*' -print0 2>/dev/null | xargs -0 rm -rf -- 2>/dev/null || true
  find "$DERIVED" -maxdepth 1 -name 'Settld.*' -print0 2>/dev/null | xargs -0 rm -rf -- 2>/dev/null || true
fi

WORKSPACE="${ROOT}/ios/Settld.xcworkspace"
if [[ ! -d "$WORKSPACE" ]]; then
  echo "[prebuild-ios-open] Missing workspace: $WORKSPACE"
  echo "Try: cd ios && pod install"
  exit 1
fi

open "$WORKSPACE"
