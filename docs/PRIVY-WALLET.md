# Privy wallet: comparison

Status: research only. No code changes follow from this record.
The research date is 2026-10-01. It compares walleterm at `d785b15` with
[`oceans404/try-cli/privy-wallet`](https://github.com/oceans404/try-cli/tree/main/privy-wallet) at `bb00c94` (2026-09-24).

## Summary

- `privy-wallet` is a Node script of about 200 lines. Privy holds its Ed25519 key in a remote TEE.
- Both projects keep the key with a custodian. The Stellar CLI builds, simulates, and submits. The tool only signs.
- The custodian is the main difference. A bearer secret controls the Privy wallet. A person on the Mac controls a walleterm key.
- `privy-wallet` runs in headless cloud containers. Walleterm needs macOS and the 1Password desktop app.
- `privy-wallet` has an x402 buyer and a spending limit through an on-chain allowance. Walleterm has neither today.
- Walleterm checks more before it signs: typed artifacts, `address_v2` credentials, network IDs, and strict input limits.

## The privy-wallet design

`privy.mjs` has four commands:

```text
node privy.mjs create                                  make the Privy wallet once, save wallet.json
node privy.mjs address                                 print its G-address
<unsigned XDR> | node privy.mjs sign --network <testnet|mainnet> [--yes]
node privy.mjs buy <url> --network <testnet|mainnet> [--max 0.10] [--yes]
```

- `create` calls `POST /v1/wallets` with `chain_type: "stellar"`. Privy generates the key. `wallet.json` keeps the ID and address.
- `sign` parses the transaction with the Stellar SDK. It prints a JSON summary of selected operation fields to standard error.
  Without `--yes`, it exits with code 3. With `--yes`, it sends `tx.hash()` to Privy `raw_sign`.
- `raw_sign` signs the exact 32 bytes that it receives. The script verifies the signature against the address.
  The signed envelope goes to standard output, so it pipes into `stellar tx send`.
- `buy` reads the x402 `payment-required` header, compares the price with `--max`, and pays through `@x402/stellar` 2.27.0.
  Its `signAuthEntry` hashes the preimage from the x402 client and signs it with `raw_sign`. It does not parse the preimage.
- `PRIVY_APP_SECRET` from the environment authenticates each call. The wallet has no owner, so this secret alone controls it.
- The spending limit is a USDC allowance. A main wallet runs `stellar token approve` for the Privy wallet. The token contract enforces the limit.
- `npm test` runs offline against a mock Privy that signs with a random local key.

The repository's agent rules (`CLAUDE.md`) permit mainnet signing only through the Privy wallet.
The agent must show each mainnet transaction and wait for the user's OK before it passes `--yes`.
`LOG.md` records a one-hour mainnet session on 2026-09-24 with 30 XLM.
The user waived the OK for each transaction during that session. It covered the classic DEX, Soroswap, Blend, the classic AMM, and offers.

## What both projects share

- The custodian generates and keeps the key. Neither tool reads a private key.
- The Stellar CLI builds with `--build-only` and submits with `tx send`. Contract calls run `tx simulate` before the signature.
- Each tool sends 32 digest bytes to a raw Ed25519 signer and does not hash them again.
- Each tool verifies the signature against the G-address before it uses it.
- Offline tests use mock keys. Live runs record transaction hashes and results.

## Differences

| Topic | privy-wallet | walleterm |
| --- | --- | --- |
| Key custody | Remote Privy TEE. `PRIVY_APP_SECRET` alone controls the wallet. | Local 1Password SSH agent. The user approves in the desktop app. |
| Where it runs | Any host with the secret, including headless cloud containers. | macOS with the 1Password desktop app. |
| Human approval | A `--yes` flag. The agent can pass it, so the `CLAUDE.md` rule is the real control. | 1Password prompts out of band. On mainnet the bridge also requires `walleterm approve`. |
| Signer input | `raw_sign` accepts any 32 bytes. `sign` parses a transaction first. | Typed artifacts only. Walleterm computes each digest. |
| Artifact types | Transactions without fee bumps. x402 entries through the x402 client. | Transactions with fee bumps, preimages, entries with three adapters, and SEP-53 messages. |
| Entry checks | None. `signAuthEntry` signs the preimage that the client gives. | `address_v2` only, the network ID, and no expiration ledger 0. |
| Networks | `testnet` and `mainnet`. | Any passphrase. `tunnel` uses the Stellar CLI names. |
| Review output | A summary of selected operation fields. | `approve` shows the full `stellar-xdr` decode. `sign` writes one notice line. |
| Spending limit | An on-chain SAC allowance from a main wallet. | None. Each signature needs approval. |
| Payments | `buy` pays x402 with a `--max` price cap. | Design only. See [AGENTIC-PAYMENTS.md](AGENTIC-PAYMENTS.md). |
| Websites | None. | `tunnel`, the SEP-43 browser SDK, and `demo`. |
| Output | Signed XDR on standard output. | One JSON object. `jq` extracts `signed_transaction_xdr`. |
| Input checks | Few. A wrong transaction source prints only a warning. | A strict parser, size limits, deadlines, socket checks, and fixed error codes. |
| Packaging | `node privy.mjs` from a repository folder. | A signed Rust binary, an install script, a Homebrew cask, and skills. |

## Risks in privy-wallet that walleterm prevents

1. The bearer secret gives full control. Any process that reads it can sign any digest for any network without a person.
   The `privy-wallet` README lists a Privy owner or authorization key as a next step.
2. `--yes` does not stop an agent. It only gives the policy a pause.
   The 1Password prompt is outside the agent's control. It does not show transaction details, and it can cache approval.
3. Entries are not checked. `@x402/stellar` 2.27.0 requests V1 credentials (see [AGENTIC-PAYMENTS.md](AGENTIC-PAYMENTS.md)).
   `privy.mjs` signs them. Walleterm refuses V1, because V1 permits cross-address replay (CAP-71-02).
4. A curated summary can omit fields. `LOG.md` records that the summary of a liquidity pool deposit showed no amounts.
   The author fixed it and added a test. A full decode prevents this gap but is longer to read.
5. The allowance limits only the USDC that the wallet pulls from the main wallet. It does not limit the balance that the wallet already holds.

## Ideas for walleterm

- The allowance pattern needs no walleterm code. A main account runs `stellar token approve` for a walleterm key.
  The token contract then enforces the limit. A skill recipe can describe it.
  [STELLAR-CLI-AGENTS.md](STELLAR-CLI-AGENTS.md) maps the other Stellar CLI spending patterns to walleterm.
- `privySigner` shows the `signAuthEntry` form that the x402 plan needs.
  The blocker in [AGENTIC-PAYMENTS.md](AGENTIC-PAYMENTS.md) does not change: the stock client requests V1 credentials.
- A raw XDR output mode would let `walleterm sign` pipe into `stellar tx send`.
  The JSON rule for agent commands argues against it. Do not add it without a clear need.

## Sources

| Source | Version or date |
| --- | --- |
| [oceans404/try-cli `privy-wallet/`](https://github.com/oceans404/try-cli/tree/main/privy-wallet): `README.md`, `LOG.md`, `privy.mjs`, `test/` | `bb00c94`, 2026-09-24 |
| [oceans404/try-cli `CLAUDE.md`](https://github.com/oceans404/try-cli/blob/main/CLAUDE.md) | `bb00c94`, 2026-09-24 |
| `privy-wallet/package.json` | `@stellar/stellar-sdk` `^17.1.0`, `@x402/fetch` and `@x402/stellar` 2.27.0 |
| Walleterm [INTERFACE.md](INTERFACE.md) and [AGENTIC-PAYMENTS.md](AGENTIC-PAYMENTS.md) | `d785b15` |
