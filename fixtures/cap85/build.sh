#!/bin/sh
# Builds the CAP-85 fixtures and writes fixtures/cap85/wasm/manifest.json.
# - contracts-sdk27/: one legacy context-reading account (soroban-sdk 27).
# - contracts/: manager, target v1, target v2, SDK 28 aware account (soroban-sdk 28).
# soroban-sdk 28 requires `stellar contract build` (stellar-cli 25.2+) for wasm targets.
# Network use: crate downloads only. No keys. No signing.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/wasm"
mkdir -p "$OUT"
(cd "$HERE/contracts-sdk27" && stellar contract build --out-dir "$OUT")
(cd "$HERE/contracts" && stellar contract build --out-dir "$OUT")
(cd "$HERE/contracts-sdk27" && cargo test --quiet)
(cd "$HERE/contracts" && cargo test --quiet)
find "$HERE/contracts" "$HERE/contracts-sdk27" -type d -name test_snapshots -prune -exec rm -rf {} +
node - "$HERE" <<'NODE'
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { execSync } = require('node:child_process');
const here = process.argv[2];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sdkOf = (ws) => /name = "soroban-sdk"\nversion = "([^"]+)"/.exec(readFileSync(`${here}/${ws}/Cargo.lock`).toString())?.[1];
const files = readdirSync(`${here}/wasm`).filter((f) => f.endsWith('.wasm')).sort();
const sources = {};
for (const [ws, crates] of [['contracts', ['manager', 'target-v1', 'target-v2', 'account']], ['contracts-sdk27', ['legacy-account']]]) {
  sources[`${ws}/Cargo.toml`] = sha(readFileSync(`${here}/${ws}/Cargo.toml`));
  sources[`${ws}/Cargo.lock`] = sha(readFileSync(`${here}/${ws}/Cargo.lock`));
  for (const crate of crates) for (const f of ['Cargo.toml', 'src/lib.rs']) sources[`${ws}/${crate}/${f}`] = sha(readFileSync(`${here}/${ws}/${crate}/${f}`));
}
const manifest = {
  built_at: new Date().toISOString(),
  cap: 'CAP-0085 externally managed contract executables',
  workspaces: { contracts: { soroban_sdk: sdkOf('contracts') }, 'contracts-sdk27': { soroban_sdk: sdkOf('contracts-sdk27') } },
  toolchain: { rustc: execSync('rustc --version').toString().trim(), cargo: execSync('cargo --version').toString().trim(), stellar_cli: execSync('stellar --version').toString().split('\n')[0].trim() },
  target: 'wasm32v1-none', profile: 'release (opt-level z, lto, panic abort), stellar contract build default optimize',
  sources,
  artifacts: Object.fromEntries(files.map((f) => { const b = readFileSync(`${here}/wasm/${f}`); return [f, { sha256: sha(b), bytes: b.length, sdk: f.includes('legacy') ? 'soroban-sdk 27' : 'soroban-sdk 28' }]; })),
};
writeFileSync(`${here}/wasm/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
NODE
