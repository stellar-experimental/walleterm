| Existing file | Action | Target or reason |
| --- | --- | --- |
| `.agents/skills/walleterm-illustration/SKILL.md` | rewrite | Keep TS art commands until phase 8 passes; preserve required visual checks |
| `.agents/skills/walleterm-illustration/agents/openai.yaml` | keep | Skill metadata |
| `.agents/skills/walleterm-site-bridge/SKILL.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm-site-bridge/agents/openai.yaml` | keep | Skill metadata |
| `.agents/skills/walleterm-site-bridge/references/interception.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm-site-bridge/references/legacy-freighter.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm-site-bridge/references/message-signing.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm-site-bridge/references/service.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm-site-bridge/scripts/classic-attach.py` | rewrite | Replace with classic-attach.ts; preserve flags, independent crypto, CLI checks, exclusive output; remove Python |
| `.agents/skills/walleterm-site-bridge/scripts/legacy-freighter.ts` | keep | Browser website interception requires JavaScript |
| `.agents/skills/walleterm-site-bridge/scripts/verify-signature.ts` | delete | Merge independent Node crypto verification into classic-attach.ts |
| `.agents/skills/walleterm/SKILL.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm/references/acceptance.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm/references/classic-native.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm/references/contract-code.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm/references/delegation.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm/references/fee-bump.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm/references/openzeppelin.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.agents/skills/walleterm/references/structured-auth.md` | rewrite | Preserve skill authority; update native build and runtime references |
| `.claude/skills/walleterm-illustration` | keep | Existing illustration skill link |
| `.github/CODEOWNERS` | rewrite | Protect Cargo.lock, native signer, tools, release and cask paths |
| `.github/workflows/test.yml` | rewrite | Rust/Bun/fixture/build/package/browser checks; remove Go setup at cutover |
| `.gitignore` | rewrite | Rust targets and generated assets; preserve journal exclusions; ignore Python caches |
| `.prettierignore` | rewrite | Exclude generated Rust assets and build directories |
| `.prettierrc.json` | keep | Existing browser TypeScript formatting |
| `AGENTS.md` | rewrite | Native module boundaries; preserve signing rules and accepted scope |
| `Casks/walleterm.rb` | rewrite | One-binary archive; update version and checksum only at release |
| `Makefile` | rewrite | Rust build/install/test/release orchestration; preserve skill installation |
| `README.md` | rewrite | One Rust binary; Rust source install; unchanged browser SDK and static website |
| `auth_command.go` | delete | Replace dispatch with native src/cli.rs |
| `auth_command_test.go` | port | tests/cli.rs; native sign-auth behavior |
| `bridge/PROTOCOL.md` | rewrite | docs/BRIDGE-PROTOCOL.md; preserve protocol v3 contract and redirect all links |
| `bridge/activity.test.ts` | rewrite | tests/browser/activity.test.ts; transport/browser mocks or pure functions; no host |
| `bridge/auth-cli.ts` | port | src/cli.rs; src/authorization.rs |
| `bridge/auth-ledger.test.ts` | port | src/ledger/tests.rs |
| `bridge/auth-lifecycle.test.ts` | port | src/bridge/tests.rs |
| `bridge/authorization.test.ts` | rewrite | Rust authoritative tests plus retained JS SDK vectors in tests/browser/ |
| `bridge/authorization.ts` | port | src/authorization.rs; src/preimage.rs; src/ledger.rs |
| `bridge/browser-fixture.ts` | rewrite | tests/browser/fixture.ts; start Rust test host |
| `bridge/code-view.test.ts` | rewrite | tests/browser/code-view.test.ts; Rust test host |
| `bridge/connect.test.ts` | rewrite | tests/browser/connect.test.ts; transport/browser mocks or pure functions; no host |
| `bridge/kit.test.ts` | rewrite | tests/browser/kit.test.ts; transport/browser mocks or pure functions; no host |
| `bridge/launch.test.ts` | port | src/service/tests.rs; tests/process.rs |
| `bridge/launch.ts` | port | src/service.rs; src/tunnel.rs; src/qr.rs |
| `bridge/main.test.ts` | port | src/config/tests.rs |
| `bridge/main.ts` | port | src/cli.rs; src/config.rs; remove Bun mode dispatcher |
| `bridge/runtime.test.ts` | port | src/process/tests.rs |
| `bridge/runtime.ts` | port | src/process.rs; native deadline and cleanup helpers |
| `bridge/scan.test.ts` | rewrite | tests/browser/scan.test.ts; transport/browser mocks or pure functions; no host |
| `bridge/sdk-artifact.test.ts` | rewrite | tests/browser/sdk-artifact.test.ts; transport/browser mocks or pure functions; no host |
| `bridge/sdk.test.ts` | rewrite | tests/browser/sdk.test.ts; transport/browser mocks or pure functions; no host |
| `bridge/sep43.test.ts` | rewrite | tests/browser/sep43.test.ts; Rust test host |
| `bridge/server.test.ts` | port | src/bridge/tests.rs; tests/http.rs |
| `bridge/server.ts` | port | src/bridge.rs; src/http.rs |
| `bridge/signer.test.ts` | port | src/agent/tests.rs; src/vault/tests.rs |
| `bridge/signer.ts` | port | src/agent.rs; src/vault.rs |
| `bridge/site.test.ts` | rewrite | tests/browser/site.test.ts; transport/browser mocks or pure functions; no host |
| `bridge/soroban-transaction.test.ts` | rewrite | Rust authoritative tests plus retained JS SDK vectors in tests/browser/ |
| `bridge/test/support.ts` | rewrite | tests/browser/support.ts; remove TS host imports |
| `bridge/transaction.ts` | port | src/transaction.rs |
| `bridge/tunnel-child.test.ts` | port | tests/process.rs |
| `bridge/tunnel-child.ts` | port | src/tunnel.rs; private same-binary supervisor |
| `bridge/vault.test.ts` | port | src/vault/tests.rs |
| `bun.lock` | rewrite | Regenerate after native QR port and static scanner vectors permit qrcode removal |
| `bunfig.toml` | rewrite | Only browser and JS SDK interoperability tests |
| `demo/contracts.test.ts` | rewrite | Keep Bun SDK and browser contract workflow tests; no host |
| `demo/server.ts` | port | src/demo.rs; src/http.rs; embedded asset route manifest |
| `demo/site/activity.css` | keep | Browser UI; embed reachable assets and required WASM only |
| `demo/site/activity.ts` | keep | Browser UI; embed reachable assets and required WASM only |
| `demo/site/app.ts` | keep | Browser UI; embed reachable assets and required WASM only |
| `demo/site/code-view.css` | keep | Browser UI; embed reachable assets and required WASM only |
| `demo/site/code-view.ts` | keep | Browser UI; embed reachable assets and required WASM only |
| `demo/site/contracts.ts` | keep | Browser UI; embed reachable assets and required WASM only |
| `demo/site/index.html` | keep | Browser UI; embed reachable assets and required WASM only |
| `demo/site/style.css` | keep | Browser UI; embed reachable assets and required WASM only |
| `demo/site/syntax.ts` | keep | Browser UI; embed reachable assets and required WASM only |
| `demo/site/vendor/syntax.LICENSE` | keep | Browser UI; embed reachable assets and required WASM only |
| `design/ILLUSTRATION.md` | rewrite | Record phase 8 outcome; change commands only after byte equality; preserve visual standard |
| `design/art/build.ts` | keep | Keep TS until phase 8 proves identical site/art bytes; then port to tools/src/art.rs |
| `design/art/hand.ts` | keep | Keep TS until phase 8 proves identical number strings and site/art bytes |
| `design/art/mascot.ts` | keep | Keep TS until phase 8 proves identical site/art bytes; preserve geometry and colors |
| `design/reference/01-moon-green-field.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/02-request-line-draft.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/03-night-oval.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/04-request-line.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/05-door-threshold.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/06-arc-three-dots.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/07-balance-scale.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/08-bridge-walk.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/09-forked-path.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/10-keyhole.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/11-horizon-moon.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/12-red-barrier.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/13-spotlight-mat.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/14-three-doorways.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/15-moss-circle.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/16-hourglass.png` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/reference/README.md` | rewrite | Preserve reference index; update generator links if present |
| `design/reference/metrics.json` | keep | Visual reference or fixed baseline; never embed or silently regenerate |
| `design/tools/__pycache__/artcheck.cpython-313.pyc` | delete | Generated Python cache; add ignore rule |
| `design/tools/artcheck.py` | keep | Only active Python exception; maintainer NumPy/SciPy image check; never packaged |
| `docs/AGENTIC-PAYMENTS.md` | keep | PR #23 research only; no payment implementation in this port |
| `docs/BUN-MIGRATION.md` | rewrite | Mark historical; link current Rust architecture and build instructions |
| `docs/CODE-DISPLAYS.md` | keep | Historical research or unchanged browser guidance and screenshots |
| `docs/CONNECTION-LIFECYCLE.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/CONNECTION-UI.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/CONTRACT-AUTHORIZATION.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/DEMO-ACTIONS.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/DEMO-ACTIVITY.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/FOLLOWUP.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/INTERFACE.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/LIVE-TESTS.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/LOADING-STATES.md` | keep | Historical research or unchanged browser guidance and screenshots |
| `docs/MOBILE-WEB-POC.md` | keep | Historical research or unchanged browser guidance and screenshots |
| `docs/MOBILE-WEB-RESEARCH.md` | keep | Historical research or unchanged browser guidance and screenshots |
| `docs/OPENZEPPELIN.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/PLAN.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/PROTOCOL-UPDATES.md` | keep | Historical research or unchanged browser guidance and screenshots |
| `docs/REQUIREMENTS.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/SEP-43.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/SKILLS-AUDIT.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/SKILLS-INDEPENDENT-REVIEW.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/STELLAR-CLI.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/TEST-MATRIX.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/VAULT-DISCOVERY.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/VAULT-FILTER-VALIDATION.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/WALLET-SWITCH-VALIDATION.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `docs/WEB-BRIDGE.md` | rewrite | Current native workflow; retain dated acceptance limits |
| `go.mod` | delete | Cargo.toml and Cargo.lock replace Go |
| `main.go` | port | src/cli.rs; src/agent.rs; src/error.rs; src/platform.rs |
| `main_test.go` | port | src/agent/tests.rs; src/cli/tests.rs; tests/cli.rs |
| `package.json` | rewrite | Browser exports and Bun test/build tools; remove host and terminal QR dependencies |
| `scripts/bridge.entitlements.plist` | delete | Native release requires no JIT entitlement |
| `scripts/build.ts` | rewrite | Keep Bun browser build API; emit exact asset route and hash manifest |
| `scripts/install.test.ts` | port | tools/tests/install.rs |
| `scripts/install.ts` | port | tools/src/install.rs |
| `scripts/package.test.ts` | port | tools/tests/package.rs; tests/package.rs |
| `scripts/package.ts` | port | tools/src/package.rs |
| `scripts/release.ts` | port | tools/src/release.rs |
| `scripts/sdk-import.test.ts` | keep | Move to tests/browser/sdk-import.test.ts |
| `scripts/syntax.test.ts` | keep | Move to tests/browser/syntax.test.ts |
| `sdk/authorization.ts` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `sdk/connect.css` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `sdk/connect.ts` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `sdk/errors.ts` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `sdk/kit.ts` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `sdk/preimage.ts` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `sdk/scan.ts` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `sdk/transaction.ts` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `sdk/types.ts` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `sdk/walleterm.ts` | keep | Browser SDK and independent artifact verification; protocol v3 |
| `service.go` | port | src/cli.rs; src/service.rs; delete sidecar dispatch |
| `service_test.go` | port | src/cli/tests.rs; tests/package.rs |
| `site/art/bridge-narrow.svg` | keep | Separate static marketing site; never embed in CLI or demo |
| `site/art/bridge.svg` | keep | Separate static marketing site; never embed in CLI or demo |
| `site/art/favicon.svg` | keep | Separate static marketing site; never embed in CLI or demo |
| `site/art/hero.svg` | keep | Separate static marketing site; never embed in CLI or demo |
| `site/art/horizon.svg` | keep | Separate static marketing site; never embed in CLI or demo |
| `site/art/keyhole.svg` | keep | Separate static marketing site; never embed in CLI or demo |
| `site/art/night-wallet.svg` | keep | Separate static marketing site; never embed in CLI or demo |
| `site/art/request.svg` | keep | Separate static marketing site; never embed in CLI or demo |
| `site/index.html` | keep | Separate static marketing site; never embed in CLI or demo |
| `site/og.png` | keep | Separate static marketing site; never embed in CLI or demo |
| `tests/1password-failure.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/cap71.test.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/cap71.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/cap85.test.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/cap85.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/checkpoint.test.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/classic.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/cli-pipeline.test.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/cli-pipeline.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/contract-auth-demo-live.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/contracts.test.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/contracts.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/extended-contracts.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/live-utils.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/live.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/openzeppelin-auth-live.test.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/openzeppelin-auth-live.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/simulations.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/site-bridge.test.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/submission.test.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/submission.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tests/types.ts` | rewrite | Keep JS SDK interoperability or live harness; remove Go builds and TS host imports |
| `tsconfig.json` | rewrite | Strict browser, builder, skill, and JS SDK interoperability scope |
| `tsconfig.sdk.json` | keep | Preserve declaration generation and all accepted v3 exports |
