# Contributing to walleterm

Walleterm is before version 1.0. It keeps one current interface and no compatibility paths.
Keep each change small. Add tests for each changed behavior or failure.

## Build from source

You need:

- Rust through [rustup](https://rustup.rs). `rust-toolchain.toml` pins Rust 1.98.1, and rustup installs it. Fixture contracts build with Rust 1.93.0.
- Bun 1.4.2 or later. Bun builds the embedded browser files only.
- cloudflared for `walleterm tunnel` and `walleterm demo`.
- The Stellar CLI. Some offline tests call it.

```sh
brew install oven-sh/bun/bun cloudflared stellar-cli
make install
make install-skill
walleterm --help
```

`make install` builds the release binary and installs it into `~/.local/bin`. Set `PREFIX` for another location.
Keep that directory on `PATH`, also in non-interactive agent shells.
Each build goes into a new directory under `~/.local/share/walleterm/releases`, named by its content hash.
The install then switches the `walleterm` and `stellar-walleterm` links. A failed build keeps the previous command.
Use `make build` for a build in this checkout's `bin/` directory.

`make install-skill` links the two skills from this checkout into `~/.agents/skills`, `~/.claude/skills`, and `~/.codex/skills`.
New agent sessions read your edits in `.agents/skills/`. Keep the checkout at the same path.
The command refuses to replace an existing skill copy or a different link.

## Checks

```sh
bun install --frozen-lockfile --ignore-scripts
rustup target add wasm32v1-none
cargo build --locked --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none
make test
make test-package
make test-kit
make test-fixtures
bun run format:check
cargo deny --workspace --locked check advisories licenses sources
```

CI runs all of these checks. The tests run offline with mock keys.

- `make test` runs rustfmt, Clippy, the Cargo tests, the TypeScript check, and the Bun tests. The Bun tests need the CAP-71 fixture build above.
- The Cargo tests compare the Rust signer with frozen vectors and transcripts in `fixtures/parity/`.
- Browser tests run the real SDK against the Rust bridge in `walleterm-test-host`. That binary needs the `test-host` feature and never ships.
- `make test-package` builds the release package twice and requires identical files. It then runs the binary with only the system `PATH`.
- `make test-kit` type-checks the Kit module and checks Stellar Wallets Kit 2.7.0 against the Rust bridge. It also checks the Kit acceptance page offline.
- `make test-fixtures` runs the Rust tests of the four contract fixture workspaces. CI runs it in a parallel Ubuntu job.
- `cargo deny` checks the Rust dependencies. CI uses `cargo-deny` 0.20.2.

The release package has budgets. `tools/src/budgets.rs` holds them:

- The executable has at most 10,000,000 bytes.
- `Cargo.lock` has at most 160 packages.
- The macOS workspace resolves at most 130 packages.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | The `walleterm` binary: signing core, CLI, 1Password agent, bridge, and services |
| `sdk/` | The browser SDK, its connection component, and the Stellar Wallets Kit module |
| `demo/site/` | The demo website that `walleterm demo` embeds |
| `scripts/build.ts` | The Bun build for the SDK and the demo |
| `tests/` | Rust integration tests, Bun tests, browser tests in `tests/browser/`, and live runners |
| `fixtures/` | Test contracts, pinned WASM, frozen parity vectors, and the Stellar Wallets Kit check |
| `tools/` | Maintainer commands for package, install, and release. They never ship |
| `.agents/skills/` | The agent skills |
| `site/`, `design/` | The marketing website and its illustrations |
| `evidence/` | Records of live testnet runs |
| `Casks/` | The Homebrew cask |

`AGENTS.md` holds the rules for coding agents. They also apply to human contributors.

## Rules

- Use Stellar testnet only. Never use mainnet funds.
- Use dedicated test keys that you generate inside 1Password. Never change other 1Password items.
- Never commit key material: seeds, private keys, vault exports, or `.env` files.
- Offline tests use mock keys only. Never fund or submit with a mock key.
- Live tests request real 1Password signatures and change testnet state. They run by hand only. See [live tests](docs/LIVE-TESTS.md).
- Change the Paper design before you change `site/`. See [maintaining](docs/MAINTAINING.md#website).
- Update [`docs/NETWORKS.md`](docs/NETWORKS.md) when you add, change, or remove a network rule or a hard-coded limit.
- Write documentation in ASD-STE100 Simplified Technical English. Use the active voice and sentences of 20 words or fewer.
