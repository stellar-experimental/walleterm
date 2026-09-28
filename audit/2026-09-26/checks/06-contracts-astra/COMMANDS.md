# Commands and outcomes

The audit read source from `/private/tmp/walleterm-audit-40d6cca9db73`.
The commands below ran from `/Users/kalepail/Desktop/walleterm-v2`, unless stated otherwise.
All local writes stayed within the assigned audit paths or `/private/tmp`.

## Independent checks

```sh
python3 audit/2026-09-26/checks/06-contracts-astra/verify-source.py > audit/2026-09-26/checks/06-contracts-astra/source-verification.json
python3 audit/2026-09-26/checks/06-contracts-astra/provenance-repro.py > audit/2026-09-26/checks/06-contracts-astra/provenance-result.json
TMPDIR=/private/tmp bun audit/2026-09-26/checks/06-contracts-astra/x06-recovery-repro.ts > audit/2026-09-26/checks/06-contracts-astra/x06-recovery-result.json
```

All three commands passed with exit code `0`.
The source check matched all 199 Git blobs and all 14 CAP-85 manifest source hashes.
The provenance test reproduced dirty-source acceptance and incorrect commit labels.
It substituted an isolated commit and a build stub. It did not compile WASM.
The X06 test executed the exact frozen `x06` and `stepper` function bodies.
It mocked deployment, persistence, chain reads, and operation execution.
The control completed. The interrupted final-step case reproduced the stale-state assertion.
Neither reproduction requested a signature or used the network.
An initial scratch source check failed because Python 3.9 lacks `tomllib`.
The retained source check reads the relevant lockfile fields without that module.

## Central checks reused

The following commands ran centrally in the frozen directory. This audit did not rerun them.

```sh
go test -race ./...
go vet ./...
bun run typecheck
bun run test
cargo test --locked --offline --manifest-path fixtures/contracts/Cargo.toml --workspace
cargo test --locked --offline --manifest-path fixtures/cap71/Cargo.toml --workspace
cargo test --locked --offline --manifest-path fixtures/cap85/contracts/Cargo.toml --workspace
cargo test --locked --offline --manifest-path fixtures/cap85/contracts-sdk27/Cargo.toml --workspace
```

`../baseline-permitted-results.json` records successful permitted runs after initial sandbox socket failures.
`../baseline-permitted-2.txt` records the TypeScript check, 224 Bun tests, and three contract self-tests.
`../baseline-results.json` records the other baseline outcomes, including Go vet.
`../rust-results.json` records all four Rust commands with exit code `0`.
`../rust-summary.json` records 8 baseline, 8 CAP-71, 13 CAP-85, and 1 legacy tests.
`../fixture-hashes.json` matches 14 artifacts against their manifests.
Its three CAP-71 artifacts came from an existing build cache.
These checks establish offline results, not fresh testnet acceptance.

## Read-only inspection

The audit used `rg`, `rg --files`, `cat`, `sed -n`, and `nl -ba` for source inspection.
It used Python JSON projections for central evidence and provider metadata.
It read the installed SDK 17.1.0 authorization implementation under the frozen `node_modules` path.
It inspected session metadata to confirm `gpt-6-astra` and `xhigh`.
No other area conclusion was read.
