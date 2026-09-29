# Project rules

Build the smallest workable Stellar signing companion for agents.
Target macOS first. Permit human approval through 1Password.

## Scope

- Keep private keys inside 1Password. Never export, print, log, cache, or read private key fields.
- Generate production signer keys inside 1Password. Do not generate them externally and then import them.
- Local unit tests may use isolated mock keys. Never import these keys or use them for live signing.
- Use Ed25519. Passkeys and CAP-72 contract signers are out of scope.
- Use the official Stellar CLI for transaction construction, network access, and submission where practical.
- Return JSON for commands consumed by agents. Use readable output for interactive setup and service commands.
- Build only the requested features. Keep commands, dependencies, and code minimal.
- Prefer one clear workflow with sensible defaults. Derive routine values from reliable context or live data when practical.
- Add flags, parameters, settings, or prompts only for meaningful choices that cannot be inferred safely.
- Automate setup and discovery. Keep consequential choices visible for review and preserve required human approval.
- Do not add speculative abstractions or configuration for hypothetical future needs.
- Keep custom contracts and complex orchestration in test fixtures unless an accepted use case requires runtime support.

## Read first

- `docs/INTERFACE.md` before you change the CLI.
- `docs/BRIDGE-PROTOCOL.md` and `docs/SEP-43.md` before you change the bridge or the browser SDK.
- `docs/OPENZEPPELIN.md` before you change its contract adapter.
- `docs/NETWORKS.md` maps network restrictions, hard-coded network values, and hard-coded limits.
  Update it in the same change that adds, changes, or removes one of them. `tests/networks.test.ts` checks it.
- `design/ILLUSTRATION.md` before you change illustrations, the mascot, or `site/art/`.
- The Paper designs are the official reference for `site/`. Change Paper first, then the site.
  Read `.agents/skills/walleterm-illustration/references/paper.md` before any `site/` change.

## Code layout

- `src/` holds the one `walleterm` binary. Keep new runtime code in Rust.
  - Signing core: `artifact.rs`, `stellar.rs`, `transaction.rs`, `authorization.rs`, `preimage.rs`, `message.rs`.
  - CLI, 1Password agent, and shared helpers: `main.rs`, `cli.rs`, `agent.rs`, `platform.rs`, `error.rs`, `json.rs`, `util.rs`.
  - `lib.rs` exports the modules to the tests and the test host.
  - Bridge protocol version 3: `bridge.rs`, `http.rs`, `vault.rs`, `cancel.rs`.
  - Services: `service.rs`, `tunnel.rs`, `dns.rs`, `process.rs`, `qr.rs`, and `demo.rs` with the embedded website.
  - `bin/walleterm-test-host.rs` needs the `test-host` feature. It never enters a release.
- `tools/` holds maintainer commands: package, install, release, and fixture manifests. It never ships.
- TypeScript stays only where a browser or JavaScript runtime needs it.
  - `sdk/` is the browser SDK. `demo/site/` is the demo website. `scripts/build.ts` builds both with Bun.
- Every test lives under `tests/`. Browser tests go in `tests/browser/` and run the real SDK against the Rust test host.
- `fixtures/` holds test contracts, pinned WASM, and the Stellar Wallets Kit check.
- `fixtures/parity/` holds frozen signing vectors and CLI transcripts. Never regenerate a file to make a failing test pass.
- `site/` and `design/` hold the website and its art. `evidence/` holds live run records. `Casks/` holds the Homebrew cask.

## Work process

- Run `make test` before you finish a change. CI also runs `make test-package`, `make test-kit`, `make test-fixtures`,
  `bun run format:check`, and `cargo deny --workspace --locked check advisories licenses sources`.
- Add tests for each changed behavior or failure. Run offline tests before you request live signatures.
- Review security-sensitive signing and submission code independently before you accept it.
- Use dedicated testnet accounts and contracts. Never use mainnet funds. Run one live runner at a time.
- Do not change existing 1Password items or sign with unrelated keys.
- Record live transaction hashes, ledger results, account states, and contract versions.
- Distinguish local tests, live 1Password tests, and testnet acceptance. Do not claim a skipped or blocked test passed.

## Maintainer agent workflow

- Use Stellar Raven MCP for Stellar research and contract discovery when it is available.
- Research with `parallel-cli` and primary sources when available. Record source versions and evidence.
- Coordinate requested agents through Herdr. Preserve the caller directory and focus.
- Give each agent a bounded task, file ownership, and a completion check. Agents do not delegate further unless asked.

## Writing

Use ASD-STE100 Simplified Technical English for user-facing prose: active voice, at most 20 words for each sentence.
Keep technical identifiers exact.
