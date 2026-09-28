# Repository audit index

Status: complete. Start with the [final report](REPORT.md) and [feature assessment](FEATURES.md).
Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

## Method and evidence

- [Audit plan](PLAN.md)
- [Architecture and boundaries](ARCHITECTURE.md)
- [Research method and limits](RESEARCH.md)
- [Source manifest](manifest.json)
- [Source archive provenance](checks/source-archive.json)
- [Concurrent source change](checks/concurrent-source-change.json)
- [Concern register](CONCERNS.md)
- [Offline baseline results](checks/baseline-permitted-results.json)
- [Final checkout results and TypeScript limitation](checks/final-package-results.json)
- [Isolated baseline plus audit TypeScript check](checks/isolated-package-typescript.json)
- [Final artifact integrity](checks/audit-integrity.json)
- [Local browser checks](checks/BROWSER.md)
- [Rust fixture test summary](checks/rust-summary.json)

## Independent area reports

| Area | Astra xhigh | Daybreak xhigh |
|---|---|---|
| Go signer and 1Password boundary | [Report](reports/01-signer-astra.md) | [Report](reports/01-signer-daybreak.md) |
| Bridge service and authorization | [Report](reports/02-bridge-astra.md) | [Report](reports/02-bridge-daybreak.md) |
| Service runtime and tunnels | [Report](reports/03-runtime-astra.md) | [Report](reports/03-runtime-daybreak.md) |
| Browser SDK and connection UI | [Report](reports/04-sdk-astra.md) | [Report](reports/04-sdk-daybreak.md) |
| Demo and transaction recovery | [Report](reports/05-demo-astra.md) | [Report](reports/05-demo-daybreak.md) |
| Contracts and protocol fixtures | [Report](reports/06-contracts-astra.md) | [Report](reports/06-contracts-daybreak.md) |
| Harness and acceptance evidence | [Report](reports/07-verification-astra.md) | [Report](reports/07-verification-daybreak.md) |
| Installation and product scope | [Report](reports/08-product-astra.md) | [Report](reports/08-product-daybreak.md) |
| Overall review | [Report](reports/09-overall-astra.md) | [Report](reports/09-overall-daybreak.md) |

<!-- concern-index -->
## Focused concern reviews

The coordinator decision distinguishes defects, conditional failures, accepted limits, and rejected claims.

| Candidate | Topic | Astra xhigh | Daybreak xhigh | Decision |
|---|---|---|---|---|
| C01 | Output backpressure and the advertised signer deadline | [Report](reports/concerns/c01-signer-deadline-astra.md) | [Report](reports/concerns/c01-signer-deadline-daybreak.md) | confirmed; low |
| C02 | Malformed request parsing in the demo HTTP service | [Report](reports/concerns/c02-demo-url-astra.md) | [Report](reports/concerns/c02-demo-url-daybreak.md) | confirmed; low |
| C03 | Shared pairing limit and repeated invalid codes | [Report](reports/concerns/c03-pairing-limit-astra.md) | [Report](reports/concerns/c03-pairing-limit-daybreak.md) | accepted_limit; none |
| C04 | Tunnel child survival after supervisor SIGKILL | [Report](reports/concerns/c04-supervisor-child-astra.md) | [Report](reports/concerns/c04-supervisor-child-daybreak.md) | accepted_limit; none |
| C05 | Delayed signature result after an observed remote wallet revision change | [Report](reports/concerns/c05-remote-revision-astra.md) | [Report](reports/concerns/c05-remote-revision-daybreak.md) | confirmed; medium |
| C06 | Camera and pairing work after connection component destruction | [Report](reports/concerns/c06-component-destroy-astra.md) | [Report](reports/concerns/c06-component-destroy-daybreak.md) | confirmed; low |
| C07 | Credential cleanup after a non-JSON 401 | [Report](reports/concerns/c07-unreadable-401-astra.md) | [Report](reports/concerns/c07-unreadable-401-daybreak.md) | optional_hardening; none |
| C08 | Malformed or mismatched Horizon confirmation data | [Report](reports/concerns/c08-confirmation-binding-astra.md) | [Report](reports/concerns/c08-confirmation-binding-daybreak.md) | conditional; low |
| C09 | Restored signed envelope consistency and verification | [Report](reports/concerns/c09-restored-journal-astra.md) | [Report](reports/concerns/c09-restored-journal-daybreak.md) | conditional; low |
| C10 | Decoded transaction details before submission | [Report](reports/concerns/c10-signed-review-astra.md) | [Report](reports/concerns/c10-signed-review-daybreak.md) | confirmed; low |
| C11 | Base harness RPC authorization tree validation | [Report](reports/concerns/c11-rpc-authorization-astra.md) | [Report](reports/concerns/c11-rpc-authorization-daybreak.md) | conditional; low |
| C12 | Dirty OpenZeppelin checkout build attribution | [Report](reports/concerns/c12-oz-provenance-astra.md) | [Report](reports/concerns/c12-oz-provenance-daybreak.md) | confirmed; low |
| C13 | CAP-85 X06 interrupted recovery | [Report](reports/concerns/c13-x06-recovery-astra.md) | [Report](reports/concerns/c13-x06-recovery-daybreak.md) | confirmed; low |
| C14 | CLI acceptance submission bypasses durable recovery | [Report](reports/concerns/c14-cli-submission-astra.md) | [Report](reports/concerns/c14-cli-submission-daybreak.md) | confirmed; low |
| C15 | Connection guide omits shared build files | [Report](reports/concerns/c15-sdk-distribution-astra.md) | [Report](reports/concerns/c15-sdk-distribution-daybreak.md) | confirmed; low |
| C16 | Parent directory sync and macOS power-loss guarantees | [Report](reports/concerns/c16-directory-durability-astra.md) | [Report](reports/concerns/c16-directory-durability-daybreak.md) | unsupported; none |
| C17 | Checkpoint protocol and harness identity | [Report](reports/concerns/c17-checkpoint-versions-astra.md) | [Report](reports/concerns/c17-checkpoint-versions-daybreak.md) | confirmed; low |
| C18 | Historical versus current live acceptance | [Report](reports/concerns/c18-historical-evidence-astra.md) | [Report](reports/concerns/c18-historical-evidence-daybreak.md) | accepted_limit; none |
| C19 | CAP-85 build removes tracked test snapshots | [Report](reports/concerns/c19-fixture-snapshots-astra.md) | [Report](reports/concerns/c19-fixture-snapshots-daybreak.md) | unsupported; none |
| C20 | macOS floor and Intel support wording | [Report](reports/concerns/c20-platform-claims-astra.md) | [Report](reports/concerns/c20-platform-claims-daybreak.md) | accepted_limit; none |
