#!/usr/bin/env bash
# Builds the desktop packages of the server app inside electron-builder's official Docker image,
# so the build does not depend on the Node.js, Wine or 7-Zip installed on this computer:
#   - Linux:   dist/retreat-manager_<version>_amd64.deb and dist/RetreatManager-<version>-x86_64.AppImage
#   - Windows: dist/RetreatManager-Setup-<version>.exe (NSIS, built with Wine in a Linux container)
#
# Usage (on a Linux computer with Docker):  ./scripts/build-desktop.sh [linux|windows|all]
set -euo pipefail

TARGET="${1:-all}"
case "$TARGET" in linux | windows | all) ;; *) echo "Uso: $0 [linux|windows|all]" >&2; exit 2 ;; esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="electronuserland/builder:wine"
mkdir -p "$HOME/.cache/electron" "$HOME/.cache/electron-builder" "$ROOT/dist"

# node_modules lives in a Docker volume: the container installs Linux and Windows binaries
# (sharp) without touching the node_modules of this computer.
read -r -d '' BUILD <<'EOF' || true
set -e
npm ci --no-audit --no-fund
if [ "$TARGET" != windows ]; then
  npx electron-builder --linux deb AppImage --x64
fi
if [ "$TARGET" != linux ]; then
  # Image library for Windows (same version as the Linux one in package-lock.json).
  SHARP_WIN=$(node -p "require('./package-lock.json').packages['node_modules/@img/sharp-win32-x64'].version")
  npm install --no-save --no-audit --no-fund --force "@img/sharp-win32-x64@$SHARP_WIN"
  npx electron-builder --win nsis --x64
fi
# The container runs as root: give the packages back to the user of this computer.
chown -R "$HOST_UID:$HOST_GID" dist
EOF

docker run --rm -t \
  -e TARGET="$TARGET" \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -v "$ROOT":/project \
  -v retreat-manager-build-modules:/project/node_modules \
  -v "$HOME/.cache/electron":/root/.cache/electron \
  -v "$HOME/.cache/electron-builder":/root/.cache/electron-builder \
  -w /project \
  "$IMAGE" bash -c "$BUILD"

ls -lh "$ROOT"/dist/*.deb "$ROOT"/dist/*.AppImage "$ROOT"/dist/*.exe 2>/dev/null || true
