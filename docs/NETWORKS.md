# Networks and hard-coded limits

This file maps each network restriction, hard-coded network value, and hard-coded limit in the repository.
Use it to find the code to change before Walleterm opens mainnet or a custom network.
A change that adds, changes, or removes one of these items must update this file in the same change.
`tests/networks.test.ts` fails when a product file names a testnet value and this file does not name that file.

Each location names a file and a symbol.
This file has no line numbers, because line numbers drift.

## Current policy

- `walleterm sign` signs for any network passphrase. It hashes the exact passphrase bytes. It reads no ledger and calls no RPC.
- The website bridge in `walleterm tunnel` signs for one network. It is testnet by default, or the network of `--network` or `--network-passphrase`.
  The rule applies to all four request kinds. On mainnet and custom networks, each request waits for `walleterm approve`.
- A message binds no network. For a message, the tunnel network is only a session check.
- The browser SDK follows the tunnel network. Each account reply names it. Without a session, the SDK knows no network.
- The demo website in `walleterm demo` builds, funds, and submits transactions only on testnet. It sends no request to a tunnel on another network.
- The docs and the skills tell users to use dedicated test keys. The site tells users to use testnet accounts.
- No signing path contacts a Stellar network. Only the demo website and the test harnesses call RPC, Horizon, or Friendbot.

## Known networks

| Stellar CLI name | Passphrase | Network ID: SHA-256 of the passphrase | Stellar CLI built-in RPC URL |
| --- | --- | --- | --- |
| `testnet` | `Test SDF Network ; September 2015` | `cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472` | `https://soroban-testnet.stellar.org` |
| `futurenet` | `Test SDF Future Network ; October 2022` | `a3a1c6a78286713e29be0e9785670fa838d13917cd8eaeb4a3579ff1debc7fd5` | `https://rpc-futurenet.stellar.org:443` |
| `mainnet` | `Public Global Stellar Network ; September 2015` | `7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979` | None. The CLI tells the user to bring an RPC provider. |
| `local` | `Standalone Network ; February 2017` | `baefd734b8d3e48472cff83912375fedbc7573701912fe308af730180f97d74a` | `http://localhost:8000/rpc` |

`src/network.rs` `BUILT_IN` holds these four networks. The CLI notice and the tunnel use the Stellar CLI names. The notice quotes any other passphrase.
The bridge and the SDK use the Stellar SDK `Networks` keys: `TESTNET`, `FUTURENET`, `STANDALONE`, and `PUBLIC`.

## Rust binary (`src/`)

| Location | What it enforces or states | Current value | Change for mainnet or a custom network |
| --- | --- | --- | --- |
| `src/network.rs` `BUILT_IN`, `TESTNET`, `DEFAULT`, `named`, `custom`, and `Network::is_test` | The four built-in networks with their names and passphrases. `custom` makes a `CUSTOM` network from any other passphrase. `is_test` is true for testnet, futurenet, and local only. | Any network | None. |
| `src/bridge.rs` `admit` | Refuses a request of any kind for another network: `network_unsupported`. A testnet tunnel says "Walleterm signs only on Stellar testnet." | The tunnel network | None. |
| `src/bridge.rs` `Bridge::route` (`GET /v1/account`) and `Bridge::select` | Each reply returns the SEP-43 name and the passphrase of the tunnel network. | The tunnel network | None. |
| `src/transaction.rs` `details` | Sets the review detail `network` to `TESTNET` for testnet. For another network, it is the raw passphrase. The parity vectors record it. | `TESTNET` or the passphrase | Add names for other networks if a review needs them. |
| `src/cli.rs` `network_name` | Names the network in the CLI notice with its Stellar CLI name. It quotes an unknown passphrase. | `testnet`, `futurenet`, `local`, `mainnet` | None. A custom network shows as a quoted passphrase. |
| `src/cli.rs` `HELP` | Names the tunnel networks, `--network-passphrase`, `--approve`, and `walleterm approve`. | Text | None. |
| `src/tunnel.rs` `Service::network` and `launch` | Prints "Walleterm tunnel is ready on Stellar testnet." with the tunnel network. The demo line stays on testnet. | Text | None. |
| `src/service.rs` `parse_options` | `walleterm tunnel` takes `--network` with a Stellar CLI name, or `--network-passphrase`, and `--approve`. The default is testnet. `walleterm demo` takes no network. | Any network | None. |
| `src/bridge.rs` `Bridge::new`, `wait_for_approval`, `waiting`, and `answer` | Each signature waits for `walleterm approve` on every network that is not a test network, and with `--approve`. A denial is `denied` with `-4`. No answer is `expired`. | Every network that is not a test network | None. |
| `src/approve.rs` `directory`, `Server`, and `command` | The approval socket `~/Library/Application Support/walleterm/approve-<port>.sock` and the `walleterm approve` command. | Any network | None. |
| `src/preimage.rs` `inspect` | Refuses a preimage whose network ID differs from SHA-256 of the passphrase: `network_unsupported`. | Any network | None. It checks consistency, not testnet. |
| `src/util.rs` `valid_passphrase` | A passphrase is not blank and has at most 256 UTF-16 code units. `transaction.rs`, `authorization.rs`, and `cli.rs` use it. | Any network | None. |
| `src/bridge.rs` `reason_info` | Maps `network_unsupported` to SEP-43 code `-3` and HTTP 400. | Any network | None. |

## Browser SDK (`sdk/`)

| Location | What it enforces or states | Current value | Change for mainnet or a custom network |
| --- | --- | --- | --- |
| `sdk/walleterm.ts` `accountNetwork`, `WalletermClient.readAccount`, and `WalletermClient.selectWallet` | Take the network from each account reply. A reply without a network fails. | The tunnel network | None. |
| `sdk/walleterm.ts` `WalletermClient.signer` | The request passphrase defaults to the session passphrase and must equal it. The message names the session network. | Session network | None. |
| `sdk/walleterm.ts` `Walleterm.getNetwork` | Returns the tunnel network. Without a session, it returns `-3` with `walleterm:not_connected`. | Session network | None. |
| `sdk/walleterm.ts` `AddressChange` and `Walleterm.#publish` | Report the session network. A change of network with the same address is a change. A disconnection reports empty network fields. | Session network | None. |
| `sdk/kit.ts` `WalletermModule.onChange` | Reports empty network fields for an ended session. | Empty | None. |
| `sdk/connect.ts` `NETWORKS` and `WalletermConnect.update` | The badge shows Testnet, Futurenet, Local, Mainnet, or Custom network. Mainnet and custom networks get the `wt-network-live` style. | Session network | None. |
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
| `demo/site/app.ts` `connection` `onChange` | Treats a tunnel on another network as no connection, so the page sends it no request. The status says to restart the tunnel without `--network`. | Testnet only | None while the demo stays on testnet. |
| `demo/site/app.ts` `Journal` | The saved request records store no network. Recovery reads the current endpoints. | None | Store the passphrase. Refuse to recover a record from another network. |
| `src/demo.rs` `CSP` | `connect-src` permits any HTTPS host and loopback HTTP. | Any HTTPS host | An RPC on `localhost` fits. A plain HTTP RPC on another host fails. The RPC must also send CORS headers. |

## Skills (`.agents/skills/`)

| Location | What it states | Change |
| --- | --- | --- |
| `.agents/skills/walleterm/SKILL.md` | A test network needs no separate approval. Mainnet and other networks need a grant from the user, which can cover a batch. | None. |
| `.agents/skills/walleterm-site-bridge/SKILL.md` | "Approve requests" gives the agent flow for `walleterm approve`. The review step confirms the tunnel network passphrase. | None. |
| `.agents/skills/walleterm-site-bridge/agents/openai.yaml` | `short_description` names sites and approval. | None. |
| `.agents/skills/walleterm-site-bridge/references/service.md` | The bridge signs for one network. Mainnet and custom networks wait for `walleterm approve`. The example reads the passphrase from `getNetwork()`. | None. |
| `.agents/skills/walleterm-site-bridge/references/message-signing.md` | "The tunnel network rule therefore does not limit it." "Connect only dedicated test keys." | None. |
| `.agents/skills/walleterm-site-bridge/references/freighter.md` and `.agents/skills/walleterm-site-bridge/scripts/freighter-page.ts` `TESTNET` | The helper supports only testnet. It answers network requests with `TESTNET`, the testnet passphrase, and the testnet Horizon URL. It hashes with the testnet passphrase. | Add each accepted network. |

## Docs and site copy

| Location | What it states | Change |
| --- | --- | --- |
| `AGENTS.md` "Work process", `CONTRIBUTING.md` "Rules" | Live runs on a test network need no separate approval. A mainnet run needs the user's approval, which can cover a batch. | A project rule. Change it only with the user's approval. |
| `docs/BRIDGE-PROTOCOL.md` | The introduction, "Errors", "Approval", "Transaction envelopes", "Authorization preimages", and "Messages" state the tunnel network. "Approval" describes `walleterm approve`. | None. |
| `docs/SEP-43.md` | The summary, "Network", the transaction policy, the Kit notes, and the deviations state the tunnel network, `PUBLIC`, and `CUSTOM`. | None. |
| `docs/INTERFACE.md` | The commands, the network options, and "Approve". The sign section says that the CLI accepts any network. | None. |
| `docs/WEB-BRIDGE.md` | The network options and "Approve requests". The demo setup uses testnet, Friendbot, and the testnet USDC issuer. | None. |
| `docs/DEMO.md`, `docs/CONNECTION-UI.md` | The demo uses testnet and refuses another tunnel network. The connection component shows the session network. | None. |
| `docs/CONTRACT-AUTHORIZATION.md` | The demo steps say "Submit to testnet". The code examples use `Networks.TESTNET`. | Change with the demo. |
| `docs/AGENTIC-PAYMENTS.md` | The website x402 flow goes through the bridge. A mainnet tunnel asks for `walleterm approve` before each signature. | None. |
| `docs/STELLAR-CLI.md` | The digest section gives the testnet network ID as an example. | None. The CLI path accepts any network. |
| `SECURITY.md` | "Use testnet accounts and dedicated test keys to show the problem." | None. Reports stay on testnet. |
| `docs/LIVE-TESTS.md` | The live suites run on testnet with Friendbot funding. | None. |
| `README.md` | The website bridge signs for one network. Mainnet and custom networks need `walleterm approve`. The CLI example uses `--network testnet`. | None. |
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

### Approval (`src/approve.rs`)

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `MAX_REQUEST` | 4096 bytes | One request line on the approval socket | No |
| `MAX_REPLY` | 8 MiB | One reply, with the decoded artifact | No |
| `EXCHANGE` | 5 seconds | One socket exchange, from connection to the last reply byte | No |
| `DEFAULT_PORT` | 8787 | The tunnel port that `walleterm approve` uses without `--port` | No |
| `src/artifact.rs` `MAX_REVIEW_DEPTH` | 100 JSON levels | The deepest decode that `walleterm approve` shows. A deeper request can only be denied. | No |

### Maintainer tools (`tools/`)

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `tools/src/budgets.rs` `MAX_BINARY_BYTES` | 10000000 bytes | Release binary | No |

## Tests and fixtures

Tests and fixtures can stay testnet only. They use dedicated testnet keys or mock keys.
When the bridge or the SDK opens a network, update the tests that assert `network_unsupported` or the testnet text.

| Area | Files | Network use |
| --- | --- | --- |
| Live harness core | `tests/live-utils.ts` | The testnet passphrase, the `soroban-testnet` RPC, the `horizon-testnet` Horizon, and Friendbot. |
| Live runners | `tests/classic.ts`, `tests/cap71.ts`, `tests/cap85.ts`, `tests/contracts.ts`, `tests/extended-contracts.ts`, `tests/openzeppelin-auth-live.ts`, `tests/contract-auth-demo-live.ts`, `tests/cli-pipeline.ts`, `tests/live.ts` | Testnet only. `classic.ts`, `cap71.ts`, and `cap85.ts` assert the testnet passphrase. `cap85.ts` also checks RPC `getNetwork`. `cli-pipeline.ts` uses `--network testnet`. |
| Submission guard | `tests/submission.ts` | Refuses a pending submission from another passphrase. Any network. |
| Offline Bun tests | `tests/*.test.ts`, `tests/browser/*.test.ts` | Mock keys and testnet values. `tests/browser/sdk-artifact.test.ts` and `sep43.test.ts` assert `network_unsupported`. `sep43.test.ts` also signs on a futurenet tunnel. `kit.test.ts` asserts `not_connected` without a session. |
| Rust tests | `tests/support/mod.rs` `TESTNET` and `Options`, `tests/approve.rs`, `tests/bridge.rs`, `tests/cli.rs`, `tests/tunnel.rs`, `tests/vectors.rs` | `tests/bridge.rs` asserts `network_unsupported` and signs on futurenet and local bridges. `tests/approve.rs` covers approval on mainnet and custom passphrases with mock keys. `tests/tunnel.rs` asserts the "ready on Stellar testnet" text. |
| Kit fixtures | `fixtures/kit/check.mts`, `tab.mts`, `tabs.mts`, and `fixtures/kit/live/` | Testnet. `live/page.mts` uses the testnet Horizon and RPC. `live/negatives.mts` asserts that `Networks.PUBLIC` fails. |
| Contract fixtures | `fixtures/README.md`, `fixtures/cap71/README.md`, `fixtures/cap85/README.md` | Records of testnet runs. |
| Evidence | `evidence/` | Records of testnet runs. |
| Test host | `src/bin/walleterm-test-host.rs` | Runs the production bridge rules for the browser tests. `WALLETERM_TEST_HOST_NETWORK` names its network. It never ships. |


## Mainnet and custom networks

Two pull requests opened every network. PR 1 opened the test networks. PR 2 opened mainnet and custom networks.

### Decisions

The user approved these decisions on 2026-09-30.

1. Input. `walleterm tunnel --network <name>` takes a Stellar CLI built-in name. `--network-passphrase <passphrase>` takes any other network.
   The bridge needs only a passphrase. So Walleterm reads no Stellar CLI configuration, no `STELLAR_NETWORK`, and no stored default.
   A Stellar CLI plugin inherits the stored default as `STELLAR_NETWORK`, so `stellar walleterm tunnel` ignores that default too.
2. One network for each tunnel. The replies already carried `network` and `network_passphrase`.
   But a version 3 SDK checks the network only in `readAccount`. After a fresh pairing, it reports testnet and signs for the tunnel network.
   So the protocol moved to version 4. `/v1/connect` refuses a client that does not send `"protocol": 4`.
3. Names. The terminal uses the Stellar CLI names. SEP-43 replies use the Stellar SDK `Networks` keys. Any other passphrase is `CUSTOM`.
4. `getNetwork` before a session returns `-3` with `walleterm:not_connected`. The wallet knows no network until the tunnel names it.
5. Approval. On mainnet and on a custom passphrase, each signature waits for `walleterm approve`. `--approve` adds the step on a test network.
   An agent can answer it as well as a human. The review shows the `stellar tx decode` JSON of the exact artifact.
6. Transport. Approval replaces the end-to-end encryption precondition. A forged request gets no signature without an approval.
   Cloudflare can still read the traffic. `docs/WEB-BRIDGE.md` states it.
7. The demo stays on testnet.
8. Live runs follow `AGENTS.md`: a test network needs no separate approval. A mainnet run needs the user's approval, which can cover a batch.

### PR 1: futurenet and local

- `src/network.rs` holds the built-in networks. `walleterm tunnel --network testnet|futurenet|local` selects one. Testnet is the default.
- The bridge admits requests for its network only. Its replies and its ready line name that network. The protocol is version 4.
- The SDK takes the network from the account reply. Requests default to it. `getNetwork` reports it.
- The connection component shows the network. The demo sends no request to a tunnel on another network.
- The CLI notice uses the Stellar CLI names `mainnet` and `local` in place of `pubnet` and a quoted passphrase.

### PR 2: mainnet, custom networks, and `walleterm approve`

- `walleterm tunnel` accepts `--network mainnet`, `--network-passphrase <passphrase>`, and `--approve`.
  A built-in passphrase from `--network-passphrase` acts as that built-in network. A custom passphrase is `CUSTOM`.
- `Bridge::new` decides approval from the resolved passphrase. `--approve` can only add it. No input removes it.
- `Bridge::wait_for_approval` runs before admission, so admission uses the time after the answer.
  The request stays `pending`. The job signal ends the wait on a cancel, a wallet change, a disconnection, an expiry, or shutdown.
  A denial ends the request as `denied` with `-4`. No answer before the request expires ends it as `expired` with `-3`.
- The approver answers the bridge's random record ID, not the hash. A hash does not bind the signer or the origin,
  so two waiting requests in turn can share one hash.
- The tunnel line names the request and the command `walleterm approve`, but not the ID. The ID comes only with the full decode.
- `walleterm approve` polls. It prints the waiting request, or approves or denies one ID. It has no wait mode and no typed answer in the tunnel.
- The socket lives in `~/Library/Application Support/walleterm`, from the account database. The directory has mode 0700.
  The tunnel binds its TCP port first, then replaces a stale socket for that port. It checks the peer user ID with tokio `peer_cred`.
  It removes only the socket that it created. A socket failure stops startup before the public tunnel opens.
- The decode uses the `serde` feature of `stellar-xdr`, the crate and output that `stellar tx decode` uses.
  On 2026-09-30, the feature added 43 resolved macOS packages (114 to 157) and 60 lockfile packages (135 to 195).
  A release build that decodes each envelope grew from 5645520 to 5816944 bytes.
  The package counts in `tools/src/budgets.rs` came from the Rust migration and had no other reason, so PR 2 removed them.
  The binary limit and `cargo deny` stay.
- The connection badge shows Mainnet or Custom network in a warm color. The picker text says that these networks wait for approval.
- GPT-6 Astra, Fable 5.1, and Grok 4.7 reviewed this design before the code. Their findings set the ID, the wait position, the terminal line,
  the socket checks, and the cuts.

### History

PR #72 recorded a larger first plan. GPT-6 Astra and GPT-6.1 Sol reviewed it independently.
The user then chose these two pull requests. The approval step covers the risks that the larger plan handled separately:
a forged request through the tunnel, a relayed login challenge, and a message signature from a funded key.
The cut items were stored Stellar CLI networks, an encrypted transport, demo network support, and login-challenge rules.
The independent review of PR 1 showed that a protocol change was still necessary. See decision 2.
The design review of PR 2 replaced approval by hash with approval by record ID.

### Sources

- Stellar CLI 28.1.0, commit `c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd`.
  The checks used `stellar network ls --long` with an empty `--config-dir`, and a stub plugin that printed its `STELLAR_` variables.
- The `soroban-cli` 28.1.0 crate source: `config/network.rs` (`Args::resolve`) and `config/locator.rs` (`read_network`, `global_config_path`).
- RPC `getNetwork` on 2026-09-29: mainnet reported protocol 28, and testnet and futurenet reported protocol 29.
  CAP-71 AddressV2 needs protocol 27, so mainnet accepts the Walleterm authorization formats.
- Stellar Wallets Kit 2.7.0 in `fixtures/kit/`: `esm/types/mod.js` (`Networks`).
- Network IDs: `shasum -a 256` of each passphrase. The `src/network.rs` tests check them.
