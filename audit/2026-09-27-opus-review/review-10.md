# Opus phase 2 review: PR #10 integration

Reviewer: Claude Opus 5.5. Date: 2026-09-27.
Branch: `review/opus-contract-authorization-2026-09-27` in `/Users/kalepail/Desktop/walleterm-v2`.
Reviewed HEAD: `1f48ec34f74e752c85aef02ddc312493cb5d734f`, a merge of `0d1604b` and main `939f64f`.
Scope: the complete diff `939f64f..HEAD`: 42 files, +4143 and -65 lines. I also read the relevant call sites.
I did not read the paired prior Astra security reports.

## Verdict

**accept**, after the coordinator commits one uncommitted wording correction.
I found no reachable code defect in the authorization, envelope, lifecycle, demo, or packaging paths.
All #11 corrections remain in place and effective.

## Changed file (uncommitted)

`docs/CONTRACT-AUTHORIZATION.md`, lines 111-114: 3 insertions and 1 deletion. `git diff --check` is clean.

```diff
-All 270 offline tests passed. The independent Astra review reported no remaining actionable findings.
+That record and the Chrome test below predate the merge of the audited `main` fixes.
+Live acceptance has not run again on the integrated source.
+At that time, all 270 offline tests passed. The independent Astra review reported no remaining actionable findings.
```

Reason: before this edit, the doc read as if current. In fact the historical live and offline results describe the source before integration.
AGENTS.md requires separate reporting of local tests, live tests, and testnet acceptance. I made no other edits.

## Source review

### CLI sidecar

- `auth_command.go:45` execs `bun --no-env-file <release>/bridge/auth-cli.ts <resolved walleterm>`.
  It resolves the entry from the resolved binary path. A caller cannot select another signer.
- `bridge/auth-cli.ts` enforces a 49152-byte limit, strict UTF-8, one JSON object, and rejects duplicate keys at every depth.
  It checks the exact field set and a 120 s signal, which covers stdin.
  It writes the stderr notice before signing and fails with `output_error` if that write fails.
- Signing uses the unchanged Go `sign` command through `signDigest`. That command checks the key, digest, `verified`, and signature format.
- The sidecar verifies the result independently and then changes only the signature ScVal.
- `latest_ledger` comes from the caller, as documented. The skill reference tells agents to get it from a trusted RPC.

### Authorization digest and adapters

- `sdk/authorization.ts:122-199` requires `sorobanCredentialsAddressV2`, an `scvVoid` signature, and canonical bounded XDR.
  The tree is limited to 256 contexts and depth 32. The address must be the requested address, and the selected key must match.
  Expiry must be 1-60 ledgers after `latestLedger`. The adapter field set is exact.
- The digest is `sha256(HashIdPreimage::envelopeTypeSorobanAuthorizationWithAddress)` (`:172`).
  The existing CAP-71 harness asserts the same preimage type for V2 (`tests/cap71.ts:238`, `:677`).
  The historical testnet record captured only `sorobanCredentialsAddressV2`.
- OpenZeppelin adapter: it uses `sha256(payload || XDR(Vec<U32>))` and the map `{context_rule_ids, signers: {External(verifier, key): sig}}`.
  Both match the historically live-tested OZ harness (`tests/contracts.ts:101-120`). It requires one rule ID per context.
- `account` adapter: the value is `Vec[Map{public_key, signature}]`, the native account format.
- `verifyAuthEntrySignature` (`:236`) extracts the raw signature and rebuilds the full artifact. It then compares the exact XDR.
  So it binds the signature map, the verifier, and the rule IDs, not only the signature.

### Bridge

- Admission validates only the structure (`bridge/server.ts:556`). The request ID binds the full sorted artifact (`:520`).
- After approval, the queue re-lists keys and gets a trusted ledger with `getHealth` from a fixed endpoint (`:275`).
  It then re-inspects the entry and checks for cancellation before signing.
- After signing, it gets a fresh ledger and re-verifies at attachment (`:285-288`).
  Any failure after signing sets `unknown` and deletes `signed_xdr`, so the result is withheld.
- `bridge/authorization.ts:31-67`: `redirect: 'error'`, a 16384-byte streamed cap, a 10 s deadline, `status: healthy`, and a uint32 ledger.
- Soroban envelopes (`bridge/transaction.ts`): one invoke, upload, create, extend, or restore operation.
  The fee cap is 100000000 stroops (`:35`). Unsigned address entries fail. SourceAccount entries pass (`:59`), and delegated entries fail.
  Testnet only, time bounds of 5 minutes or less, and the source rules still apply. Details include host function, auth, and Soroban data XDR.
  Signing SourceAccount envelope authorization is within the accepted boundary: a connected site authorizes by sending.

### SDK

- `signTransaction` (`sdk/walleterm.ts:304`) now requires the selected signer and network before any request.
  It verifies the exact returned body, the network hash, one signature, the hint, and Ed25519.
- `signAuthEntry` (`:330`) validates the entry before sending. It clones the adapter and verifies the complete returned entry.
- Post-response verification failures and a missing artifact report `requestState: 'unknown'` and `canceled: false` (`:471`).
- The #11 revision check still guards both methods through `signArtifact` (`:442`).

### Demo

- `demo/site/contracts.ts:150`, `:228`: each recorded root invocation must equal the full expected tree, with no sub-invocations.
  There must be exactly one entry, with the expected authorizer.
  Setup replaces the SourceAccount optimization with a fresh signed V2 entry for the G-address.
  An increment requires a custom-account C-address entry.
- The authorization and envelope signatures are separate user actions (`demo/site/app.ts:714`, `:732`).
  The envelope step follows the signed entry, an enforcing simulation, and assembly. The page then shows the final fee for review.
- `validateContractReview` (`contracts.ts:345`) checks each saved record on reload and before signing.
  It binds the signer, contract IDs, host function, nonce, expiry, and signed state.
- Unknown results: `clear` and `check` wait until the authorization expiry passes (`app.ts:956`, `:983`).
  RPC submission maps rejections, `txBadSeq`, and missing confirmation to `failed` or `unknown`. It never re-signs.
  A post-confirmation verification error keeps the confirmed ledger state (`:911`).

### Packaging

`scripts/install.ts` installs every new runtime file: the sidecar, the bridge and SDK authorization modules, `sdk/transaction.ts`, `contracts.ts`, and both demo WASM files.
The demo app now builds without chunk splitting. The portable SDK exports the authorization helpers.
`docs/CONNECTION-UI.md` (the #11 C15 fix) still describes the correct copy steps.

### #11 corrections at HEAD

These files are unchanged since `939f64f`: `sdk/connect.ts` (C06), `fixtures/build.sh` (C12), `tests/cli-pipeline.ts` (C14), `tests/cap71.ts` (C17), `docs/CONNECTION-UI.md` (C15), and their tests.
- C01: the text remains in `docs/INTERFACE.md`.
- C02: the HTTP 400 path remains in `demo/server.ts:59`.
- C05: `sdk/walleterm.ts:442`.
- C08: `demo/site/app.ts:823`. The contract path passes validated fields.
- C10: `app.ts:465`. The site test renders a Soroban contract record through `describe()`.
- The conflict resolution in `bridge/site.test.ts` removed no lines.

## Checks on final source

I ran every check once. I used `/private/tmp/walleterm-opus-integrated-wquieaag`.
All 219 tracked files matched the checkout. I refreshed the edited doc there.
I added only the three compiled CAP-71 fixture WASM files from the root. I copied no captures, credentials, or `.env` files.

| Check | Result |
| --- | --- |
| `gofmt -l *.go` | no output |
| `go vet ./...` | pass |
| `go test -race ./...` | pass |
| `bun run typecheck` (full `tsc --noEmit`, tracked source only) | exit 0 |
| `bun run format:check` | pass |
| `bun run build` | pass |
| `bun test` on 27 files (all except `scripts/install.test.ts`) | 385 pass, 0 fail |
| `bun test ./scripts/install.test.ts` (mock Go and Bun) | 2 pass, 0 fail |
| `bun tests/contracts.ts`, `tests/extended-contracts.ts`, `tests/cap85.ts` | all `ok: true` |
| `git diff --check` in the checkout | clean |

Total: 387 Bun tests across 28 files, plus three offline harness self-tests. Tool versions: Bun 1.4.2, Go 1.27.1.

## Considered, not findings

- The demo sets expiry to the simulation ledger plus 60. If the bridge's `getHealth` node lags that node, signing fails closed with a clear error.
- An `assembleAuthorizedContract` failure after authorization signing marks the record `failed`. Only the demo holds that signed entry. The demo never submits a replaced record.
- `signAuthEntry` does not compare the network with the selected account, but `signTransaction` does. The bridge rejects non-testnet requests in both cases.
- `sign-auth` adds error codes beyond the `sign` code list: `start_failed`, `signing_failed`, and `timeout`. The interface defines exit codes only.

## Limits

- No live 1Password, signing service, testnet submission, tunnel, or installation into a real prefix took part in this review.
- The coordinator will run the real temporary-prefix installer and the installed-asset probes.
- The live evidence (`evidence/contract-auth-demo-2026-09-26.json`, the Chrome run) is historical. It predates this integration.
- New research: none, and $0 spent. Repository primary evidence settled each protocol question: the CAP-71 harness, the OZ harness, and the historical testnet record.
- HEAD does not contain the audit-only change from #12 (`184480d`). The coordinator owns that integration.
- The temporary copy now also holds `dist/` build output and the three CAP-71 fixture files. It is outside the repository.
