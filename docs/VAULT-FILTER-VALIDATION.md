# Vault filter validation

Checked on 2026-09-26.

`OP_VAULT` filters website wallets through `walleterm tunnel`.
Local `walleterm list` and `walleterm sign` do not use this filter.
An unset or empty setting preserves all available Ed25519 agent keys.

| Check | Result |
| --- | --- |
| Independent Astra review through Herdr | Passed after corrections; no actionable findings remained |
| Full `npm test` run | 146 Node tests and three offline contract self-tests passed |
| `go test -race ./...` | Passed |
| `go vet ./...` | Passed |
| Installed runtime comparison | Signer, bridge server, and SDK hashes matched the source files |
| Real mock CLI processes | Vault names, IDs, public-field commands, failures, and process cleanup passed |
| HTTP discovery and selection | Excluded keys failed selection; allowed keys passed |
| Signing membership checks | Removal and lookup failures prevented signing; allowed offline signatures verified |
| Delayed SDK responses | Discovery and selection accepted responses after 16 seconds |
| Caller cancellation | Discovery stopped waiting and cleared the website connection |
| Installed browser picker | Exactly four allowed mock keys appeared; the fifth mock key stayed excluded |
| Browser cancellation | Closing the picker returned to the disconnected state |
| Mobile viewport | The picker fit a 390-pixel viewport without horizontal overflow |
| Live 1Password discovery | Vault name and ID returned the same four keys; one agent key stayed excluded |
| Independent live fingerprint check | `ssh-keygen` fingerprints matched the filtered agent keys |
| Live HTTP selection | The excluded key failed selection; an allowed key passed |
| Installed live browser picker | Exactly four vault keys appeared; the excluded key stayed absent |
| Live mobile viewport and cancellation | The picker fit a 390-pixel viewport and closed correctly |
| Final live vault recheck | Passed after the user approved 1Password CLI access |
| User's running tunnel | Restarted with `OP_VAULT`; its HTTP list returned four keys and excluded Hetzner |

The reviewer found a CLI process cleanup defect.
Cancellation rejected the lookup while a process that ignored SIGTERM remained alive.
The corrected runner waits for termination and escalates to SIGKILL when needed.
The regression checks termination immediately after rejection.

The SDK previously allowed 15 seconds for discovery and selection.
It now allows 135 seconds for those routes and preserves caller cancellation.

The first browser check used isolated mock keys and the installed runtime.
The final browser check used live public keys and the same installed runtime.
Both checks requested no signatures and funded no accounts.
Live discovery requested only item metadata and public keys through 1Password CLI 2.39.0.
The first live recheck stopped at a 1Password CLI authorization timeout.
The user approved the retry, which passed all discovery, selection, and browser assertions.
No new live signing or testnet submission formed part of this validation.
The user's existing tunnel initially had no `OP_VAULT` setting.
The test setting did not configure that separate process.
The tunnel shell now exports the selected vault ID. The restarted tunnel passed a fresh HTTP discovery check.

Local records remain under `evidence/` and stay ignored by Git:

- `vault-filter-astra-review.txt`: the final independent review.
- `vault-filter-picker-desktop.png` and `vault-filter-picker-mobile.png`: mock browser screenshots.
- `vault-filter-browser-fixture.mjs`: the isolated mock browser fixture.
- `vault-filter-live.json`: live discovery, independent fingerprints, HTTP selection, and browser results.
- `running-vault-filter.json`: the user's restarted tunnel and its filtered HTTP list.

The full test output is `/tmp/walleterm-vault-full-tests.log`.
