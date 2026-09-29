# Contract authorization

The demo uses a C-account that checks a separate Ed25519 authorization signature.
The selected 1Password key owns that account and signs the transaction envelope.
These signatures approve different payloads.
The authorization signature binds the network, C-address, nonce, expiry ledger, and complete invocation tree.
The envelope signature approves the assembled transaction.

## Try the demo

1. Start `walleterm tunnel` and `walleterm demo` in separate terminals.
2. Connect the demo to the tunnel and select a dedicated testnet key.
3. In **Smart account walkthrough**, the demo reads the ledger and shows the next step.
4. If the contract code is missing, select the upload button, then sign and submit the upload.
5. Select **Deploy smart account**. Select **Sign authorization**, then **Sign transaction**, then **Submit to testnet**.
6. Select **Continue: Deploy the counter** and do the same three steps.
7. Select **Continue: Increase the counter**. Select **Sign authorization** to sign the C-account entry.
8. Review the assembled transaction and select **Sign transaction**, then **Submit to testnet**.
9. Select **Increase again** to repeat the call, or **Start a new set** to repeat the deploy steps.

Setup uploads missing fixture code and deploys deterministic contracts for the selected key and set.
Deployment uses fresh explicit G-account authorization entries.
The counter uses explicit C-account authorization.
The demo never sends SourceAccount credentials to the authorization signer.
General transaction signing still permits normal SourceAccount authorization.

The demo checks deployed code hashes and the C-account owner.
After submission, it checks that the counter increased by one.
Unknown submissions require a check of the original hash.
Unknown authorization requests remain protected until their ledger expiry passes.

## Use the SDK

Build and simulate the contract transaction with the official Stellar SDK.
The example requires an unsigned AddressV2 entry from simulation.
Set the authorization expiry before review.
Keep that entry's address, nonce, credential version, and invocation tree.
Authorization signing requires AddressV2 credentials.
V1 credentials omit the authorizer address from the signing payload.

Same-source deployment simulation can return SourceAccount credentials.
The website then builds a fresh explicit AddressV2 entry.
It uses the reviewed invocation root, explicit address, fresh nonce, network, and expiry.
The website reviews that entry before signing.
The signer never converts SourceAccount credentials automatically.

The SEP-43 `signAuthEntry` method signs the address-bound preimage of the entry.
The website attaches the returned signature in the format that its account expects.

```ts
import { Networks, authorizeEntry, buildAuthorizationEntryPreimage, xdr } from '@stellar/stellar-sdk';

const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, Networks.TESTNET);
const { signedAuthEntry, error } = await wallet.signAuthEntry(preimage.toXDR('base64'));
if (error) throw error;
const signature = Uint8Array.from(atob(signedAuthEntry), (c) => c.charCodeAt(0));
const signed = await authorizeEntry(
  entry,
  async () => ({ signatureScVal: xdr.ScVal.scvBytes(signature) }), // The demo C-account format.
  expirationLedger,
  Networks.TESTNET,
);
```

A native G-account uses `{ signature, publicKey }` in the callback instead.
The SDK checks the preimage before sending it and verifies the returned signature.
No check reads a ledger. The network enforces expiry. Expiration ledger 0 fails.
Attach the signed entry to the invocation operation.
Run enforcing simulation and assemble the final resources and fee.
Then request the envelope signature with `wallet.signTransaction(transaction.toXDR())`.
The application owns submission and result checks.

Some contracts sign a digest other than the preimage hash.
The Walleterm extension `wallet.signAuthorization(entryXdr, { address, adapter })` signs a complete entry through an adapter.
Supported adapters are `account`, `contract-ed25519`, and `openzeppelin-ed25519`.
It returns `{ signedAuthEntryXdr, signerAddress }`, or `error`.
Other contracts can require different signature formats or signing payloads.
Select a format or adapter only after checking the contract's authorization rules.
See [OpenZeppelin adapters](OPENZEPPELIN.md) for its pinned signature format.
The OpenZeppelin adapter supports one `External` Ed25519 signer. It does not support `Delegated` signers.

## Use the CLI

The authorization entry shape of `walleterm sign < request.json` accepts these fields:

```json
{
  "public_key": "selected G-address",
  "network_passphrase": "Test SDF Network ; September 2015",
  "auth_entry_xdr": "base64 AddressV2 authorization entry",
  "address": "authorizing G-address or C-address",
  "adapter": { "type": "contract-ed25519" }
}
```

The CLI validates the complete entry before requesting a signature.
It returns `digest`, `signature`, `signed_auth_entry_xdr`, `public_key`, and `verified` in JSON.
The CLI performs no network calls. No check reads a ledger, and expiration ledger 0 fails.
The preimage shape signs a `buildAuthorizationEntryPreimage` result instead. See [the CLI interface](INTERFACE.md#sign).

Walleterm computes the digest and sends exactly those 32 bytes to the 1Password agent.
Private keys stay inside 1Password.
The CLI, SDK, and bridge never submit transactions.
The demo owns contract discovery, setup, simulation, submission, and counter checks.
Custom fixture contracts remain in `fixtures/`.

## Validation

Offline tests use isolated mock keys and make no live signing requests.
`tests/contract-auth-demo-live.ts` runs the demo flow live with dedicated testnet keys.
It signs a C-account entry through the CLI and through the SDK, each before a separate envelope signature.
It checks missing authorization, changed nonces, and changed calls through enforcing simulation. It never submits those controls.
It stops after an uncertain result and keeps the pending submission evidence.
See [live tests](LIVE-TESTS.md) for setup and commands.
[The live signing record](../evidence/signing-live-2026-09-28.json) holds the latest contract and OpenZeppelin results.

Protocol references:
[Contract authorization](https://developers.stellar.org/docs/build/guides/auth/contract-authorization),
[Signing Soroban invocations](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations).
This implementation uses `@stellar/stellar-sdk` 17.2.0.
