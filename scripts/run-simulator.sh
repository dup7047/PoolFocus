#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE_NAME="${DEVICE_NAME:-iPhone 16 Pro}"
DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
export DEVELOPER_DIR

cd "$ROOT_DIR"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required. Install with: brew install xcodegen" >&2
  exit 1
fi

xcodegen generate

xcodebuild \
  -project PoolFocus.xcodeproj \
  -scheme PoolFocusSimulator \
  -configuration Debug \
  -sdk iphonesimulator \
  -arch arm64 \
  -derivedDataPath "$ROOT_DIR/DerivedData" \
  SYMROOT="$ROOT_DIR/BuildProducts" \
  OBJROOT="$ROOT_DIR/BuildIntermediates" \
  CLANG_MODULE_CACHE_PATH="$ROOT_DIR/.build/clang-module-cache" \
  CODE_SIGNING_ALLOWED=NO \
  build

DEVICE_ID="$(xcrun simctl list devices available | sed -nE "/${DEVICE_NAME//\//\\/} \\([0-9A-F-]+\\).*\\((Shutdown|Booted)\\)/s/.*\\(([0-9A-F-]+)\\).*\\((Shutdown|Booted)\\).*/\\1/p" | head -n 1)"

if [[ -z "$DEVICE_ID" ]]; then
  echo "Could not find simulator named '$DEVICE_NAME'." >&2
  exit 1
fi

xcrun simctl boot "$DEVICE_ID" 2>/dev/null || true
open -a Simulator
xcrun simctl install "$DEVICE_ID" "$ROOT_DIR/BuildProducts/Debug-iphonesimulator/PoolFocusSimulator.app"
xcrun simctl launch "$DEVICE_ID" com.example.PoolFocusSimulator
