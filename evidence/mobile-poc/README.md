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
| Real iPhone pairing and 1Password signatures | passed | Four requests signed through the Mac. No new desktop prompt appeared. |
| Live testnet ledger results | passed | Four `SUCCESS` results in [live acceptance](live-acceptance.json). |
| Testnet payment effect | passed | The recipient gained `0.0100000` XLM. |
| DEX offer and cancellation | passed | Offer `826425` rested, then disappeared. [iPhone result](iphone-cancel-result.png) |
| Desktop Chrome through the public tunnel | passed | Four `SUCCESS` results in [browser acceptance](browser-acceptance.json). |
| Chrome offer and cancellation | passed | Offer `826445` disappeared. [Offer](chrome-offer-result.png) and [cancellation](chrome-cancel-result.png) screenshots. |
| Existing offer handling | passed after correction | Offer `826443` existed before Chrome submitted its offer. The new gate blocked another offer. [Chrome block](chrome-offer-block.png) |
| Cellular-only phone connection | not_run | iPhone Mirroring used Wi-Fi. |

The first three screenshots use local browser sessions. Those signed flows use isolated mock keys.
The iPhone result screenshot shows the real Safari session after the testnet cancellation.
The Chrome screenshots show [pairing](chrome-paired.png), [signed XDR handoff](chrome-signed.png), and a [note result](chrome-note-result.png).
No mock key funded an account or submitted a transaction to testnet.
The [preflight snapshot](preflight.json) records the dedicated signer, recipient, network, and account state.
The temporary tunnel hostname can change after a restart. The pairing code is excluded from evidence.
