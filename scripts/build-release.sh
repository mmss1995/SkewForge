#!/usr/bin/env bash
# Builds one release of an example app into .demo/<app>-v<release>.
# Every release changes the lazy route chunks, like a real deploy would.
#   scripts/build-release.sh react-app 2
set -euo pipefail
app=${1:?usage: build-release.sh <react-app|vue-app> <release>}
release=${2:?usage: build-release.sh <react-app|vue-app> <release>}
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/.demo/$app-v$release"

SKEWFORGE_DEPLOYMENT_ID="$app-v$release" VITE_RELEASE="$release" \
  npm run build --silent -w "$app" -- --outDir "$out" --emptyOutDir --logLevel warn
echo "$out"
