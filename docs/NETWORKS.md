# Networks and hard-coded limits

This file maps each network restriction, hard-coded network value, and hard-coded limit in the repository.
Use it to find the code to change before Walleterm opens mainnet or a custom network.
A change that adds, changes, or removes one of these items must update this file in the same change.
`tests/networks.test.ts` fails when a product file names a testnet value and this file does not name that file.

Each location names a file and a symbol.
This file has no line numbers, because line numbers drift.

## Current policy

- `walleterm sign` signs for any network passphrase. It hashes the exact passphrase bytes. It reads no ledger and calls no RPC.
- The website bridge in `walleterm tunnel` signs only for the testnet passphrase. The rule applies to all four request kinds.
- A message binds no network. For a message, the testnet rule is only a session check.
- The browser SDK accepts only testnet. It refuses a bridge that reports another network.
- The demo website in `walleterm demo` builds, funds, and submits transactions only on testnet.
- The docs and the skills tell users to use dedicated testnet keys. The site tells users to use testnet accounts.
- No signing path contacts a Stellar network. Only the demo website and the test harnesses call RPC, Horizon, or Friendbot.

## Known networks

| Stellar CLI name | Passphrase | Network ID: SHA-256 of the passphrase | Stellar CLI built-in RPC URL |
| --- | --- | --- | --- |
| `testnet` | `Test SDF Network ; September 2015` | `cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472` | `https://soroban-testnet.stellar.org` |
| `futurenet` | `Test SDF Future Network ; October 2022` | `a3a1c6a78286713e29be0e9785670fa838d13917cd8eaeb4a3579ff1debc7fd5` | `https://rpc-futurenet.stellar.org:443` |
| `mainnet` | `Public Global Stellar Network ; September 2015` | `7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979` | None. The CLI tells the user to bring an RPC provider. |
| `local` | `Standalone Network ; February 2017` | `baefd734b8d3e48472cff83912375fedbc7573701912fe308af730180f97d74a` | `http://localhost:8000/rpc` |

The CLI notice calls the first three networks `testnet`, `futurenet`, and `pubnet`. It quotes any other passphrase, `local` included.
The bridge and the SDK call testnet `TESTNET`.

## Rust binary (`src/`)

| Location | What it enforces or states | Current value | Change for mainnet or a custom network |
| --- | --- | --- | --- |
| `src/transaction.rs` `TESTNET` | The one Rust constant for the testnet passphrase. `src/bridge.rs` and `src/cli.rs` import it. | `Test SDF Network ; September 2015` | Keep it. Add a constant for each other network that the code names. |
| `src/bridge.rs` `admit` | Refuses a request of any kind with another passphrase: `network_unsupported`, "Walleterm signs only on Stellar testnet." | Testnet only | Replace the equality test with the accepted networks. Change the message. |
| `src/bridge.rs` `Bridge::route` (`GET /v1/account`) and `Bridge::select` | Each reply returns `"network": "TESTNET"` and the testnet passphrase. | Fixed | Return the network of the session or the tunnel. The SDK checks this value. |
| `src/transaction.rs` `details` | Sets the review detail `network` to `TESTNET` for testnet. For another network, it is the raw passphrase. The parity vectors record it. | `TESTNET` or the passphrase | Add names for other networks if a review needs them. |
| `src/cli.rs` `network_name` | Names the network in the CLI notice. It quotes an unknown passphrase. | `testnet`, `pubnet`, `futurenet` | None. A custom network shows as a quoted passphrase. |
| `src/cli.rs` `HELP` | "Tunnel starts the testnet signing bridge." | Text | Change the text. |
| `src/tunnel.rs` `launch` | Prints "Walleterm tunnel is ready on Stellar testnet." The demo prints the same text with its own label. | Text | Print the active network. The demo line follows the demo website. |
| `src/service.rs` `parse_options` | `walleterm tunnel` takes only `--port` and `--vault`. No input selects a network. | None | A bridge network other than testnet needs a source. See [Opening other networks](#opening-other-networks). |
| `src/preimage.rs` `inspect` | Refuses a preimage whose network ID differs from SHA-256 of the passphrase: `network_unsupported`. | Any network | None. It checks consistency, not testnet. |
| `src/util.rs` `valid_passphrase` | A passphrase is not blank and has at most 256 UTF-16 code units. `transaction.rs`, `authorization.rs`, and `cli.rs` use it. | Any network | None. |
| `src/bridge.rs` `reason_info` | Maps `network_unsupported` to SEP-43 code `-3` and HTTP 400. | Any network | None. |

## Browser SDK (`sdk/`)

| Location | What it enforces or states | Current value | Change for mainnet or a custom network |
| --- | --- | --- | --- |
| `sdk/walleterm.ts` `Walleterm.#ready` | The default `networkPassphrase` is `Networks.TESTNET`. Another value returns `network_unsupported` before a request. `signTransaction`, `signAuthEntry`, `signMessage`, and `signAuthorization` call it. | Testnet only | Accept the session network. Choose a default. |
| `sdk/walleterm.ts` `WalletermClient.readAccount` | Refuses an account reply with another passphrase: "The tunnel reported a network other than testnet." | Testnet only | Accept the network that the bridge reports. |
| `sdk/walleterm.ts` `WalletermClient.signer` | The request passphrase must equal the account passphrase. The message says "Walleterm signs only on Stellar testnet." | Session network | Change the message only. |
| `sdk/walleterm.ts` `Walleterm.getNetwork` | Always returns `TESTNET` and `Networks.TESTNET`. It needs no session. | Fixed | Return the session network. Decide the reply without a session. |
| `sdk/walleterm.ts` `AddressChange` and `Walleterm.#publish` | The type fixes `network: 'TESTNET'`. Each change reports testnet. | Fixed | Widen the type. Report the session network. |
| `sdk/kit.ts` `WalletermModule.onChange` | Reports `TESTNET` and `Networks.TESTNET` for an ended session. | Fixed | Report the session network. |
| `sdk/connect.ts` `WalletermConnect` | Shows a "Testnet" badge and "Select a dedicated testnet wallet from 1Password." | Text | Show the session network. |
| `sdk/transaction.ts`, `sdk/authorization.ts`, `sdk/preimage.ts` | They hash the passphrase that they receive. `inspectAuthPreimage` refuses another network ID. | Any network | None. |
| `sdk/errors.ts` | Maps `network_unsupported` to `-3` and HTTP 400. | Any network | None. |

## Demo website (`demo/site/`, `src/demo.rs`)

| Location | What it enforces or states | Current value | Change for mainnet or a custom network |
| --- | --- | --- | --- |
| `demo/site/app.ts` `HORIZON` and `horizon` | Reads accounts, recipients, offers, ledgers, and results. Submits classic transactions. | `https://horizon-testnet.stellar.org` | A Horizon URL for each network. |
| `demo/site/app.ts` `sourceAccount` | Funds a missing account through Friendbot. | `https://friendbot.stellar.org/?addr=` | Mainnet has no Friendbot. A local network serves it at `/friendbot` on its host. |
| `demo/site/app.ts` `ISSUER` | The trustline action trusts USDC from this issuer. The offer action buys it. | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, the testnet USDC issuer | Each network has its own issuers. |
| `demo/site/app.ts` `testnetFetch` | Replaces a browser network error from Horizon, Friendbot, or Soroban RPC with "The demo could not reach testnet." | The three testnet origins | Match the chosen hosts and text. |
| `demo/site/index.html` `usdc-faucet` | Links to Circle's testnet USDC faucet after the trustline is ready. | `https://faucet.circle.com` | Mainnet has no faucet. Remove the line. |
| `demo/site/app.ts` `build` and the other parsers | `Networks.TESTNET` for each build, parse, and hash. | Testnet | Use the chosen passphrase. |
| `demo/site/contracts.ts` `CONTRACT_RPC` and `demoRpc` | Simulates, sends, and reads contract calls. | `https://soroban-testnet.stellar.org` | An RPC URL for each network. Stellar CLI has no built-in mainnet RPC. |
| `demo/site/contracts.ts` `build`, `deployment`, `signDemoAuthorization`, and the XDR parsers | `Networks.TESTNET` for builds, contract IDs, and authorization preimages. | Testnet | Use the chosen passphrase. Contract IDs change with the network ID. |
| `demo/site/contracts.ts` `DEMO_WASM` | The demo uploads and deploys its own contracts by WASM hash. It has no fixed contract ID. | Two SHA-256 hashes | None for the hashes. An upload costs real fees on mainnet. |
| `demo/site/activity.ts` `ActivityHistory.wrapFetch` and `categories` | Logs only the testnet Horizon, Friendbot, and Soroban RPC origins. Names RPC calls by method. Labels: "Fund testnet account", "Read testnet account", "Read testnet data", and "Testnet". | Testnet hosts | Match the chosen hosts and names. |
| `demo/site/index.html` and `demo/site/app.ts` status text | "Stellar testnet", "Submit to testnet", and testnet account notes. | Text | Change the copy. |
| `demo/site/walkthrough.ts` step labels | "Submit to testnet", "Waiting for the testnet result.", and "Testnet rejected it". | Text | Change the copy. |
| `demo/site/app.ts` `Journal` | The saved request records store no network. Recovery reads the current endpoints. | None | Store the passphrase. Refuse to recover a record from another network. |
| `src/demo.rs` `CSP` | `connect-src` permits any HTTPS host and loopback HTTP. | Any HTTPS host | An RPC on `localhost` fits. A plain HTTP RPC on another host fails. The RPC must also send CORS headers. |

## Skills (`.agents/skills/`)

| Location | What it states | Change |
| --- | --- | --- |
| `.agents/skills/walleterm/SKILL.md` | "Use dedicated keys. Use testnet unless the user's grant names another network." | Change with the bridge network support. |
| `.agents/skills/walleterm-site-bridge/SKILL.md` | The description names "Stellar testnet websites". The review step confirms the `Test SDF Network ; September 2015` passphrase. "Use dedicated testnet keys." | Change with the bridge. |
| `.agents/skills/walleterm-site-bridge/agents/openai.yaml` | `short_description` names testnet sites. | Change with the bridge. |
| `.agents/skills/walleterm-site-bridge/references/service.md` | "The bridge supports testnet only." "Mainnet fails before signing." The example uses the testnet passphrase. | Change with the bridge and the SDK. |
| `.agents/skills/walleterm-site-bridge/references/message-signing.md` | "The testnet rule therefore does not limit it." "Connect only dedicated testnet keys." | Change with the bridge. |
| `.agents/skills/walleterm-site-bridge/references/freighter.md` and `.agents/skills/walleterm-site-bridge/scripts/freighter-page.ts` `TESTNET` | The helper supports only testnet. It answers network requests with `TESTNET`, the testnet passphrase, and the testnet Horizon URL. It hashes with the testnet passphrase. | Add each accepted network. |

## Docs and site copy

| Location | What it states | Change |
| --- | --- | --- |
| `AGENTS.md` "Work process", `CONTRIBUTING.md` "Rules" | "Use dedicated testnet accounts and contracts. Never use mainnet funds." | A project rule. Change it only with the user's approval. |
| `docs/BRIDGE-PROTOCOL.md` | The introduction, "Errors", "Approval", "Transaction envelopes", "Authorization preimages", and "Messages" state testnet only. | Change with the bridge. |
| `docs/SEP-43.md` | The summary, "Network", the transaction policy, the Kit notes, and the deviations state testnet only. The testnet network ID limits a relayed SEP-45 challenge to testnet services. | Change with the SDK. |
| `docs/INTERFACE.md` | The command text says that `tunnel` is the testnet bridge. The sign section says that the CLI accepts any network. The notice examples use testnet. | Change the tunnel text with the bridge. |
| `docs/WEB-BRIDGE.md` | The setup uses testnet, Friendbot, and the testnet USDC issuer. "Add end-to-end encryption before any mainnet use." | Change with the bridge and the demo. |
| `docs/DEMO.md`, `docs/CONNECTION-UI.md` | The demo and the connection component use testnet. | Change with the demo and the SDK. |
| `docs/CONTRACT-AUTHORIZATION.md` | The demo steps say "Submit to testnet". The code examples use `Networks.TESTNET`. | Change with the demo. |
| `docs/AGENTIC-PAYMENTS.md` | The website x402 flow goes through the bridge, so it works on testnet only. "The project rules permit testnet only." | Change with the bridge. |
| `docs/STELLAR-CLI.md` | The digest section gives the testnet network ID as an example. | None. The CLI path accepts any network. |
| `SECURITY.md` | "Use testnet accounts and dedicated test keys to show the problem." | None. Reports stay on testnet. |
| `docs/LIVE-TESTS.md` | The live suites run on testnet with Friendbot funding. | None. Live tests stay on testnet. |
| `README.md` | The website bridge signs for testnet only. The CLI example uses `--network testnet`. | Change with the bridge. |
| `site/index.html` | No network text. | None. |
| `Casks/walleterm.rb` | No network text. | None. |

`docs/KEY-STORES.md`, `docs/SECURE-ENCLAVE.md`, `docs/1PASSWORD-VIDEO.md`, and `design/reference/README.md` name testnet only in research records, examples, and art labels.
They state no restriction.

## Hard-coded limits

No limit below depends on the network, unless the last column says so.
`docs/INTERFACE.md` and `docs/BRIDGE-PROTOCOL.md` state most of these values.
`docs/SEP-43.md`, `docs/WEB-BRIDGE.md`, `docs/CONNECTION-LIFECYCLE.md`, `docs/CONNECTION-UI.md`, `docs/DEMO.md`, `CONTRIBUTING.md`, the site-bridge skill, and `site/index.html` repeat some of them.
Update those statements in the same change.

### Signing core and CLI

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `src/http.rs` `MAX_BODY`, `src/cli.rs` `MAX_INPUT` | 393216 bytes | CLI standard input and bridge request body | No |
| `src/cli.rs` `DEADLINE`, used by `src/main.rs` | 120 seconds | One absolute deadline for CLI input, agent connection, listing, and signing | No |
| `src/transaction.rs` `MAX_TRANSACTION_XDR` | 262144 characters | Transaction XDR | No |
| `src/transaction.rs` `MAX_EXISTING_SIGNATURES` | 19 | The protocol permits 20 envelope signatures. The selected key adds one. | No |
| `src/transaction.rs` `inspect` | A nonzero `max_time` at or before now fails | Expired transaction | No |
| `src/preimage.rs` `MAX_PREIMAGE_XDR`, `src/authorization.rs` `MAX_AUTH_XDR` | 32768 characters each | Preimage and entry XDR | No |
| `src/authorization.rs` `MAX_CONTEXTS`, `MAX_DEPTH` | 256 contexts, 32 levels | Invocation tree | No |
| `src/authorization.rs` `expiration_set` | Expiration ledger 0 fails | The only authorization expiry rule | No |
| `src/message.rs` `MAX_MESSAGE` | 1–1024 UTF-8 bytes | SEP-53 text | No |
| `src/util.rs` `valid_passphrase` | Not blank, at most 256 UTF-16 code units | Passphrase | No. A custom passphrase must fit. |
| `src/stellar.rs` `XDR_DEPTH` | 500 | XDR decoder depth, equal to the Soroban host limit | No |
| `src/agent.rs` `MAX_FRAME`, `MAX_IDENTITIES` | 1 MiB, 1024 identities | SSH agent responses | No |

### Bridge (`src/bridge.rs`)

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `new_code` | 8 decimal digits | Connection code | No |
| `CODE_LIFETIME_MS` | 5 minutes | Code rotation | No |
| `SWEEP` | 1 second | Wall-clock check of code, session, and pending request deadlines | No |
| `MAX_ATTEMPTS`, `CODE_LOCKOUT_MS` | 5 incorrect codes, then a 1-minute pause | Code guessing | No |
| `UNSELECTED_SESSION_MS` | 5 minutes | A session without a selected key | No |
| `SELECTED_SESSION_MS` | 1 hour from the first key selection | A session with a key | No |
| `REQUEST_MS`, `Bridge::create` | 5 minutes, or the transaction `max_time` if earlier | Request expiry | No |
| `MAX_SESSIONS` | 64 | Connected websites | No |
| `MAX_ACTIVE` | 32 | Pending, approved, or signing requests in all sessions | No |
| `MAX_PER_SESSION` | 1000 | Request records and early canceled IDs in one session | No |
| `Bridge::route`, `Bridge::create` | 1–64 characters from `A-Z`, `a-z`, `0-9`, `_`, and `-` | Request ID | No |
| `Bridge::dispatch` | 300 seconds | CORS `Access-Control-Max-Age` | No |
| `Bridge::sign_job` | One job at a time | Signing queue | No |
| `production` | 125 seconds | One agent signing call | No |

### HTTP, tunnel, and DNS

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `src/http.rs` `HEADER_TIMEOUT` | 10 seconds | Request header read | No |
| `src/http.rs` `REQUEST_TIMEOUT` | 15 seconds from the request start | Request body read | No |
| `src/http.rs` `serve_connection` | `MAX_BODY` + 65536 bytes | HTTP read buffer | No |
| `src/http.rs` `CONNECT_TIMEOUT` | 10 seconds | Outbound HTTPS connection for tunnel probes | No |
| `src/service.rs` `BridgeService::listen`, `src/demo.rs` `IDLE` | 150 seconds, 15 seconds | Idle connection close for the bridge and the demo | No |
| `src/tunnel.rs` `HEALTH_INTERVAL` | 15 seconds | Public health probe period | No |
| `src/tunnel.rs` `PROBE_TIMEOUT`, `public_probe` | 2.5 seconds, 4096-byte body | One public probe | No |
| `src/tunnel.rs` `URL_TIMEOUT`, `READY_TIMEOUT`, `LISTEN_TIMEOUT` | 30, 45, and 15 seconds | Quick Tunnel URL, public readiness, and the local listener | No |
| `src/tunnel.rs` `MAX_FAILURES` | 6 | Failed probes before a tunnel restart | No |
| `src/tunnel.rs` `MAX_RESTARTS`, `RESTART_WINDOW`, `RECOVERY_DELAY` | 3 restarts in 600 seconds, delays of 2, 4, then 8 seconds | Tunnel recovery | No |
| `src/tunnel.rs` `RETAINED_OUTPUT` | 16384 bytes | Retained `cloudflared` output | No |
| `src/tunnel.rs` `public_ready`, `launch`, `monitor`, `spawn_supervisor_from`, `run_supervisor` | 350 ms poll, 3.5-second close, 60-second status repeat, 3-second and 1-second stops | Process timers | No |
| `src/dns.rs` `LOOKUP_TIMEOUT`, `MAX_MESSAGE`, `MAX_SERVERS`, `MAX_ALIASES` | 2 seconds, 512 bytes, 3 servers, 8 aliases | Direct DNS lookup of the Quick Tunnel name | No |

### 1Password vault discovery (`src/vault.rs`)

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `MAX_OUTPUT` | 1 MiB | Output of one `op` command | No |
| `MAX_ITEMS` | 1024 | SSH key items in one vault | No |
| `LOOKUP` | 100 seconds | Vault lookup after agent discovery. With `AGENT_LIST`, discovery ends within 110 seconds, under the 125-second Cloudflare response limit. | No |
| `allowed_keys_with` | 4 | Concurrent `op read` calls | No |
| `GRACE` | 1.5 seconds | From SIGTERM to SIGKILL for `op` | No |
| `AGENT_LIST` | 10 seconds | Agent listing for discovery | No |

### Browser SDK (`sdk/`)

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `sdk/walleterm.ts` `WalletermClient.request` | 115 seconds for `/v1/signers` and `/v1/select`, 15 seconds for other routes | HTTP request timeout. It stays under the 125-second Cloudflare response limit, because a Cloudflare 524 page has no CORS header. | No |
| `sdk/walleterm.ts` `WalletermClient` constructor | `pollInterval` 1 second by default | Request polling | No |
| `sdk/walleterm.ts` `WalletermClient.retry` | `pollInterval` × 1, 2, 4, then 8, at most 5 seconds | Retry delay after a network error or a 5xx reply | No |
| `sdk/walleterm.ts` `WalletermClient.connect`, `WalletermClient.signArtifact` | 300 seconds by default | Connection and signing | No |
| `sdk/walleterm.ts` `WalletermClient.signArtifact` | 10 seconds, 3 attempts | Cancellation after a failure | No |
| `sdk/walleterm.ts` `inspectMessage` | 1–1024 UTF-8 bytes | SEP-53 text | No |
| `sdk/transaction.ts` `MAX_TRANSACTION_XDR`, `MAX_EXISTING_SIGNATURES`, `verifyTransactionSignature` | 262144 characters, 256 more for a signed result, 19 signatures | The Rust transaction limits | No |
| `sdk/authorization.ts` `MAX_AUTH_XDR`, `countAuthContexts`, `sdk/preimage.ts` `MAX_PREIMAGE_XDR` | 32768 characters, 256 contexts, 32 levels | The Rust authorization limits | No |
| `sdk/transaction.ts` `inspectTransactionRequest`, `sdk/authorization.ts` `inspectAuthEntry` | Not blank, at most 256 characters | Passphrase | No. A custom passphrase must fit. |
| `sdk/connect.ts` `WalletermConnect` | 15-second health check, 300-second connection, 8-digit code field, 1.5-second copy label. The text states the bridge limits: the code expires after 5 minutes, and the connection lasts one hour. | Connection interface | No |
| `sdk/scan.ts` `scanConnection` | 120 seconds | QR code scan | No |

### Demo website (`demo/site/`)

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `demo/site/app.ts` `build`, `demo/site/contracts.ts` `build` | `setTimeout(180)` | Transaction time bounds | No |
| `demo/site/contracts.ts` `prepareContract` | Latest ledger + 60 | Authorization expiration ledger | Yes. The duration follows the ledger close time. |
| `demo/site/app.ts` `requestSignature` | The transaction `max_time`, or the bridge request expiry if earlier. One wall-clock check each second. | Fallback signing deadline | No |
| `demo/site/app.ts` `horizon`, `sourceAccount` | 15 seconds, 30 seconds | Horizon and Friendbot calls | No |
| `demo/site/app.ts` submit handler | 10 attempts, 1 second apart | RPC result polling | No |
| `demo/site/contracts.ts` `MAX_SETS`, `readWalkthrough` | 50 contract sets for each wallet. One `getLedgerEntries` request with 102 keys reads all of them. | Walkthrough state | Yes. An RPC provider can accept fewer keys in one request. |
| `demo/site/app.ts` `build`, `demo/site/contracts.ts` `build` | `fee: '100'` stroops | Transaction fee | Yes. Network settings and surge pricing set the fee. |
| `demo/site/app.ts` `build`, `USDC_LIMIT` | 0.01 XLM payment, 0.1 XLM offer at 10 USDC, 100 USDC trustline limit | Action amounts | Yes. They move real funds on mainnet. |
| `demo/site/code-view.ts` `MAX_HIGHLIGHT_LENGTH`, `MAX_TOKENS` | 50000 characters, 12000 tokens | Code display | No |
| `demo/site/app.ts` walkthrough Copy buttons | 1.5 seconds | "Copied" label | No |

### Maintainer tools (`tools/`)

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `tools/src/budgets.rs` `MAX_BINARY_BYTES`, `MAX_LOCK_PACKAGES`, `MAX_MACOS_PACKAGES` | 10000000 bytes, 160 packages, 130 packages | Release budgets | No |

## Tests and fixtures

Tests and fixtures can stay testnet only. They use dedicated testnet keys or mock keys.
When the bridge or the SDK opens a network, update the tests that assert `network_unsupported` or the testnet text.

| Area | Files | Network use |
| --- | --- | --- |
| Live harness core | `tests/live-utils.ts` | The testnet passphrase, the `soroban-testnet` RPC, the `horizon-testnet` Horizon, and Friendbot. |
| Live runners | `tests/classic.ts`, `tests/cap71.ts`, `tests/cap85.ts`, `tests/contracts.ts`, `tests/extended-contracts.ts`, `tests/openzeppelin-auth-live.ts`, `tests/contract-auth-demo-live.ts`, `tests/cli-pipeline.ts`, `tests/live.ts` | Testnet only. `classic.ts`, `cap71.ts`, and `cap85.ts` assert the testnet passphrase. `cap85.ts` also checks RPC `getNetwork`. `cli-pipeline.ts` uses `--network testnet`. |
| Submission guard | `tests/submission.ts` | Refuses a pending submission from another passphrase. Any network. |
| Offline Bun tests | `tests/*.test.ts`, `tests/browser/*.test.ts` | Mock keys and testnet values. `tests/browser/kit.test.ts`, `sdk-artifact.test.ts`, and `sep43.test.ts` assert `network_unsupported`. |
| Rust tests | `tests/support/mod.rs` `TESTNET`, `tests/bridge.rs`, `tests/cli.rs`, `tests/tunnel.rs`, `tests/vectors.rs` | `tests/bridge.rs` asserts `network_unsupported`. `tests/tunnel.rs` asserts the "ready on Stellar testnet" text. |
| Kit fixtures | `fixtures/kit/check.mts`, `tab.mts`, `tabs.mts`, and `fixtures/kit/live/` | Testnet. `live/page.mts` uses the testnet Horizon and RPC. `live/negatives.mts` asserts that `Networks.PUBLIC` fails. |
| Contract fixtures | `fixtures/README.md`, `fixtures/cap71/README.md`, `fixtures/cap85/README.md` | Records of testnet runs. |
| Evidence | `evidence/` | Records of testnet runs. |
| Test host | `src/bin/walleterm-test-host.rs` | Runs the production bridge rules for the browser tests. It never ships. |

## Opening other networks

This section is the plan to open mainnet and custom networks. It is a plan only. No code follows it yet.
It records the research of 2026-09-29, an independent review of the first draft, and the open decisions.

### Findings

- `walleterm sign` already signs for mainnet and for a custom network. It hashes the exact passphrase and reads no ledger.
  Its limits stay: a passphrase of 1–256 UTF-16 units, no V0 envelope, and only V2 address credentials.
  A message binds no network on any path.
- Only the website path has the testnet rule. It is in `admit`, the bridge replies, the SDK, the connection component, the Kit module, and the demo.
- The bridge and the SDK must change in one release. The current SDK refuses an account reply that is not testnet.
- The bridge has no approval step. Pull request #71 removed the unused `review` field from `Deps`.
  `transaction::details` still builds review details. They name operation types and sources only.
- RPC `getNetwork` on 2026-09-29 reported protocol 28 for mainnet and protocol 29 for testnet and futurenet.
  CAP-71 AddressV2 needs protocol 27, so mainnet accepts the Walleterm authorization formats. A custom network below protocol 27 does not.
  CAP-85 passed on testnet at protocol 28, the mainnet version. See `evidence/protocol-acceptance.json`.
- A Stellar CLI plugin inherits the stored default network.
  With `network = "local"` in `config.toml`, a stub plugin run as `stellar envcheck` received `STELLAR_NETWORK=local` and `STELLAR_NETWORK_SOURCE=use`.
  So `stellar walleterm tunnel` would change its network if Walleterm read `STELLAR_NETWORK`.

### The Stellar CLI model

Stellar CLI 28.1.0 resolves one network from three fields: an RPC URL, optional RPC headers, and a passphrase.

1. `--rpc-url` and `--network-passphrase` define a network directly. `STELLAR_RPC_URL` and `STELLAR_NETWORK_PASSPHRASE` do the same. These take effect even when a name is also set.
2. `--network` or `-n` names a stored or built-in network. `STELLAR_NETWORK` does the same.
3. `stellar network use <name>` stores a default in `config.toml`. The CLI copies it into `STELLAR_NETWORK` only when that variable is unset.
4. With no input, the CLI uses `testnet`.

Other rules:

- An RPC URL without a passphrase fails, even with a name. A passphrase without an RPC URL also fails.
  Commands that never call RPC, such as `tx sign` and `tx hash`, accept a passphrase alone.
- `stellar network add <name> --rpc-url <url> --network-passphrase <passphrase>` stores a custom network.
  Each `--rpc-header "Name: value"` adds an RPC header.
  `STELLAR_RPC_HEADERS` applies only when `--rpc-url` and `--network-passphrase` define the network directly. A stored network uses its own headers.
- The built-in names are `testnet`, `futurenet`, `mainnet`, and `local`. The built-in `mainnet` has no RPC URL. `stellar network ls --long` shows "Bring Your Own".
- The CLI checks the name. It reads a stored file first. It uses a built-in network only when no stored file has that name.
  So a stored network can replace a built-in one, and it can give a built-in name another passphrase.
- A stored network is the file `network/<name>.toml` with `rpc_url`, `rpc_headers`, and `network_passphrase`. It has no Horizon URL and no Friendbot URL.
- The configuration directory is the first of these:
  1. `--config-dir`.
  2. `STELLAR_CONFIG_HOME`, used as the directory itself.
  3. `$XDG_CONFIG_HOME/stellar`, or `$XDG_CONFIG_HOME/soroban` when only that legacy directory exists.
  4. `~/.config/stellar`, with the same `soroban` fallback.
- The CLI no longer reads a `.stellar` directory in the project. It prints a warning that names `stellar config migrate`.
- The CLI finds Friendbot through the RPC `getNetwork` field `friendbotUrl`. For the `local` passphrase, it uses `/friendbot` on the RPC host.
- Stellar Lab adds a Horizon URL to these fields for a custom network.

### Proposed design

| Input | `walleterm tunnel` | `walleterm demo` | `walleterm sign` |
| --- | --- | --- | --- |
| `--network <name>` | Yes | Yes | No change |
| `--network-passphrase <passphrase>` | Yes | Yes, with `--rpc-url` | The `network_passphrase` field, as today |
| `--rpc-url <url>` | No. The bridge makes no RPC call. | Yes, with `--network-passphrase` | No |
| A stored Stellar CLI network | Read only | Read only | No |
| `STELLAR_NETWORK`, `STELLAR_NETWORK_PASSPHRASE`, and the `stellar network use` default | Not read | Not read | Not read |
| No input | testnet | testnet | Not applicable |

- Each flag is explicit, appears once, and is not blank, as `--vault` is. A failure exits with code 2 before startup.
- `--network` and `--network-passphrase` together fail. The CLI lets the passphrase win, but a signing network must be clear.
- Walleterm reads the Stellar CLI configuration directory in the CLI order. It never writes it. Users add a network with `stellar network add`.
- Walleterm ignores the environment and the stored default on purpose, as `--vault` ignores `OP_VAULT`. The network of a signing bridge is a consequential choice.
  The docs must state this difference from the CLI.
- Each tunnel process serves one network. The startup text, the QR payload, `/api/session`, `/v1/connect`, `/v1/select`, and `/v1/account` state it.
  Two networks need two tunnels.

Every rule keys on the resolved passphrase, never on the name.

- Test networks have the testnet, futurenet, or standalone passphrase. `Standalone Network ; February 2017` is the `local` passphrase.
- Production networks have the mainnet passphrase or any other passphrase. A custom network can hold real value, so it gets the mainnet controls.

Names are display text. The passphrase is the only signing identity.

- Terminal text uses the Stellar CLI names `testnet`, `futurenet`, `mainnet`, and `local`.
  A stored custom network shows its name and the escaped passphrase. A passphrase from `--network-passphrase` shows as an escaped quote.
- SEP-43 defines `network` as a free string. Proposal: the Stellar SDK `Networks` keys `TESTNET`, `FUTURENET`, `PUBLIC`, and `STANDALONE`.
  The Stellar Wallets Kit uses the same keys. A stored custom network reports its stored name.

### Phase 1: network plumbing for the test networks

Rust:

- A new `src/network.rs` holds the built-in table, resolution, the stored-network lookup, the network class, and one `name` function.
  It replaces `transaction::TESTNET`, `cli::network_name`, and the name in `transaction::details`. Add it to the code layout in `AGENTS.md`.
- Stored networks need a TOML reader, probably the `toml` crate. Pin it, then measure the package counts and the binary before you accept it.
  On 2026-09-29, the lockfile had 135 of 160 packages, and macOS resolved 114 of 130. The binary limit is 10000000 bytes.
- `service::parse_options` accepts the flags in the table.
- `Bridge::new` takes the network. `admit` compares each request with it.
  `Bridge::pairing`, `/api/session`, `Bridge::select`, and `/v1/account` report it. `PROTOCOL` becomes 4.
- A production passphrase stops `walleterm tunnel` at startup with a plain message. This rule stays until Phase 2 ends.
- `tunnel.rs` `launch` prints the network name and the passphrase. `cli.rs` `HELP` and the notice use the Stellar CLI names.
  The notice keeps the escaped quote for an unknown passphrase.
- `src/bin/walleterm-test-host.rs` takes a network, so browser tests can use each network class.

SDK:

- Protocol 4 applies in `sdk/scan.ts`, the manual path in `WalletermClient.connect`, and the saved session.
  The saved session stores `version: 3` today.
  Manual pairing posts to `/v1/connect` and checks no version. The SDK never reads `/api/session`.
  So `/v1/connect` returns the protocol and the network.
- An optional `new Walleterm({ networkPassphrase })` names the network that the website expects.
  The SDK checks it in each account path: `readAccount`, `selectWallet`, a restore, and a change from another tab.
  `WalletermClient.selectWallet` sets the account with no network check today.
- `#ready` and `signer` default to the session network. `getNetwork` returns it.
- `AddressChange.network` becomes `string`. `#publish` reports a network change, even when the address stays the same.
- The Kit starts on `Networks.PUBLIC` and sends its own passphrase to each signing call.
  A Kit website sets the Kit network from `getNetwork()`. Update the Kit example in `docs/SEP-43.md` and the Kit checks.
- `sdk/connect.ts` shows the network before the code step and a network badge after pairing. A production network gets a distinct badge.

Tests:

- Rust: resolution order, a stored file in a temporary configuration directory, a stored `testnet` with the mainnet passphrase,
  flag conflicts, admission for each network, the QR payload, and the tunnel text.
- SDK and browser: a bridge on another network, each account path, the change event, and the Kit.
- Signing vectors with mock keys for futurenet, standalone, mainnet, and a custom passphrase. They need no funds.

### Phase 2: controls for production networks

The bridge refuses production networks until each control exists and passes an independent review.

1. Approval in the tunnel terminal.
   A connected website approves each request when it sends it. "The connection code is the only gate." The 1Password prompt shows no artifact.
   Add an approval step to `Bridge::sign_job` before the agent call. The terminal shows each request and waits for an explicit answer.
   The display names the origin, the key, the kind, the network, and the hash. It also decodes the content:
   - A transaction: each operation with its destination, amount, asset, and arguments, and the memo and the fees.
   - An authorization: the contract, the function, and the arguments of each invocation.
   - A message: the escaped text and the session network.

   The step denies a request that it cannot display. A denial ends the request as `denied` with `-4`.
   Messages need approval on every network. A SEP-53 signature works on all networks, so a testnet session can get one from a funded key.
   This display overlaps the decoded notice that the user deferred on 2026-09-29. It needs the user's decision.
2. Transport.
   Cloudflare terminates TLS. It can read the connection code, the bearer token, and each artifact.
   The bridge requires the connected Origin. A program outside a browser can send that header, so a party with the token can send requests.
   Encryption does not protect against the connected website or a script in it. Approval is the main control. The transport is a second layer.
   `docs/WEB-BRIDGE.md` requires end-to-end encryption before any mainnet use. The user decides if that stays a hard gate.
   CPace on ristretto255 with the 8-digit code is a candidate. It is still an IETF draft. The design must state these points:
   - Identity binding to the tunnel, the network, the session, and the protocol version.
   - Key confirmation and a separate key for each direction.
   - Nonce rules, replay rejection, retries, and session restore.
   - Attempt limits, and no unencrypted fallback on a production network.
   - Test vectors that the Rust code and the browser both pass, and an independent review.

   Rust has `curve25519-dalek` through `ed25519-dalek`. An AEAD crate would be new.
   The SDK needs `@noble/curves` and an AEAD, such as `@noble/ciphers` or WebCrypto AES-GCM.
3. Login challenges.
   A SEP-10 challenge passes the bridge rules. The selected key is a `manageData` source, and no rule checks sequence 0.
   A SEP-45 challenge passes when it uses AddressV2 entries and a supported adapter. It can arrive as `auth_entry` or as `authorization`.
   On a production network, a website can relay the challenge of a real service and sign in as the user.
   A rule that the home domain equals the Origin host is wrong. A wallet website signs in to an anchor that has another domain.
   The approval display names the login service instead. Tests cover both SEP-45 request kinds.
4. Key isolation.
   Without `--vault`, the bridge offers every Ed25519 agent key, SSH login keys included. A production network requires `--vault`.
5. Review and release.
   An independent reviewer checks each control. Then the bridge opens production networks.
   `fixtures/kit/live/negatives.mts` changes too. It asserts today that `Networks.PUBLIC` fails.

### Phase 3: the demo on other networks

This phase is optional. It ships apart from the bridge.

- `walleterm demo --network <name>` sends the passphrase, the RPC URL, and the Friendbot URL to the page. A new route carries them.
  Today the demo serves its assets and `/api/session` only.
- Before it funds, builds, or submits, the page checks that RPC `getNetwork` and the bridge both report the expected passphrase.
- The request journal stores the passphrase. The page refuses to recover a record from another network.
- The demo uses Horizon to read accounts, recent operation sources, offers, ledgers, and results, and to submit classic transactions.
  A Stellar CLI network has no Horizon URL. RPC cannot list the offers of an account or recent operation sources.
  So choose one: keep Horizon with a Horizon URL for each network, or make the demo actions smaller.
- Funding uses the RPC `getNetwork` field `friendbotUrl`, or `/friendbot` on the RPC host for `local`. Without Friendbot, the account must hold funds.
- A USDC issuer and faucet table covers each network. Without an entry, the page hides the trustline, the offer, and the faucet line.
- The fee comes from RPC. The demo sends a fixed `'100'` today.
- `testnetFetch` and `activity.ts` take their hosts and text from the configuration.
- The demo refuses RPC headers and credentials inside RPC URLs. The tunnel makes the page public, so every visitor would receive them.
- A phone cannot reach an RPC URL on `localhost`. A stored `local` network with a remote RPC URL works.
- Proposal: the demo refuses production networks. Its actions move funds and upload test contracts.

### Phase 4: docs, skills, and the inventory test

- Change each row in the tables above with the component that it describes.
- `tests/networks.test.ts` reads only product files. Widen its file set to the docs and the skills, and match the mainnet passphrase too.
  Keep the records of past testnet runs unchanged.
- The `walleterm` skill gets the passphrase from `stellar network ls --long`. It states the network in each plan.
  A production network needs an explicit grant.
- Update each `walleterm-site-bridge` reference and `freighter-page.ts`.
- `site/` has no network text now. If that changes, change the Paper design first.

### Acceptance

- Offline tests with mock keys cover each network class. They need no funds.
- Live tests stay on testnet, because `AGENTS.md` permits live tests only there.
  A futurenet, local, or mainnet run needs the user's approval. Keep one live runner at a time.

### Decisions to make

These are open choices. The user makes them.

1. Scope. Proposal: the bridge and the SDK open production networks after Phase 2. The demo stays on test networks.
2. Test networks. Proposal: exactly the testnet, futurenet, and standalone passphrases. Every other passphrase gets the production controls.
3. Network input. Proposal: flags and stored names only, as the table shows. The alternative is the full CLI order with `STELLAR_NETWORK` and the stored default.
4. Stored networks. Proposal: add a TOML reader. The alternative is the built-in names and `--network-passphrase` only.
5. Names. The SEP-43 name of a custom network. The `getNetwork` reply before a session: the expected network, or `-3` with `walleterm:not_connected`.
6. Approval. Proposal: terminal approval of each production request, and of each message on every network, with the full decoded display.
7. Transport. Encryption as a hard gate, encryption as a later layer, or a production bridge on loopback only, with no tunnel.
8. Protocol versions. Proposal: Phase 1 ships protocol 4, and the transport ships protocol 5. Forward-only work before 1.0 permits two changes.
   The alternative is to design the transport first and change the protocol once.
9. Live tests on futurenet, local, or mainnet.

### Order of changes

1. This plan. Record the decisions and the user's approval in this file.
2. Phase 1. The bridge, the SDK, the connection component, their tests, and their docs change in one pull request.
3. Phase 2. First the approval step, then key isolation and the login display, then the transport.
   The last pull request opens production networks.
4. Phase 3, if the user wants the demo on other networks.
5. Phase 4 with each pull request, then one final check of this file.

### Independent review

On 2026-09-29, two reviewers checked the first draft of this plan in read-only Codex sessions.
They were GPT-6 Astra (`gpt-6-astra`) and GPT-6.1 Sol (`gpt-6.1-sol`), both at high reasoning effort.
Each reviewer treated the draft as wrong and checked each claim in the code and in primary sources. The author then checked each finding.
Both reviewers found the same main faults. This version has these corrections:

- The rules key on the resolved passphrase. A custom network counts as a production network.
- Approval is the main control, because encryption does not protect against the connected website.
- The approval display must decode each request.
- CPace is a candidate, not a complete transport design.
- A stolen token needs the connected Origin. A program outside a browser can send it.
- The draft proposed a login rule that the home domain equals the Origin host. That rule is gone, because it blocks normal anchor logins.
- CAP-85 needs no mainnet recheck.
- The Stellar CLI configuration order and header rules are now complete.
- The SDK plan covers each account path, the change event, manual pairing, and the saved session.
- The Kit network needs its own step.
- The demo plan covers the RPC gaps, the journal, the CSP, and credentials in URLs.
- Futurenet and local live runs need the user's approval.
- The inventory test reads no docs.
- Dependency estimates need a measurement.

The author did not accept two findings.
The demo contract ID cache omits the network, but it lives in page memory for one network. So the risk is low.
One statement about Freighter network names was unclear. The names stay a decision.
Pull request #71 removed the unused `review` field after the review. So Phase 2 adds a new approval step.

### Sources

- Stellar CLI 28.1.0, commit `c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd`. This is the CI version.
  The inventory used `stellar network --help`, `stellar network add --help`, and `stellar network ls --long` with an empty `--config-dir` on 2026-09-28.
  On 2026-09-29, the same commands gave the same output with 28.1.0, except one help alias label.
- Stellar CLI source at tag `v28.0.0`, read through the GitHub API on 2026-09-28. These parts did not change in `v28.1.0`:
  `cmd/soroban-cli/src/config/network.rs` (`Args::resolve`, `DEFAULTS`, `Network::helper_url`), `config/network/passphrase.rs`,
  `config/locator.rs` (`read_network`), and `cli.rs` (`set_env_from_config`, `set_env_value_from_config`).
- The `soroban-cli` 28.1.0 crate source, read on 2026-09-29: `config/network.rs` (`Args::resolve`),
  `config/locator.rs` (`read_network`, `global_config_path`, `read_with_global_with_location`), and `commands/plugin/default.rs`.
- Local checks with Stellar CLI 28.1.0 on 2026-09-29: the stub plugin, a project `.stellar` directory, `XDG_CONFIG_HOME`, and `STELLAR_CONFIG_HOME`.
- RPC `getNetwork` and `getLatestLedger` on 2026-09-29: `https://mainnet.sorobanrpc.com`, `https://soroban-testnet.stellar.org`, and `https://rpc-futurenet.stellar.org`.
- Stellar Wallets Kit 2.7.0 in `fixtures/kit/`: `script/sdk/kit.js` (`signTransaction`), `script/state/values.js` (`selectedNetwork`), and `esm/types/mod.js` (`Networks`).
- The reviewers read SEP-10, SEP-43, and SEP-45 in `stellar-protocol`, the CPace Internet-Draft `draft-irtf-cfrg-cpace`,
  and the Stellar guide "Migrate from Horizon to RPC".
- Stellar Raven `stellarDocs` search on 2026-09-28: the Stellar CLI manual for `stellar network add`, and the Stellar Lab custom network fields.
  The Stellar Lab overview states that Friendbot funds accounts on Testnet and Futurenet.
- Network IDs: `shasum -a 256` of each passphrase.
