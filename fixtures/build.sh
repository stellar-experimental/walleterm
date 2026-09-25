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

node - "$OUT" "$OZ_COMMIT" <<'NODE'
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const [out, commit] = process.argv.slice(2);
const files = readdirSync(out).filter(f => f.endsWith('.wasm')).sort();
const artifacts = Object.fromEntries(files.map(f => {
  const bytes = readFileSync(`${out}/${f}`);
  const source = f.startsWith('multisig_')
    ? { repo: 'OpenZeppelin/stellar-contracts', commit, path: 'examples/multisig-smart-account' }
    : { repo: 'local', path: 'fixtures/contracts' };
  return [f, { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, ...source }];
}));
const manifest = { built_at: new Date().toISOString(), oz_commit: commit, artifacts };
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
NODE
