# Independent 02 bridge audit

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.
> Both C03 reviewers accepted the shared pairing limit. Per-Origin counters do not address forged Origin headers.

## Verdict

One low-severity availability concern remains.

I found no confirmed signing-integrity, vault-isolation, or cancellation defect.

The frozen bridge enforces testnet network binding, origin-bound sessions, pinned wallet grants, and revision checks.

It also rechecks vault eligibility before signing and verifies each returned signature.

## Scope and identity

| Item | Value |
|---|---|
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Snapshot | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Requested model | `gpt-daybreak-blue-latest` |
| Requested effort | `xhigh` |
| Model verification | `inconclusive`; the runtime exposed no active-model metadata |
| Report owner | `audit/2026-09-26/reports/02-bridge-daybreak.md` |
| Research owner | `audit/2026-09-26/research/02-bridge-daybreak` |
| Check owner | `audit/2026-09-26/checks/02-bridge-daybreak` |
| Other reports | `not_read` |
| Delegation | `not_used` |

I read only frozen snapshot source.

I wrote only the assigned report, research directory, and check directory.

## Code coverage

| Area | Frozen evidence |
|---|---|
| Contract and boundaries | `AGENTS.md`, `README.md`, `docs/PLAN.md`, `docs/INTERFACE.md`, `bridge/PROTOCOL.md:1-106` |
| Origin and capabilities | `bridge/server.ts:55-76`, `bridge/server.ts:169-184`, `bridge/server.ts:287-375` |
| Pairing | `bridge/server.ts:126-160`, `bridge/server.ts:315-363` |
| Grants and revisions | `bridge/server.ts:366-451`, `bridge/server.ts:457-529` |
| Signing lifecycle | `bridge/server.ts:186-285`, `bridge/server.ts:531-563` |
| XDR policy | `bridge/transaction.ts:11-119` |
| Signature attachment | `bridge/transaction.ts:122-131` |
| Signer subprocess | `bridge/signer.ts:32-109`, `bridge/runtime.ts:3-18` |
| `OP_VAULT` | `bridge/signer.ts:111-202` |
| Public origin source | `bridge/launch.ts:65-91`, `bridge/launch.ts:274-323` |
| Tests | `bridge/server.test.ts`, `bridge/signer.test.ts`, `bridge/vault.test.ts` |
| Public types | `sdk/types.ts:1-63`, `sdk/errors.ts:1-14` |

The lockfile pins `@stellar/stellar-sdk` `17.1.0`.

Installed SDK metadata also reports `17.1.0`.

## Confirmed concern

### B-01: One origin can block pairing for every origin

| Field | Assessment |
|---|---|
| Severity | Low |
| Confidence | High |
| Status | Unresolved |
| Class | Availability |

`POST /v1/connect` requires a valid Origin but requires no existing capability.

Evidence: `bridge/server.ts:301-315` and `bridge/server.ts:315-316`.

The failure count and lock deadline are process-wide variables.

Evidence: `bridge/server.ts:126-132`.

Five wrong codes rotate the shared code and start a shared one-minute lock.

Evidence: `bridge/server.ts:317-338`.

The frozen test confirms that the current correct code returns `429` during this lock.

Evidence: `bridge/server.test.ts:177-194`.

#### Reachable scenario

A site learns the Quick Tunnel URL during a legitimate connection.

The site later sends five wrong `/v1/connect` requests from its valid HTTPS Origin.

The bridge rotates the terminal code and blocks every new pairing for one minute.

The site can repeat this request after each lock ends.

#### Impact

The attack blocks new pairings and invalidates the displayed code.

The attack does not expose a key or enable signing.

Existing authenticated sessions remain available.

#### Counterevidence

The Quick Tunnel hostname has high entropy.

The attacker must first learn that hostname.

The eight-digit code permits only five guesses before each lock.

Restarting the tunnel changes the hostname and revokes all sessions.

The protocol documents the five-attempt lock at `bridge/PROTOCOL.md:17-20`.

#### Minimum mitigation

Track ordinary failure counts per browser Origin.

Keep a larger global ceiling for forged Origin values.

Do not rotate the shared code when only one Origin reaches its local limit.

#### Verification plan

Add a two-Origin test beside `bridge/server.test.ts:177-194`.

Exhaust Origin A, then pair Origin B with the unchanged correct code.

Also verify that a distributed global ceiling still stops broad guessing.

## Non-issues

| Question | Result | Exact evidence |
|---|---|---|
| Network binding | Passed | Testnet equality precedes parsing at `bridge/transaction.ts:11-23`. The hash uses that transaction at `bridge/transaction.ts:117`. |
| Unsigned v1 XDR | Passed | Envelope, precondition, canonical XDR, source, and signature checks occur at `bridge/transaction.ts:27-51`. |
| Supported operations | Passed | Payment, data, and sell-offer validation occurs at `bridge/transaction.ts:52-93`. |
| Signature integrity | Passed | The bridge verifies the raw signature before attachment at `bridge/transaction.ts:122-131`. |
| Origin binding | Passed | Origin syntax and token binding occur at `bridge/server.ts:65-75` and `bridge/server.ts:169-173`. |
| Wallet grants | Passed | The first grant pins displayed keys at `bridge/server.ts:366-435`. |
| A-B-A races | Passed | Revision checks occur after discovery at `bridge/server.ts:376-435`. |
| Pre-sign eligibility | Passed | The bridge repeats XDR and signer checks at `bridge/server.ts:244-254`. |
| Cancellation | Passed | Cancellation withholds in-progress or signed results at `bridge/server.ts:531-559`. |
| Vault failure | Passed | Vault failures return no unfiltered list at `bridge/signer.ts:121-190`. |
| Vault field access | Passed | The code reads only the `public key` field at `bridge/signer.ts:141-179`. |
| Vault concurrency | Passed | Reads use batches of four at `bridge/signer.ts:157-188`. |
| Request limits | Passed | The bridge caps body size and state counts. See `bridge/server.ts:91-108`, `341-342`, and `494-498`. |

Website approval on testnet is an accepted design.

The local digest signer cannot inspect a transaction from its hash.

Neither design is a defect in this scope.

## Accepted limits

Vault membership is a fresh check, not an atomic condition during signing.

The check occurs at `bridge/server.ts:247-251`.

Signing starts at `bridge/server.ts:252-254`.

A vault change during that interval cannot retract a produced signature.

Cancellation also cannot retract a signature.

The bridge correctly returns `unknown` when delivery becomes uncertain.

Evidence: `bridge/server.ts:254-273` and `bridge/server.ts:549-558`.

The bridge stores sessions and requests in memory.

A restart revokes all capabilities and loses all request records.

## Feature opportunity

The global queue serializes review and signing at `bridge/server.ts:214-285`.

A paired site can fill all 32 active slots before another site submits work.

Each request still expires within five minutes.

A one-active-request per-session limit would improve fairness.

This change is useful only if concurrent websites become a supported workflow.

I do not classify this behavior as a current defect.

## Checks

The central offline baseline already passed.

I did not repeat that full baseline.

The supplied baseline records `go test -race ./...` and `bun run test` as passed.

The common brief also records Go vet, TypeScript, 224 Bun tests, and three contract self-tests.

The first targeted run passed four checks and failed ten listener checks.

The sandbox returned `EADDRINUSE` for temporary loopback listeners.

The identical permitted run passed 14 checks.

Two additional resource checks also passed.

| Status | Check | Result |
|---|---|---|
| Passed | Origin separation and token isolation | Selected test passed |
| Passed | Grant pinning and replacement | Selected tests passed |
| Passed | Revision compare-and-set | Selected test passed |
| Passed | Signing switch and cancellation races | Selected tests passed |
| Passed | Invalid XDR and invalid signatures | Selected tests passed |
| Passed | Vault filtering and fresh signing recheck | Selected tests passed |
| Passed | Vault read batch cleanup | Selected tests passed |
| Passed | Shared discovery concurrency | Selected test passed |
| Passed | Pairing lock behavior | Selected test passed |
| Passed | Single review queue | Selected test passed |
| Not run | Live 1Password signing | Not authorized |
| Not run | Public tunnel test | Not authorized |
| Not run | Testnet submission | Not authorized |

The check evidence is `checks/02-bridge-daybreak/targeted-results.json`.

### Commands

```sh
BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-bun-cache bun test bridge/server.test.ts bridge/signer.test.ts bridge/vault.test.ts --test-name-pattern 'two origins|scoped wallets pin|first selection rejects|simultaneous switches|switch during signing|invalid or excessive|cancellation during signing|invalid signatures|concurrent key listings|vault lookup failures|public key reads overlap|failed public key read cancels|real CLI subprocesses|bridge discovery, selection, and signing rechecks'
```

The command ran twice.

The first run used the sandbox.

The second run used permitted loopback access.

```sh
BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-bun-cache bun test bridge/server.test.ts --test-name-pattern 'short codes expire|canceling a queued review'
```

## Primary-source research

All source access occurred on 2026-09-26.

| Source | Version or state | Applicability |
|---|---|---|
| [Stellar network passphrases](https://developers.stellar.org/docs/networks#network-passphrases) | Current official documentation | Confirms network binding inside transaction hashes. |
| [Stellar signatures and multisig](https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig) | Current official documentation | Confirms envelope authorization and unused-signature behavior. |
| [Stellar JavaScript Transaction API](https://stellar.github.io/js-stellar-sdk/Transaction.html) | Official generated API documentation | Confirms `hash()` and `addSignature()` semantics. |
| [CAP-19](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0019.md) | Final, protocol 13 | Defines v1 envelope signature payload behavior. |
| [Transaction result codes](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions) | Current official documentation | Confirms `txBAD_AUTH_EXTRA`. |

The repository pins `@stellar/stellar-sdk` `17.1.0`.

Source evidence uses official documentation and protocol text.

The master-branch JavaScript source served discovery only.

Pinned local behavior passed the targeted tests.

## Research usage

| Tool | Visible usage | Result | Charge |
|---|---|---|---|
| Stellar Raven MCP | Two documentation operations in one execute call | Passed | Unknown |
| `stellar-raven-jev` | One question and three provider requests | Failed transport | `$0.008729397` |
| `parallel-cli` | One logical search, `sku_search` count `1` | Passed | Unknown |
| Parallel Search MCP | One query and ten results | Passed | Unknown |
| Perplexity MCP | One search and ten results | Passed | Unknown |

The known research cost is `$0.008729397`.

Other provider charges were not visible.

The visible known cost stayed below the `$10` lane allocation.

Research artifacts:

- `research/02-bridge-daybreak/stellar-raven-primary.json`
- `research/02-bridge-daybreak/1790471299-0400c960-507f-4bcd-9245-6e7967917e05/search.json`
- `research/02-bridge-daybreak/parallel-cli-signature.json`
- `research/02-bridge-daybreak/parallel-search-mcp.json`
- `research/02-bridge-daybreak/perplexity-search.json`
- `research/02-bridge-daybreak/research-usage.json`

### Research commands

```sh
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
```

All three commands passed.

Doctor reported local readiness without remote authentication validation.

```sh
stellar-raven-jev --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-daybreak --budget-usd 1 search "For Stellar classic transactions, what bytes does a signer sign, how does the network passphrase bind the signature, and how should a raw Ed25519 signature be attached to a v1 envelope? Prefer official Stellar sources relevant to stellar-sdk 17.1.0." --bundle
```

This command failed after three Jev transport failures.

```sh
parallel-cli --help
parallel-cli search --help
```

Both help commands passed.

```sh
parallel-cli search "Find primary Stellar sources that define classic transaction signature payload construction, network passphrase binding, and decorated Ed25519 signature attachment in the JavaScript SDK." -q "site:github.com/stellar/js-stellar-base transaction hash signatureBase addSignature" -q "site:developers.stellar.org transaction network passphrase signatures" --include-domains github.com,developers.stellar.org --json --max-results 10 --excerpt-max-chars-total 27000 -o /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-daybreak/parallel-cli-signature.json
```

The sandbox attempt failed with a connection error.

The identical permitted retry passed with `sku_search` count `1`.

Stellar Raven used one discovery call and one execute call.

The execute call ran two official documentation operations.

Parallel Search MCP used one query with session `02bridge-daybreak-20260926-40d6cca9db732a0d`.

Perplexity MCP used one fast search restricted to official Stellar domains.

Jev returned no source documents.

Its three transport failures consumed `$0.008729397`.

I did not retry the failed Jev question.

## Limits and blockers

The runtime did not expose verifiable active-model metadata.

Strict model attestation remains `inconclusive`.

Jev evidence remains `blocked` by its transport failure.

The other four research paths supplied enough primary evidence.

No live check ran.

The live 1Password, public tunnel, and testnet states remain `not_run`.

The snapshot uses the caller repository's installed dependency tree through its `node_modules` link.

The frozen lockfile pins the relevant SDK version.

No other report informed this conclusion.
