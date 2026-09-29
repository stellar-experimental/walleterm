# Brief: move walleterm to Rust everywhere, TypeScript only where necessary

You are the planning and review agent (Astra). Opus (another agent) wrote the proposal below.
Assess it, then write an implementation plan. Opus will check your plan, then write the code.
A second Opus agent will run all tests. You will review the code later in follow-up rounds.

## Your working rules

- Work in this worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere` (branch `feat/rust-everywhere`, based on `origin/release-packaging`, PR #20).
- Do NOT edit tracked files. Write only inside `_migration/` (git-excluded).
- Read `AGENTS.md`, `docs/INTERFACE.md`, `docs/PLAN.md`, `bridge/PROTOCOL.md`, `README.md`, and the code before you plan.
- Follow AGENTS.md: minimal code, minimal deps, no speculative features, STE prose, security review of signing code.
- Verify crate APIs and versions against real sources (crates.io, docs.rs, GitHub). Use `cargo` in a scratch dir under `_migration/` if useful. Record versions.
- Do not run live 1Password signing or testnet transactions.

## Current architecture (release-packaging, 14760ef)

- `walleterm` (Go, zero third-party deps, ~640 lines: `main.go`, `service.go`, `auth_command.go`): `list`, `sign` (1Password SSH-agent socket, request type 13, independent ed25519 verify). `sign-auth`, `tunnel`, `demo` just `exec` the sidecar.
- `walleterm-bridge` (Bun `--compile`, 63 MB, includes JSC runtime + embedded site files): `sign-auth` (bridge/auth-cli.ts), `tunnel` (bridge/server.ts, launch.ts, tunnel-child.ts, cloudflared supervision), `demo` (demo/server.ts + demo/site).
- Bridge calls back into the Go binary for raw digest signing. `walleterm sign` signs ANY 32-byte digest, so the split is not a privilege boundary; the 1Password prompt is the real gate.
- Browser SDK (`sdk/*.ts`, npm exports `.`, `./connect`, `./scan`, `./connect.css`) must stay TS. It re-exports `sdk/authorization.ts` (inspectAuthEntry etc.) as a non-authoritative pre-check.
- Demo site UI (`demo/site`) must stay TS/JS. Tests: Bun tests (~387), Go tests, offline contract harnesses (`tests/contracts.ts`, `extended-contracts.ts`, `cap85.ts`), live runners (`tests/live.ts`, `contract-auth-demo-live.ts`).
- Release: `scripts/package.ts`, `scripts/release.ts`, `scripts/install.ts`, `Casks/`, `scripts/bridge.entitlements.plist` (JIT entitlements for Bun), Developer ID signing + notarization.

## Measurements (Opus, this Mac, arm64, 2026-09-28)

| Build | Size | gzip | Startup (no-op) | Peak RSS |
|---|---|---|---|---|
| Go `walleterm` today | 3.2 MB | 1.4 MB | 9 ms | 5 MB |
| Bun `walleterm-bridge` today | 63 MB | 26.5 MB | 24 ms (usage), 31 ms (sign-auth reject) | 21-33 MB |
| Go proto: go-stellar-sdk/xdr + net/http | 6.9 MB | 2.8 MB | 7 ms | 11 MB |
| Rust proto: stellar-xdr 28 (std, base64) + strkey + ed25519-dalek + sha2 | 0.34 MB | 0.16 MB | 4.5 ms | 1.6 MB |
| Rust proto + axum/tokio HTTP | 0.62 MB | 0.33 MB | - | - |

Embedded demo + SDK files: 3.75 MB (any native binary must embed them). Rust proto crate count: 38 (core), 79 (with axum/tokio). Proto sources: `_migration/proto-rs-src/`, `_migration/proto-rs-Cargo.toml`. Note: stellar-xdr 28 has no `curr` feature; types are at `stellar_xdr::`.

## Research findings

- SDF maintains JS (js-stellar-sdk/base/js-xdr), Go (go-stellar-sdk), Rust (stellar-xdr, stellar-strkey, soroban-sdk, stellar-cli, stellar-ledger). Python is community-maintained.
- SDF docs call rs `stellar-xdr` the reference implementation of XDR-JSON; SDF's Go and JS XDR-JSON packages are built from it.
- stellar-cli (Rust) signs auth entries in `sign_soroban_authorizations`; signer kinds Local, Ledger, Lab, SecureStore; no ssh-agent signer.
- Bun macOS runtime alone is ~61 MB; bun --compile had an invalid macOS signature bug (oven-sh/bun#32159, fixed Aug 2026).

## Opus proposal

Rust for the whole CLI; TS only for the browser SDK and demo site UI (Bun stays a dev/build tool only).

1. Shared golden test vectors in `fixtures/` (auth entry, ledger, adapter, expected digest, signed XDR, errors). Every implementation (Rust host, TS SDK) must pass them.
2. Rust core (auth entry parse/check, digest, adapter signature attach for `account`, `contract-ed25519`, `openzeppelin-ed25519`; SSH-agent client; ed25519 verify).
3. Rust `walleterm` replaces Go: `list`, `sign`, `sign-auth` natively, same JSON interface (docs/INTERFACE.md).
4. Port tunnel + demo server to Rust (HTTP server, cloudflared supervision, embedded Bun-built site files). Drop `walleterm-bridge`, the Bun runtime, and JIT entitlements from the release. One binary.
5. Optional: compile core to WASM for the browser SDK, or keep the TS pre-check tested against the same vectors.
6. Later: propose an ssh-agent signer kind upstream to stellar-cli.

## Open context

- PR #22 (`docs/sep-43-design`, open, under review) changes the bridge protocol to SEP-43 / protocol v3: bridge/PROTOCOL.md, bridge/authorization.ts, connect tests, a new kit adapter (~4,000 lines). Assess how the port should sequence with it (`git diff origin/release-packaging...origin/docs/sep-43-design`).
- PR #24 (site illustration) and #23 (docs) do not touch the bridge.
- The user wants the final form: Rust everywhere, TS only where necessary, cruft removed, everything slimmed, thoroughly tested.

## Your deliverable

Write `_migration/ASTRA-PLAN.md`. Include:

1. Assessment of the proposal: what you agree with, what you reject or change, and why. Challenge it; do not rubber-stamp. Consider whether a single-language TS/Bun or a Go design is actually better for this repo.
2. The target end state: file tree, crate layout (single crate vs workspace), exact dependencies with versions and features, and what TS remains and why.
3. Delete/keep inventory: every Go file, TS file, script, test, doc, and packaging file, marked delete / port / keep / rewrite.
4. Phased implementation plan with acceptance checks per phase. Keep the repo green after each phase.
5. Test strategy: golden vectors, which tests port to Rust (`cargo test`), which stay Bun, parity checks against the current implementation, browser/demo checks, what cannot run offline.
6. Security review checklist for the signer, the auth-entry checks, the HTTP bridge (origin handling, pairing, request queue), process supervision, and release signing.
7. Release and packaging changes (cask, notarization, entitlements, install script, Makefile, CI).
8. Sequencing with PR #22 and risks.

When finished, reply in the terminal with only the path of the plan file.
