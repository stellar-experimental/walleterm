# Mobile web proof evidence

Date: 2026-09-25. Branch: `mobile-web-poc`. Base commit: `ec2ef8a`.

| Check | Status | Evidence |
| --- | --- | --- |
| Local server and mock signer | passed | `node --test poc/server.test.mjs` |
| Submission recovery tests | passed | `node --test tests/submission.test.mjs` |
| Original Go CLI tests | passed | `go test ./...` |
| Local mobile browser review | passed | [Local review](local-review.png) |
| Mock signed XDR and result display | passed | [Mock completion](mock-complete.png) |
| Mock lost response and original-hash reconciliation | passed | [Mock reconciliation](mock-reconciliation.png) |
| Public tunnel landing page | passed | HTTP 200 over the temporary Cloudflare hostname |
| Live 1Password signature through this phone flow | not_run | Await phone action and desktop approval. |
| Live testnet ledger results | not_run | Await phone action and desktop approval. |

The three screenshots use local browser sessions. The signed flows use isolated mock keys.
No mock key funded an account or submitted a transaction to testnet.
The [preflight snapshot](preflight.json) records the dedicated signer, recipient, network, and account state.
The temporary tunnel hostname can change after a restart. The pairing code is excluded from evidence.
