# Stellar CLI for Agents: comparison

Status: research only. No code changes follow from this record.
The research date is 2026-10-01. It compares walleterm at `d785b15` with the
[Stellar CLI for Agents](https://developers.stellar.org/docs/tools/cli/agent-cli) docs at
[`stellar/stellar-docs` `b7f92e1`](https://github.com/stellar/stellar-docs/tree/b7f92e1/docs/tools/cli/agent-cli) (2026-09-30).
Those docs say that they are verified against `stellar-cli` 28.1.0. Walleterm CI pins the same version.
[STELLAR-CLI.md](STELLAR-CLI.md) describes how walleterm uses the CLI. This file compares the two agent workflows.

## Summary

- The docs make the Stellar CLI the whole agent wallet. The agent builds, signs, and submits with its own CLI identity.
- Walleterm only signs. The agent still uses the Stellar CLI to build, simulate, submit, and read balances.
- Custody is the main difference. A CLI identity is a file or a keychain seed that the agent can use or print.
  A walleterm key stays in 1Password, and a person approves its use out of band.
- The docs put the spending bound on chain: allowances, multisig thresholds, and fee bumps. Walleterm keys work in each pattern.
- Walleterm signs C-account authorization entries. The docs say that the CLI cannot sign them.
- The CLI runs on every desktop platform. It has token commands, Ledger support, and a working x402 recipe. Walleterm has none of these.

## The agent-cli design

The docs section has an overview, a quickstart, a skills page, seven guides, and four reference pages.

- The agent runs `stellar` commands directly. `stellar skill` prints usage rules into the agent's context.
- `stellar keys generate` makes the agent's identity. By default, the key is plaintext in `~/.config/stellar/identity/<NAME>.toml`.
  `--secure-store` keeps a seed phrase in the OS keychain. `--ledger` keeps the key on a hardware wallet.
- The quickstart warns that the agent runs as the user. It can read the identity folder, run `stellar keys secret`, or sign with any identity.
  `--secure-store` keeps the seed out of a file, "but the agent can still use it through the CLI."
- The authority model says that the CLI "signs and submits transactions strictly as instructed."
  It has no spend caps and no allowlists. Payments and token transfers never ask for confirmation.
- Safety comes from five controls: a dedicated key, an allowance, a `--build-only` handoff, multisig thresholds, and a sponsored zero-XLM agent.
- The delegate-spending guide gives four patterns. A co-signed vault and a zero-XLM agent need a human signature on each transaction.
  An allowance caps one token with a ledger deadline. A claimable balance funds the agent for a limited time.
- The build-and-submit guide splits build, sign, and send across machines. The decoded envelope has no network field.
  The guide compares `tx hash` with the hash line from `tx sign` to catch a wrong-network signature.
- Commands in an unconfigured folder silently use testnet. `stellar network use` changes the default for the whole machine.
- Only the `stellar token` family returns typed JSON errors. `tx new` writes nothing to standard output on success.
- `stellar message sign` and `stellar message verify` implement SEP-53 offline.
- The x402 guide pays with `@x402/stellar` in Node. The script reads the raw secret from `stellar keys secret` through an environment variable.
  A `--secure-store` identity cannot supply it, so that flow needs a plaintext key file.

## What both projects share

- The Stellar CLI builds with `--build-only`, runs `tx simulate`, and submits with `tx send`. Only the signing step differs.
- Both treat on-chain rules as the real spending bound. Neither tool enforces a spend limit.
- Both sign V1 envelopes, fee-bump envelopes, and SEP-53 messages. Neither wraps a given envelope in a fee bump.
- Both run as short commands that keep no session. Walleterm `tunnel` is the one long-running service.
- Both ship agent guidance. The CLI has `stellar skill`. Walleterm has the `walleterm` and `walleterm-site-bridge` skills.

## Differences

| Topic | Stellar CLI for Agents | walleterm |
| --- | --- | --- |
| Scope | The whole wallet: keys, balances, transfers, allowances, contracts, and submission. | One signing step. The Stellar CLI does everything else. |
| Key custody | A plaintext TOML file, an OS keychain seed, or a Ledger. | 1Password generates and keeps the key. |
| Can the agent read the secret | Yes, from the file or with `stellar keys secret`. Not from `--secure-store` or a Ledger. | No. Walleterm has no read or export path. |
| Can the agent sign without a person | Yes, with a file or keychain identity. A Ledger needs a press on the device. | Only with a cached 1Password approval. The per-request setting removes the cache. |
| What the person sees | A Ledger shows details on the device. Other reviews read `tx decode` output. | The 1Password prompt shows only the process and the key. For website requests, `approve` shows the full decode and the network. |
| Network | `--network`, then `STELLAR_NETWORK`, then saved defaults, then testnet. | Each `sign` request names its passphrase. Walleterm reads no CLI config and no `STELLAR_NETWORK`. |
| Soroban authorization | Signs entries only inside `contract invoke`. | Signs a preimage or an entry by itself. Requires `address_v2` credentials. |
| Contract accounts | Not supported. `contract invoke` stops with `Missing signing key for account C…`. | `contract-ed25519` and `openzeppelin-ed25519` adapters. Live testnet runs passed. |
| Output | Typed JSON only from `stellar token`. Other commands print text on standard error. | One JSON object with a stable error code from `list`, `sign`, and `approve`. |
| x402 | Works today with a raw secret in an environment variable. | Design only. The stock client requests V1 credentials. See [AGENTIC-PAYMENTS.md](AGENTIC-PAYMENTS.md). |
| Websites | None. The overview says that browser wallets are hard for agents. | `tunnel`, the SEP-43 browser SDK, and `demo`. |
| Platforms | macOS, Linux, WSL, and Windows. | Apple silicon Macs with the 1Password desktop app. |

## Gaps in the CLI flow that walleterm closes

1. The secret is reachable. A file identity gives the agent the raw key. The x402 recipe puts it in an environment variable.
   Walleterm never holds the key, so no command or variable can leak it.
2. The CLI gives no approval gate for a file or keychain identity. The docs move the gate to a human who signs later.
   Walleterm puts the gate on the signing key itself. The 1Password prompt is outside the agent's control.
   Turn on approval for each request. The default 1Password setting caches approval until it locks.
3. A missing `--network` can sign for the saved default network. Walleterm requires the passphrase in every request.
   Its notice line names the network before 1Password signs.
4. A reviewer of `tx decode` output cannot see the network. For website requests, `walleterm approve` shows the passphrase beside the decode.
5. The CLI cannot sign for a contract account. Walleterm signs C-account entries through its adapters.
   The caller still checks the account's policy and ownership. See [OPENZEPPELIN.md](OPENZEPPELIN.md).

## Gaps in walleterm that the CLI docs cover

1. A Ledger shows the transaction on the device. 1Password shows only the process and the key.
2. The CLI runs on Linux and Windows. Walleterm needs macOS and 1Password.
3. The x402 guide pays today. Walleterm waits for an x402 client that requests `address_v2` credentials.
4. The docs have token recipes and their failure modes. Walleterm users get them from the same CLI.

## Ideas for walleterm

- Each delegate-spending pattern works with walleterm. Replace `stellar tx sign --sign-with-key` with the transaction shape of `walleterm sign`.
  - A co-signed vault: the vault key lives in 1Password. The person approves each proposal in 1Password.
  - A zero-XLM agent: the treasury key in 1Password signs each fee bump. Declining the prompt stops the agent.
  - An allowance: the spender key lives in 1Password. Build `transfer_from` with `contract invoke --build-only`, then run `tx simulate`.
    `stellar token transfer-from` signs by itself, so it cannot use walleterm.
  The skill already covers [fee bumps](../.agents/skills/walleterm/references/fee-bump.md) and
  [co-signers](../.agents/skills/walleterm/references/classic-native.md). One short recipe could map these patterns.
  [PRIVY-WALLET.md](PRIVY-WALLET.md) suggests the same allowance recipe.
- The docs list three key stores: a file, the OS keychain, and a Ledger. Walleterm could be a fourth option for agents on macOS.
  The CLI has no external signer, so walleterm keeps its own pipeline for now. See [STELLAR-CLI.md](STELLAR-CLI.md).
- The docs say that the CLI cannot sign for smart wallets. Walleterm's contract adapters are evidence that a signer can.

## Sources

| Source | Version or date |
| --- | --- |
| [Stellar CLI for Agents](https://developers.stellar.org/docs/tools/cli/agent-cli): overview, quickstart, and skills | `stellar/stellar-docs` `b7f92e1`, 2026-09-30 |
| Guides: build and submit transactions, delegate spending, sign messages, and pay for APIs with x402 | `b7f92e1` |
| Reference: authority model, architecture, output and errors, and troubleshooting | `b7f92e1` |
| Stellar CLI | `v28.1.0`, as the docs state |
| Walleterm [INTERFACE.md](INTERFACE.md), [STELLAR-CLI.md](STELLAR-CLI.md), and [AGENTIC-PAYMENTS.md](AGENTIC-PAYMENTS.md) | `d785b15` |
