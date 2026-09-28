#!/usr/bin/env bash
# Ships three releases of the React example to a running gateway (`npm run dev`):
# release 1 and 2 promoted, release 3 staged for preview.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
export SKEWFORGE_SERVER=${SKEWFORGE_SERVER:-http://localhost:8081}
export SKEWFORGE_TOKEN=${SKEWFORGE_TOKEN:-dev-admin-token}
suffix=$(date +%s)

curl -fsS "$SKEWFORGE_SERVER/health" >/dev/null || { echo "Gateway not reachable at $SKEWFORGE_SERVER — start it with: npm run dev"; exit 1; }

for release in 1 2 3; do
  dir=$(bash scripts/build-release.sh react-app "$release" | tail -1)
  flags=(--id "shop-$release-$suffix" --message "Skew Shop release $release")
  [ "$release" != 3 ] && flags+=(--promote)
  npx tsx packages/cli/src/bin.ts deploy "$dir" "${flags[@]}"
  [ "$release" = 1 ] && { echo; echo "Open http://localhost:8080 now, then press enter to ship release 2"; read -r; }
done

echo
npx tsx packages/cli/src/bin.ts list
echo
echo "App:        http://localhost:8080   (your old tab keeps working; its next click lands on release 2)"
echo "Dashboard:  http://localhost:5173   (token: $SKEWFORGE_TOKEN)"
echo "Release 3 is staged: promote it with  npm run skewforge -- promote shop-3-$suffix"
