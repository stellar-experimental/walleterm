#!/bin/sh
# Builds the pinned OpenZeppelin multisig example contracts and the two local
# fixture contracts. Writes .wasm files and manifest.json into fixtures/wasm.
# Network use: one git fetch of the pinned commit. No keys. No signing.
set -eu

OZ_REPO="https://github.com/OpenZeppelin/stellar-contracts.git"
OZ_COMMIT="a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/wasm"
SRC="$HERE/.oz-src"

mkdir -p "$OUT"

if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" remote add origin "$OZ_REPO"
fi
if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)" != "$OZ_COMMIT" ]; then
  git -C "$SRC" fetch -q --depth 1 origin "$OZ_COMMIT"
  git -C "$SRC" checkout -q --detach FETCH_HEAD
fi
[ "$(git -C "$SRC" rev-parse HEAD)" = "$OZ_COMMIT" ] || { echo "pinned commit mismatch" >&2; exit 1; }

for pkg in multisig-account-example multisig-ed25519-verifier-example \
           multisig-threshold-policy-example multisig-weighted-threshold-policy-example; do
  (cd "$SRC" && stellar contract build --package "$pkg" --out-dir "$OUT")
done
(cd "$HERE/contracts" && stellar contract build --out-dir "$OUT")

bun "$HERE/manifest.ts" "$OUT" "$OZ_COMMIT"
