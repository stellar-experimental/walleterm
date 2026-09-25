# Review of the walleterm CLI design

The raw proof in `evidence/1password-feasibility.json` supports the signing rule. The CLI signs those exact 32 protocol bytes. Live classic G01–G10 passed. Open defects are the wire rules, the key claims, and the contract tests.

## SSH framing

`docs/INTERFACE.md` lines 31–32 are correct. The agent `data` string holds the 32 bytes. Flags are zero. The CLI leaves those bytes unchanged.

Lines 31 and 39 omit the wire format. Put RFC 9987 sections 5 and 5.6 and RFC 8709 sections 4 and 6 into `docs/INTERFACE.md`:

- Request: 4-byte length, byte `13`, key blob, one SSH string of 32 bytes, `uint32` zero.
- Key blob: SSH string `ssh-ed25519`, then SSH string of the 32-byte public key.
- Success: 4-byte length, byte `14`, one signature string.
- Signature string: SSH string `ssh-ed25519`, then SSH string of 64 signature bytes.
- Reject a short frame, a frame above 1 MiB, a nested overrun, and bytes after the message.

Line 51 cannot split every failure. RFC 9987 section 5.6.4 uses byte `5` for refusal and for other failures. Map byte `5` to one code. Keep `P03` as no signature and no retry.

`docs/INTERFACE.md` line 33, `docs/PLAN.md` line 50, and `L05` disagree. `sign` accepts one exact `ssh-ed25519` match. Zero matches return `key_not_found`. Two matches return an error. `list` skips other key types.

`L01`: fingerprint is `SHA256:` plus OpenSSH Base64 SHA-256 of the key blob.

`docs/PLAN.md` line 51 conflicts with `docs/INTERFACE.md` line 65. `sign` uses one connection for identities and signing, then closes it. `list` uses its own connection. The 120-second deadline covers that `sign` connection.

## Key containment

`AGENTS.md` lines 7–8 and `docs/PLAN.md` lines 7–8 overstate the CLI. 1Password can export a private SSH key. A verified signature shows possession. It does not show origin or export history. `docs/INTERFACE.md` lines 75–76 already say this. Align the other two files. The CLI reads public identities and signatures only.

Record the raw proof at `docs/PLAN.md` lines 3 and 40–41. G01–G10 passed. Contract rows stay open.

`docs/PLAN.md` line 111 assumes a prompt per action. The 1Password default approves one key for one application and its subprocesses. A later digest can skip the prompt. `P04` must set **Per key, per request** and record that setting. `docs/INTERFACE.md` line 56 must say the prompt does not show the Stellar transaction.

## Blind digest signing

The CLI verifies the 64-byte signature over the supplied 32-byte hash.

Name each contract hash:

- V1 payment: `SHA-256` of `TransactionSignaturePayload`.
- `G07`: `stellar tx hash` rejects a fee-bump. Hash the outer payload with `stellar xdr encode --type TransactionSignaturePayload`. Use different fee and inner sources. Sign the inner envelope first.
- `C01`: hash the simulated `HashIdPreimage` arm. Use a G-account other than the transaction source.
- `C02`: sign the host `signature_payload`.
- `C03` and `C04`: sign OpenZeppelin `auth_digest`, `SHA-256(signature_payload || XDR(context rule ids))`. The CLI signs that result unchanged. The raw host payload fails with `3003`.

`C11` resubmits the same credential bytes. A new nonce is a new authorization.

## Multisig and G/C tests

Preserve the passed G01–G10 split:

- A duplicate that leaves the weight insufficient returns `txBadAuth`.
- An unrelated extra signature returns `txBadAuthExtra`.

Replace `docs/TEST-MATRIX.md` line 45 with those two results.

A new account has master weight 1 and thresholds 0. Payment uses medium. The source also meets low. `SignatureChecker` stops at the needed weight. Master weight 0 is omitted. An unused unrelated signature is `txBadAuthExtra`. A duplicate that misses the needed weight is `txBadAuth`.

Contract rows:

- `C04`: threshold 2. Two eligible signers pass. One returns `3202`. An outside signer returns `3016`.
- `C08`: a changed child keeps the old signature and fails. One rule id per context. A bad length returns `3014`.
- `C12`: OpenZeppelin duplicate returns `3007`. Classic duplicate stays `txBadAuth` when weight is insufficient.
- `C01`: sort G-account maps by increasing `public_key`.
- Hash the simulated `HashIdPreimage` arm. `docs/OPENZEPPELIN.md` section 4.1 leaves the protocol 28 arm open. The other arm fails.
