# CAP-71 delegated authentication

Read this for a `SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES` entry, or when an account authenticates through CAP-71 delegates.
Sources: [CAP-71](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071.md), [CAP-71-01](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-01.md), and [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-02.md).
These features start at protocol 27. Check the network protocol before use.

## Compare the schemes

| Scheme | Auth entries | Digest that each Ed25519 key signs |
| --- | --- | --- |
| Native G, `address` | One entry for each address | SHA-256 of `soroban_authorization`. Walleterm refuses it. |
| Native G, `address_v2` | One entry for each address | SHA-256 of `soroban_authorization_with_address` |
| OZ `External` signer | One entry for the C-account | OZ `auth_digest` over the host payload and rule IDs |
| OZ `Delegated` signer | The C-account entry, plus an entry for the delegate address rooted at `__check_auth(auth_digest)` | The digest that the delegate's own scheme requires for its entry |
| CAP-71 delegates | One entry that holds a delegate tree | The shared top-level payload `P`, under each delegate's own account rules |

The OZ rows are in [pinned OpenZeppelin auth](openzeppelin.md). The native rows are in [classic and native G auth](classic-native.md).
The OZ `Delegated` scheme adds a separate nested entry with its own nonce. It is not CAP-71.
In the tested example, the delegate was a G-address. It signed the native preimage hash of its own entry.
A C-address delegate uses its own credential and signature format in that entry. Check its code and rules first.

## Decide whether CAP-71 applies

Simulation does not produce the delegates variant. The client builds the delegate tree from the account's rules.
Use it only when the account code calls `delegate_account_auth` for those delegates. Check that code with [contract code](contract-code.md).
The host treats the delegate list as caller input. Attach only delegates that the account will authenticate.

## Build and sign

1. Record-simulate. Keep the root invocation, the nonce, and the top-level address.
2. Choose an expiration ledger. Use the same value in the preimage and the credential.
3. Build `soroban_authorization_with_address` with the top-level address, even for delegate signatures.
4. `P = SHA-256(XDR(HashIdPreimage))`. Every node receives this same `P`.
5. Sign each node according to its own account:
   - A G-address delegate sends the top-level preimage to `walleterm sign` with the preimage shape.
     Walleterm computes `P` and signs it. Use the native `{public_key, signature}` vector format.
   - A C-address delegate applies its own digest rule and signature format to `P`. Check that account's code first.
   - The top-level signature follows the top-level account's `__check_auth`. It may be `void` when that account accepts delegates only.
6. Put each signature on its own node. Nested delegates go inside `nestedDelegates` of their parent.
7. Sort each delegate array by `address`, in host order, with no duplicates. The host rejects the entry otherwise.
8. Enforce-simulate the complete entry. Then sign the envelope separately with the transaction shape.

Several G delegates can sign the same preimage. The preimage shape accepts any G- or C-address as its bound address.
Show the preimage, the returned `digest`, and each selected key. Each `walleterm sign` call returns one signature for one key.

## Replay binding

The `soroban_authorization_with_address` payload binds the nonce and signatures to the top-level address.
CAP-71-01 uses it so that a delegate signature cannot move to another account.
The preimage does not contain the delegate tree. Each account must validate its delegates and enforce its policy.
The legacy `address` payload lacks that binding. CAP-71-02 permits `address_v2` for non-delegated entries for the same reason.

## SDK helpers

`@stellar/stellar-sdk` 17.2.0 exports these helpers. Treat their names as examples for that version only.

SDK byte values can be `Uint8Array`. Encode them explicitly, such as `Buffer.from(payload).toString('hex')`.
Use `Buffer.from(bytes).toString('base64')` when recording raw XDR bytes.

- `buildWithDelegatesEntry({ entry, validUntilLedgerSeq, delegates, signature })` wraps an `address` or `address_v2` entry. It sorts each array and rejects duplicates.
- `buildAuthorizationEntryPreimage(entry, validUntilLedgerSeq, networkPassphrase)` returns the preimage. Hash its XDR to get `P`.
- `authorizeEntry(entry, signer, validUntilLedgerSeq, networkPassphrase, forAddress)` writes a signature to the node for `forAddress`.
  A callback receives `(preimage, payload)`. Send `preimage` to `walleterm sign` with the preimage shape.
  Check that the returned `digest` equals `payload`. Return `{ signature, publicKey }` or `{ signatureScVal, address }`.
- `inspectAuthEntry` lists every node. `checkAuthEntryReadiness` requires every node to be signed, which is stricter than some accounts.

Compare the helper output with an independent XDR encoding of the preimage before the first live use.
