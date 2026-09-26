# Wallet switching validation

Date: 2026-09-26.

## Scope

The connection component requests an explicit grant for its displayed eligible wallets.
The server pins the reviewed public keys at the first selection.
Wallet changes use the same session and preserve its one-hour expiry.
New keys require a new connection. Fresh discovery still enforces removal and OP_VAULT membership.
The default SDK connection retains the legacy fixed-wallet grant.

Selection revisions reject stale requests, including a change from A to B and back to A.
A wallet change cancels unfinished requests and withholds old bridge results.
Each request retains its original signer and transaction.
The demo retains completed signatures and recovery records. Wallet changes never submit transactions.
An uncertain selection keeps signing disabled until account recovery confirms the requested wallet and an increased revision.
Cancellation after session expiry preserves an unknown signing outcome.

## Independent review

An Astra high agent reviewed the design through Herdr before implementation.
The agent accepted explicit scoped sessions with a pinned reviewed list and selection revisions.
The agent found three implementation issues through offline reproductions:

- An account read could resume signing before an unresolved selection committed.
- An account read started during selection could overwrite the completed selection.
- Cancellation through 401 could hide an unknown signing outcome.

The implementation fixed all three issues and added their exact regression tests.
The final Astra check accepted those fixes and reported no remaining findings in that scope.
The agent ran 71 targeted offline tests. All passed.
The review excluded the separate unfinished demo activity log.

## Browser checks

The browser fixture used two isolated mock wallets and no live network accounts.
The picker displayed the broader wallet permission before selection.
The dropdown changed from the first wallet to the second without opening the pairing dialog.
At 390 x 844, the dropdown changed back without opening the pairing dialog.
The dropdown occupied pixels 12 through 378 within the 390-pixel viewport.
The accessibility check reported zero WCAG A or AA violations in the connection component.
The checker left contrast checks for two decorative symbols incomplete.
Screenshots and raw reviewer output remain in the ignored local evidence directory.

## Limits

The browser checks requested no live signature or transaction.
They do not prove a physical phone camera scan or testnet acceptance.
The earlier live vault check is recorded in [vault filtering validation](VAULT-FILTER-VALIDATION.md).

## Release checks

A separate checkout contained the exact staged release files and excluded unfinished activity log edits.
The file check matched all 153 indexed files to their Git blob hashes.
The complete release `npm test` run passed 171 tests and three contract self-tests.
The release `go test -race ./...` and `go vet ./...` checks passed.
The staged diff check passed. Gitleaks found no secrets in the staged payload.

## Installed live discovery check

The local installation used release `96ec1142507469e29393a9af`.
The running tunnel retained `OP_VAULT=kxx6p3pmtgq2hsrsjh4gakqfdi` for Private.
Its scoped connection listed four live eligible public keys.
The check selected the first wallet, changed to the second, and changed back.
The session token and connection ID remained unchanged. The selection revision advanced from 1 to 3.
The session expiry remained unchanged. Discovery still returned four wallets.
Installed runtime files matched the staged release. Served SDK and demo files matched the installation.
The check disconnected its temporary session. It requested zero signatures and submitted zero transactions.
The demo and tunnel restarted to load this release.
