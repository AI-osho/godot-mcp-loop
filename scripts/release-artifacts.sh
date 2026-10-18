#!/usr/bin/env bash
# Builds the release artifacts for version X.Y.Z from the current checkout and checks that the versions agree:
#   <out>/godot-mcp-loop-addon-X.Y.Z.zip   the editor addon (git-tracked files) and LICENSE
#   <out>/godot-mcp-loop-X.Y.Z.tgz         the npm package (server + bundled addon and agent skill)
#   <out>/SHA256SUMS.txt                   checksums of both
#   <out>/release-notes.md                 the CHANGELOG section, install commands and the checksums
# Usage: scripts/release-artifacts.sh X.Y.Z <out-dir>     (used by .github/workflows/release.yml)
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-}"
out="${2:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || -z "$out" ]]; then
  echo "Usage: scripts/release-artifacts.sh X.Y.Z <out-dir>" >&2
  exit 2
fi

pkg=$(node -p 'require("./server/package.json").version')
cfg=$(sed -n 's/^version="\(.*\)"$/\1/p' addons/mcp_loop/plugin.cfg)
if [[ "$pkg" != "$version" || "$cfg" != "$version" ]]; then
  echo "Version mismatch: release $version, server/package.json $pkg, addons/mcp_loop/plugin.cfg $cfg" >&2
  exit 1
fi
if ! grep -q "^## \[$version\] - " CHANGELOG.md; then
  echo "CHANGELOG.md has no '## [$version] - <date>' section" >&2
  exit 1
fi

mkdir -p "$out"
out=$(cd "$out" && pwd)
zip_name="godot-mcp-loop-addon-$version.zip"
tgz_name="godot-mcp-loop-$version.tgz"
rm -f "$out/$zip_name" "$out/$tgz_name" "$out/SHA256SUMS.txt" "$out/release-notes.md"

git ls-files -- LICENSE addons/mcp_loop | zip -q -X "$out/$zip_name" -@
(cd server && npm pack --pack-destination "$out" >/dev/null)
[[ -f "$out/$tgz_name" ]] || { echo "npm pack did not produce $tgz_name" >&2; exit 1; }

# Nothing but the package itself in the tarball.
if tar tzf "$out/$tgz_name" | grep -E '(^|/)(test|src)/|\.env|session\.json|\.npmrc' >/dev/null; then
  echo "Unexpected files in $tgz_name:" >&2
  tar tzf "$out/$tgz_name" | grep -E '(^|/)(test|src)/|\.env|session\.json|\.npmrc' >&2
  exit 1
fi

if command -v sha256sum >/dev/null; then sum=(sha256sum); else sum=(shasum -a 256); fi
(cd "$out" && "${sum[@]}" "$zip_name" "$tgz_name" > SHA256SUMS.txt)
node server/scripts/release-notes.mjs "$version" "$out/SHA256SUMS.txt" > "$out/release-notes.md"

echo "Built in $out:"
ls -l "$out"
