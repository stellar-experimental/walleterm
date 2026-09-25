# Offline walleterm skill forward-test

SDK: `@stellar/stellar-sdk` 17.1.0 from this project's `node_modules`. Network label: Stellar testnet. All keys are isolated local mock keys. No key seed or private key is stored in an artifact. No network, vault, `walleterm`, or submission call ran.

## Results

| Example | Artifact | Check |
| --- | --- | --- |
| Classic payment with a separate operation source | `classic.json` | The transaction source and operation source have different G-addresses. Both decoded envelope signatures verify over `SHA-256(signatureBase)`. Changed amount, operation source, or network rejects both signatures. The envelope has finite time bounds. |
| CAP-71 custom account with two G delegates | `delegation.json` | Two delegate signatures verify over one `soroban_authorization_with_address` digest. Independent preimage XDR matches the SDK helper. Changed top-level address, nonce, or invocation rejects both signatures. Decoded delegate nodes contain the two matching signatures. |
| CAP-85 mutable executable inspection | `cap85.json` | A decoded synthetic instance holds `external_ref(manager, tag)`. Two decoded persistent manager tag entries hold different 32-byte Wasm hashes. The instance XDR stays fixed. Each hash equals the SHA-256 of its local mock code. |

The skill directed the classic source check and one envelope digest for both signatures. It directed the CAP-71 address-bound preimage and sorted delegate nodes. It directed the CAP-85 owner, tag, and persistent entry lookup. No live signing step applied to this offline request.

## Limits and guidance gaps

- The CAP-71 entry has a void top-level signature. Only a matching custom account can accept two delegate signatures. The offline fixture cannot prove its `__check_auth` calls `delegate_account_auth` or requires both delegates. The skill correctly requires code inspection and enforce simulation for a live transaction, but it has no offline account-code fixture.
- The CAP-85 entries are synthetic. They show how a manager tag update changes the resolved hash. They do not prove the manager's real update authority, code hash, chain state, or network protocol support. The skill requires live ledger reads before signing. This request prohibited those reads.
- The skill gives no separate offline path for selecting a future CAP-71 expiration ledger without a latest-ledger read. This fixture uses a synthetic ledger window: 499900 through 500000. It does not claim live readiness.

## Repeat

Run `node /private/tmp/walleterm-forward.9RhuBM/run.mjs` to generate fresh offline keys and artifacts. The script checks all signature and XDR claims before it writes the final result. Run `node --check /private/tmp/walleterm-forward.9RhuBM/run.mjs` to check syntax. Run `shasum -a 256 /private/tmp/walleterm-forward.9RhuBM/run.mjs /private/tmp/walleterm-forward.9RhuBM/*.json /private/tmp/walleterm-forward.9RhuBM/decision.md` to record the current outputs.
