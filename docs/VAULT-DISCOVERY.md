# Vault discovery performance

Checked on 2026-09-26 with 1Password CLI 2.39.0 and Bun 1.4.2 on macOS.
Research used `parallel-cli`, official documentation, and read-only measurements.

## Changes

The bridge lists SSH keys from the selected vault, then reads only their `public key` fields.
It validates every item ID and vault before starting public-key reads.
Reads now run in batches of four, instead of one at a time.
A failure cancels outstanding reads, waits for cleanup, and returns no wallets.
Caller cancellation and the existing lookup deadline apply to every read.

The wallet menu uses its existing public display data. Refresh requests an updated list.
Switching wallets performs the required selection check without a second list refresh.
The server still checks current availability and vault membership for every selection and signature.
It does not reuse a previous lookup as signing permission.

## 1Password guidance

- Use item and vault IDs in field references. IDs avoid ambiguous names and improve CLI efficiency.
- Keep the default CLI cache. 1Password enables it on UNIX-like systems and stores encrypted data in memory.
- Keep private keys inside the SSH agent. Request public fields only; never export or cache private fields.
- Keep 1Password's approval and unlock requirements. This change does not alter authorization settings.

The CLI reference documents IDs and caching. The SSH security documentation describes key isolation and process authorization.

- [1Password CLI reference](https://developer.1password.com/docs/cli/reference)
- [Reading field references](https://developer.1password.com/docs/cli/reference/commands/read)
- [SSH agent security](https://developer.1password.com/docs/ssh/agent/security)

## Evidence

Two alternating measurements used the same configured vault and returned the same four public keys.
Neither version returned the unrelated Hetzner key.

| Measurement | Sequential reads | Four concurrent reads |
| --- | ---: | ---: |
| First comparison | 6,424 ms | 1,506 ms |
| Repeated comparison | 2,787 ms | 1,346 ms |

These measurements include SSH-agent listing, vault metadata, and public-key reads.
They are local samples, not a latency guarantee. The repeated comparison improved by about 52 percent.
Browser checks used mock wallets. Menu opening made no lookup; switching made one selection call and no extra list call.
Explicit Refresh made one list call. The active wallet indicator updated correctly.

Offline tests cover concurrency limits, cancellation, sibling cleanup, failures, and removed-key rejection before signing.
Live checks read public information only. No private fields, live signatures, or transaction submissions were requested.
