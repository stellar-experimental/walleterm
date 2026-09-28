# Bun and TypeScript migration

> **Historical.** This record describes the 2026-09-26 Bun sidecar design. The Rust binary replaced that sidecar.
> Bun now builds only the browser SDK and demo files, and it runs browser tests.
> See [the README](../README.md) for the current build, install, and test commands.

Research date: 2026-09-26. Base: PR #5, commit `ab467edd34a35636689691c951560f655bc33b17`, including loading PR #3.
Research used `parallel-cli` and primary documentation. The implementation uses Bun 1.4.2 and TypeScript 7.0.2.

## Tool choices

- Bun runs TypeScript directly. TypeScript performs strict checking separately. [Bun TypeScript](https://bun.com/docs/typescript)
- `bun.lock` pins dependencies. Installation uses `--frozen-lockfile --ignore-scripts`. [Bun installation](https://bun.com/docs/pm/cli/install)
- Bun builds browser modules. Shared chunks avoid duplicate code and keep the QR decoder lazy. [Bun bundler](https://bun.com/docs/bundler)
- TypeScript emits browser SDK declarations. Bun does not emit declarations. [Bun bundler](https://bun.com/docs/bundler)
- The declaration check excludes Bun globals. The exported browser library needs only standard browser types.
- Bun runs the offline test suite. Node compatibility requires direct tests of timers and child cleanup. [Bun compatibility](https://bun.com/docs/runtime/nodejs-compat)

The existing Stellar SDK, QR encoder, and QR decoder remain the only runtime dependencies.
The code-display integration adds two pinned tokenizer build dependencies. Bun replaces its separate esbuild step.
This migration adds no web framework, build plugin, server framework, or schema library.
The Go signer keeps its existing JSON protocol, socket checks, and independent signature verification.
The TypeScript bridge keeps the existing HTTP implementation and child process supervision.

## Build and installation

`bun run build` writes browser modules and declarations under `dist/`.
The package exports the client, connection UI, scanner, and stylesheet.
The demo serves generated JavaScript at the existing public URLs.
It serves shared chunks from an explicit filename map.

`make install` checks for `bun.lock`, builds the assets, and prepares a fresh release directory.
It installs production dependencies in that directory before switching the command link.
The installer preserves the previous release when a build or dependency install fails.
The service commands require Bun 1.4.2 or later.

## Verification

The original Node baseline passed 186 tests and three offline contract self-tests.
All maintained JavaScript sources now use TypeScript, including the code-display additions from PR #5.
The manifest generators and embedded signature verifier also use TypeScript.

- `make test`: strict checking, Go tests, `go vet`, 198 Bun tests, and three contract self-tests passed.
- `bun run format:check` and `actionlint`: passed.
- A separate SDK consumer passed NodeNext checking with browser types and no Bun globals.
- A fresh installation passed under a temporary path with spaces. The browser module graph and lazy syntax module loaded.
- Both manifest generators matched the original metadata and hashes, except their build timestamps.
- Browser checks passed pairing, wallet selection, switching, signing, mocked submission, journal restoration, and disconnection.
- Escape handling and the 390-pixel mobile layout passed. Camera denial returned to manual entry.

Browser checks used isolated mock keys and mocked network responses.
Camera capture, live 1Password signing, and testnet acceptance were not run.
Local checks used existing compiled Rust fixtures. The migration does not change the Rust contract sources.

Independent review checked production signing, vault filtering, cancellation, installation, and submission recovery.
It found three issues: restored activity metadata, signer pipe settings, and concurrent installer builds.
All three fixes passed the second review. A regression test covers restored activity metadata.
The final contract-helper review found no remaining issues.

CI installs pinned Bun, Go, Rust, and Stellar CLI versions before running the same offline checks.
It verifies the Stellar CLI archive hash and builds the CAP-71 fixtures before testing.

## Public startup check

The installed Bun 1.4.2 runtime retained an early `ENOTFOUND` response during new tunnel startup.
Repeated checks failed for 45 seconds, although a separate process resolved the same hostname and received HTTP 200.
Each readiness attempt now creates a fresh resolver. The same live startup check then passed.
Bun uses c-ares for `node:dns.resolve*()`. [Bun DNS](https://bun.com/docs/runtime/networking/dns)
The offline suite checks readiness errors and cleanup. The DNS propagation check used a real Cloudflare Quick Tunnel.

## Sources

- [Bun TypeScript configuration](https://bun.com/docs/typescript)
- [Bun TypeScript 6 and 7 support](https://bun.com/docs/typescript-6)
- [Bun bundler](https://bun.com/docs/bundler)
- [Bun test runner](https://bun.com/docs/test)
- [Bun test lifecycle](https://bun.com/docs/test/lifecycle)
- [Bun Node compatibility](https://bun.com/docs/runtime/nodejs-compat)
- [Bun installation](https://bun.com/docs/pm/cli/install)
- [Bun lockfile](https://bun.com/docs/pm/lockfile)
- [TypeScript strict checking](https://www.typescriptlang.org/tsconfig/strict.html)
- [Stellar CLI 28.0.0 release and archive hashes](https://github.com/stellar/stellar-cli/releases/tag/v28.0.0)
