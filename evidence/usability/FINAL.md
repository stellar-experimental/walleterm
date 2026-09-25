# wt-opus final report (pane w44:p4)

Both testnet tasks passed. Each walleterm call ran once. No signing retry or resubmission occurred.

## Task 1: native payment A -> C, 100 stroops
- Hash 86d57ecd0f8d70ef533606f6c5e159eb01ab56d3409f86a291831a9ca45ab731, ledger 4866622, SUCCESS, `payment: success`.
- Sequence 20897180558557217. Fee 100 (limit 10000000). Time bound max_time 1790357585.
- Digest check: `stellar tx hash` equals SHA-256(XDR(TransactionSignaturePayload)).
- walleterm: ok true, verified true, same key and digest. The SDK 17.1.0 check of the signature also passed.
- Balance check: A delta -200 stroops (100 payment + 100 fee). C delta +100 stroops.

## Task 2: target.ping(account,1), payer A, OZ rule 0 auth by A+B
- Hash 05c4fe40ae4e0f651d0840914b9a74dc4d4b9f2366cf498446e700fc63d1f245, ledger 4866629, SUCCESS.
- Sequence 20897180558557218. max_fee 432998, fee_charged 23603 (limit 10000000).
- Credential variant: legacy `address` (SOROBAN_CREDENTIALS_ADDRESS). Preimage: `soroban_authorization`.
- Nonce 5505918231393208785. Expiration ledger 4866775.
- signature_payload 78eda8e8b513e06f4d54e7b36a72a2856667dcec80d9cb5a95016d68f628b4fd.
- context_rule_ids [0], XDR 0000001000000001000000010000000300000000.
- auth_digest 16027dafd8f365001d63e7ca6a66c0bf3119d3c35ab1732530f3f37620c1b740, signed by A and B.
- AuthPayload signers are External(verifier, key), sorted B (594f...) then A (656f...).
- The enforce simulation passed before the envelope signature. The envelope digest equals the hash.
- All three walleterm responses: ok true, verified true, same key and digest. All three SDK checks passed.
- Counter check: count(account) went from 2 to 3. ping returned u32 3 (from resultMetaXdr).

## Pre-live checks
- account WASM 0c20d696...6f0d0 and verifier WASM 875b095d...209b4 match the skill pins.
- Rule 0 has signers A, B, C through the verifier. Policy CAT33LBV...OXKOMV get_threshold = 2.
- The target WASM (04a9a33c...) and the policy WASM (9525e493...) have no pinned expected value.

## Artifacts (/tmp/walleterm-usability-snYwFv)
- journal.jsonl: sign requests, pre_send original hash, send rc, reconciled status.
- t1/: unsigned.json, unsigned.xdr, sign-response.json, independent-verify.json, signed.xdr, send.out, result.json, verify.json, live1.log.
- t2/: sim-record.json, preimage.json, auth-digest.json, final-authpayload.json, final-enforced.json, sign-*-response.json, independent-verify-*.json, signed.xdr, result.json, verify.json, live2.log.
- t2/dryrun-*: the zero-signature enforce simulation from before the window.
- notes/usability.md: U1-U11. Scripts: lib.sh, prep1.sh, live1.sh, prep2.sh, assemble2.sh, live2.sh, reconcile.sh, verify.js.
