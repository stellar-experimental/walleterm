# Networks and hard-coded limits

This file maps each network restriction, hard-coded network value, and hard-coded limit in the repository.
Use it to find the code to change before Walleterm opens mainnet or a custom network.
A change that adds, changes, or removes one of these items must update this file in the same change.
`scripts/networks.test.ts` fails when a product file names a testnet value and this file does not name that file.

Inventory base: `main` at `0865ac8` on 2026-09-28. Each location names a file and a symbol.
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
| `src/transaction.rs` `details` | Sets the review detail `network` to `TESTNET` for testnet. For another network, it is the raw passphrase. The review hook reads it. | `TESTNET` or the passphrase | Add names for other networks if a review needs them. |
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
| `sdk/walleterm.ts` `WalletermClient.readAccount` | Refuses an account reply with another passphrase: "The bridge reported a network other than testnet." | Testnet only | Accept the network that the bridge reports. |
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
| `demo/site/app.ts` `ISSUER` | The offer action buys USDC from this issuer. | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, the testnet USDC issuer | Each network has its own issuers. |
| `demo/site/app.ts` `build` and the other parsers | `Networks.TESTNET` for each build, parse, and hash. | Testnet | Use the chosen passphrase. |
| `demo/site/contracts.ts` `CONTRACT_RPC` and `demoRpc` | Simulates, sends, and reads contract calls. | `https://soroban-testnet.stellar.org` | An RPC URL for each network. Stellar CLI has no built-in mainnet RPC. |
| `demo/site/contracts.ts` `build`, `deployment`, `signDemoAuthorization`, and the XDR parsers | `Networks.TESTNET` for builds, contract IDs, and authorization preimages. | Testnet | Use the chosen passphrase. Contract IDs change with the network ID. |
| `demo/site/contracts.ts` `DEMO_WASM` | The demo uploads and deploys its own contracts by WASM hash. It has no fixed contract ID. | Two SHA-256 hashes | None for the hashes. An upload costs real fees on mainnet. |
| `demo/site/activity.ts` `ActivityHistory.wrapFetch` and `categories` | Logs only the testnet Horizon and Friendbot origins. Labels: "Fund testnet account", "Read testnet data", and "Testnet". | Testnet hosts | Match the chosen hosts and names. |
| `demo/site/index.html` and `demo/site/app.ts` status text | "Stellar testnet", "Submit to testnet", and testnet account notes. | Text | Change the copy. |
| `src/demo.rs` `CSP` | `connect-src` permits any HTTPS host and loopback HTTP. | Any HTTPS host | None. A local network on `localhost` also fits. |

## Skills (`.agents/skills/`)

| Location | What it states | Change |
| --- | --- | --- |
| `.agents/skills/walleterm/SKILL.md` | "Use dedicated testnet keys in this project." | Change with the project rule in `AGENTS.md`. |
| `.agents/skills/walleterm-site-bridge/SKILL.md` | The description names testnet websites. The workflow confirms the testnet passphrase. The message notes name the testnet rule. | Change with the bridge. |
| `.agents/skills/walleterm-site-bridge/agents/openai.yaml` | `short_description` names testnet sites. | Change with the bridge. |
| `.agents/skills/walleterm-site-bridge/references/service.md` | "This bridge supports testnet only." "Mainnet fails before signing." The example uses the testnet passphrase. `getNetwork` returns testnet. | Change with the bridge and the SDK. |
| `.agents/skills/walleterm-site-bridge/references/message-signing.md` | The testnet rule does not limit a message. Use dedicated testnet keys. | Change with the bridge. |
| `.agents/skills/walleterm-site-bridge/references/interception.md` | Hash with the confirmed testnet passphrase. | Change with the bridge. |
| `.agents/skills/walleterm-site-bridge/references/legacy-freighter.md` and `.agents/skills/walleterm-site-bridge/scripts/legacy-freighter.ts` `TESTNET` | The helper supports only testnet. It answers network requests with `TESTNET`, the testnet passphrase, and the testnet Horizon URL. It hashes with the testnet passphrase. | Add each accepted network. |
| `.agents/skills/walleterm/references/` `acceptance.md`, `classic-native.md`, `fee-bump.md`, `openzeppelin.md` | Records of past testnet runs. `classic-native.md` uses a `$PASSPHRASE` variable. | None. |

## Docs and site copy

| Location | What it states | Change |
| --- | --- | --- |
| `AGENTS.md` "Work process" | "Use dedicated testnet accounts and contracts. Never use mainnet funds." | A project rule. Change it only with the user's approval. |
| `docs/BRIDGE-PROTOCOL.md` | The introduction, "Errors", "Approval", "Transaction envelopes", "Authorization preimages", and "Messages" state testnet only. | Change with the bridge. |
| `docs/SEP-43.md` | The summary, "Network", the transaction policy, the Kit notes, and the deviations state testnet only. The testnet network ID limits a relayed SEP-45 challenge to testnet services. | Change with the SDK. |
| `docs/INTERFACE.md` | The tunnel text says testnet. The sign section says that the CLI accepts any network. The notice examples use testnet. | Change the tunnel text with the bridge. |
| `docs/WEB-BRIDGE.md` | The setup uses testnet, Friendbot, and the testnet USDC issuer. "Add end-to-end encryption before any mainnet use." | Change with the bridge and the demo. |
| `docs/PLAN.md` | "Keep the testnet website bridge in `tunnel` and `demo`." | Change with the bridge. |
| `README.md` | Websites use testnet and dedicated testnet keys. The bridge supports testnet transactions. The CLI example uses `--network testnet`. | Change with the bridge. |
| `site/index.html` footer | "An experimental project for Stellar. Use testnet accounts." | Change the Paper design first, then the site. |
| `Casks/walleterm.rb` | No network text. | None. |

## Hard-coded limits

No limit below depends on the network, unless the last column says so.
`docs/INTERFACE.md` and `docs/BRIDGE-PROTOCOL.md` state most of these values. `docs/SEP-43.md`, `docs/CONNECTION-LIFECYCLE.md`, `docs/WEB-BRIDGE.md`, the site-bridge skill, and `site/index.html` repeat some of them.
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
| `Bridge::connect`, `CODE_LOCKOUT_MS` | 5 incorrect codes, then a 1-minute pause | Code guessing | No |
| `UNSELECTED_SESSION_MS` | 5 minutes | A session without a selected key | No |
| `SELECTED_SESSION_MS` | 1 hour from the first key selection | A session with a key | No |
| `REQUEST_MS`, `Bridge::create` | 5 minutes, or the transaction `max_time` if earlier | Request expiry | No |
| `MAX_SESSIONS` | 64 | Connected websites | No |
| `MAX_ACTIVE` | 32 | Pending, approved, or signing requests in all sessions | No |
| `MAX_PER_SESSION` | 1000 | Request records and early canceled IDs in one session | No |
| `Bridge::route`, `Bridge::create` | 1–64 characters from `A-Z`, `a-z`, `0-9`, `_`, and `-` | Request ID | No |
| `Bridge::dispatch` | 300 seconds | CORS `Access-Control-Max-Age` | No |
| `Bridge::review_and_sign` | One job at a time | Signing queue | No |
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
| `LOOKUP` | 120 seconds | Vault lookup after agent discovery | No |
| `allowed_keys_with` | 4 | Concurrent `op read` calls | No |
| `GRACE` | 1.5 seconds | From SIGTERM to SIGKILL for `op` | No |
| `AGENT_LIST` | 10 seconds | Agent listing for discovery | No |

### Browser SDK (`sdk/`)

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `sdk/walleterm.ts` `WalletermClient.request` | 135 seconds for `/v1/signers` and `/v1/select`, 15 seconds for other routes | HTTP request timeout | No |
| `sdk/walleterm.ts` `WalletermClient` constructor | `pollInterval` 1 second by default | Request polling | No |
| `sdk/walleterm.ts` `WalletermClient.retry` | `pollInterval` × 1, 2, 4, then 8, at most 5 seconds | Retry delay after a network error or a 5xx reply | No |
| `sdk/walleterm.ts` `WalletermClient.connect`, `WalletermClient.signArtifact` | 300 seconds by default | Connection and signing | No |
| `sdk/walleterm.ts` `WalletermClient.signArtifact` | 10 seconds, 3 attempts | Cancellation after a failure | No |
| `sdk/walleterm.ts` `inspectMessage` | 1–1024 UTF-8 bytes | SEP-53 text | No |
| `sdk/transaction.ts` `MAX_TRANSACTION_XDR`, `MAX_EXISTING_SIGNATURES`, `verifyTransactionSignature` | 262144 characters, 256 more for a signed result, 19 signatures | The Rust transaction limits | No |
| `sdk/authorization.ts` `MAX_AUTH_XDR`, `countAuthContexts`, `sdk/preimage.ts` `MAX_PREIMAGE_XDR` | 32768 characters, 256 contexts, 32 levels | The Rust authorization limits | No |
| `sdk/transaction.ts` `inspectTransactionRequest`, `sdk/authorization.ts` `inspectAuthEntry` | Not blank, at most 256 characters | Passphrase | No. A custom passphrase must fit. |
| `sdk/connect.ts` `WalletermConnect` | 15-second health check, 300-second connection, 8-digit code field, 1.5-second copy label | Connection interface | No |
| `sdk/scan.ts` `scanConnection` | 120 seconds | QR code scan | No |

### Demo website (`demo/site/`)

| Location | Value | Purpose | Network |
| --- | --- | --- | --- |
| `demo/site/app.ts` `build`, `demo/site/contracts.ts` `build` | `setTimeout(180)` | Transaction time bounds | No |
| `demo/site/contracts.ts` `prepareContract` | Latest ledger + 60 | Authorization expiration ledger | Yes. The duration follows the ledger close time. |
| `demo/site/app.ts` `requestSignature` | 5 minutes, or the transaction `max_time` if earlier | Signing deadline | No |
| `demo/site/app.ts` `horizon`, `sourceAccount` | 15 seconds, 30 seconds | Horizon and Friendbot calls | No |
| `demo/site/app.ts` submit handler | 10 attempts, 1 second apart | RPC result polling | No |
| `demo/site/app.ts` `build`, `demo/site/contracts.ts` `build` | `fee: '100'` stroops | Transaction fee | Yes. Network settings and surge pricing set the fee. |
| `demo/site/app.ts` `build` | 0.01 XLM payment, 0.1 XLM offer at 10 USDC | Action amounts | Yes. They move real funds on mainnet. |
| `demo/site/code-view.ts` `MAX_HIGHLIGHT_LENGTH`, `MAX_TOKENS` | 50000 characters, 12000 tokens | Code display | No |

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
| Offline Bun tests | `tests/*.test.ts`, `demo/contracts.test.ts`, `tests/browser/*.test.ts` | Mock keys and testnet values. `tests/browser/kit.test.ts`, `sdk-artifact.test.ts`, and `sep43.test.ts` assert `network_unsupported`. |
| Rust tests | `tests/support/mod.rs` `TESTNET`, `tests/bridge.rs`, `tests/cli.rs`, `tests/tunnel.rs`, `tests/vectors.rs` | `tests/bridge.rs` asserts `network_unsupported`. `tests/tunnel.rs` asserts the "ready on Stellar testnet" text. |
| Kit fixtures | `fixtures/kit/check.mts`, `tab.mts`, `tabs.mts`, and `fixtures/kit/live/` | Testnet. `live/page.mts` uses the testnet Horizon and RPC. `live/negatives.mts` asserts that `Networks.PUBLIC` fails. |
| Contract fixtures | `fixtures/README.md`, `fixtures/cap71/README.md`, `fixtures/cap85/README.md` | Records of testnet runs. |
| Evidence | `evidence/` | Historical testnet records. |
| Test host | `src/bin/walleterm-test-host.rs` | Runs the production bridge rules for the browser tests. It never ships. |

## Opening other networks

### The Stellar CLI model

Stellar CLI 28.0.0 resolves one network from three fields: an RPC URL, optional RPC headers, and a passphrase.

1. `--rpc-url` and `--network-passphrase` define a network directly. `STELLAR_RPC_URL` and `STELLAR_NETWORK_PASSPHRASE` do the same. These take effect even when a name is also set.
2. `--network` or `-n` names a stored or built-in network. `STELLAR_NETWORK` does the same.
3. `stellar network use <name>` stores a default in `config.toml`. The CLI copies it into `STELLAR_NETWORK` only when that variable is unset.
4. With no input, the CLI uses `testnet`.

Other rules:

- An RPC URL without a passphrase fails. A passphrase without an RPC URL also fails.
  Commands that never call RPC, such as `tx sign` and `tx hash`, accept a passphrase alone.
- `stellar network add <name> --rpc-url <url> --network-passphrase <passphrase>` stores a custom network.
  Each `--rpc-header "Name: value"` adds an RPC header. `STELLAR_RPC_HEADERS` does the same.
- The built-in names are `testnet`, `futurenet`, `mainnet`, and `local`. A stored network with the same name replaces the built-in one.
- A stored network has no Horizon URL and no Friendbot URL.
- The CLI finds Friendbot through the RPC `getNetwork` field `friendbotUrl`. For the `local` passphrase, it uses `/friendbot` on the RPC host.
- Stellar Lab adds a Horizon URL to these fields for a custom network.

### Decisions to make

These are open choices. This file does not select one.

1. Scope. Choose the components that open. `walleterm sign` accepts any passphrase now. The bridge, the SDK, and the demo accept only testnet.
2. The bridge network set. Options: one network for each tunnel process, a fixed list, or any passphrase in each request.
   The bridge reads no ledger, so it needs only a passphrase.
3. The network input. `walleterm tunnel` has no network input.
   The Stellar CLI model offers a name, a passphrase, and a stored default. Walleterm can also read the Stellar CLI network configuration.
4. Network names. The bridge and the SDK return `TESTNET`. SEP-43 `getNetwork` returns a name and a passphrase.
   Choose a name for each other network and a rule for a custom passphrase.
5. The SDK reply without a session. `getNetwork` returns testnet before any connection.
6. The security preconditions that the current docs state:
   - `docs/WEB-BRIDGE.md`: Cloudflare terminates TLS and can read tokens and XDR. Add end-to-end encryption before any mainnet use.
   - `docs/SEP-43.md`: the testnet network ID limits a relayed SEP-45 challenge to testnet services.
   - `docs/BRIDGE-PROTOCOL.md`: the connection code is the only gate. "This fits testnet use only."
   - A message signature binds no network. The testnet rule never limited it.
   - `AGENTS.md` forbids mainnet funds in project work.
7. The demo endpoints. The demo needs an RPC URL, a Horizon URL, a funding path, and an asset issuer for each network.
   Mainnet has no Friendbot. Stellar CLI has no built-in mainnet RPC.

### Order of changes

1. Record the decisions and the user's approval.
2. Rust bridge: `admit`, the account and selection replies, the `details` names, the tunnel text, `HELP`, and any new tunnel input.
   Update `tests/bridge.rs` and `tests/tunnel.rs`.
3. Browser SDK: `readAccount`, `#ready`, `signer`, `getNetwork`, `AddressChange`, the Kit `onChange`, and the connection interface.
   The current SDK refuses an account reply that is not testnet. So release the SDK change with the bridge change.
4. The docs and skills in the tables above. Change the Paper design first, then `site/`.
5. The demo, if it opens: endpoints, issuer, fee, amounts, and copy.
6. Tests: the `network_unsupported` cases, the Kit negatives, and new cases for each accepted network.
   Live tests stay on testnet unless the user approves another network.
7. Update this file.

### Sources

- Stellar CLI 28.0.0, commit `300aaf69ab100536678bdb641428b06f06b318ea`. This is the installed binary and the CI version.
  The inventory used `stellar network --help`, `stellar network add --help`, and `stellar network ls --long` with an empty `--config-dir` on 2026-09-28.
- Stellar CLI source at tag `v28.0.0`, read through the GitHub API on 2026-09-28:
  `cmd/soroban-cli/src/config/network.rs` (`Args::resolve`, `DEFAULTS`, `Network::helper_url`), `config/network/passphrase.rs`,
  `config/locator.rs` (`read_network`), and `cli.rs` (`set_env_from_config`, `set_env_value_from_config`).
- Stellar Raven `stellarDocs` search on 2026-09-28: the Stellar CLI manual for `stellar network add`, and the Stellar Lab custom network fields.
- Network IDs: `shasum -a 256` of each passphrase.
