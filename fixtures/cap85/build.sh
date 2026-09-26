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
bun "$HERE/manifest.ts" "$HERE"
