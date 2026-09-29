# Contract authorization

The demo uses a C-account that checks a separate Ed25519 authorization signature.
The selected 1Password key owns that account and signs the transaction envelope.
These signatures approve different payloads.
The authorization signature binds the network, C-address, nonce, expiry ledger, and complete invocation tree.
The envelope signature approves the assembled transaction.

## Try the demo

1. Start `walleterm tunnel` and `walleterm demo` in separate terminals.
2. Connect the demo to the tunnel and select a dedicated testnet key.
3. Select **Set up contract demo** until both contracts exist.
4. Review each setup transaction, sign it, and submit it.
5. Select **Increment counter**.
6. Select **Sign contract authorization** to sign the C-account entry.
7. Review the assembled transaction and select **Sign transaction**.
8. Select **Submit to testnet**.

Setup uploads missing fixture code and deploys deterministic contracts for the selected key.
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
The explicit live runner uses existing dedicated testnet 1Password keys:

```sh
cargo build --locked --features test-host --bin walleterm-test-host
WALLETERM_BINARY=/isolated/prefix/bin/walleterm \
  bun --no-env-file tests/contract-auth-demo-live.ts /path/to/public-test-keys.json --vault Private
```

The SDK half uses the Rust bridge on loopback through the test host's production mode.
That mode uses the real 1Password signer and explicit vault discovery, as `walleterm tunnel` does.

The runner records reviewed entries, transaction hashes, ledgers, and counter values.
It checks missing authorization, changed nonces, and changed calls through enforcing simulation.
It never submits those negative controls.
It preserves pending submission evidence and stops after uncertain results.

The [2026-09-26 acceptance record](../evidence/contract-auth-demo-2026-09-26.json) records the completed testnet checks and limits.
That record and the Chrome test below predate the merge of the audited `main` fixes.
At that time, all 270 offline tests passed. The independent Astra review reported no remaining actionable findings.
The CLI and SDK each signed a C-account entry before a separate envelope signature.
The accepted transactions changed the counter from 0 to 3 across the recorded runs.
The first run found a ledger-response size limit before SDK authorization signing.
The bridge then read `getHealth.latestLedger`, and the final live run passed.
The bridge no longer reads a ledger (2026-09-28). The records above predate that change.

A later visible Chrome test used freshly rebuilt tunnel and demo services.
It signed the explicit C-account authorization, then signed the transaction separately.
One submission changed the counter from 3 to 4 in ledger 4889644.
Independent RPC checks verified both signatures and the accepted transaction.
The acceptance record keeps this browser result separate from the earlier runner results.

The [2026-09-28 rerun](../evidence/live-rerun-2026-09-28.json) tested the integrated source from a temporary installation.
The runner passed again. The CLI and SDK increments changed the counter from 4 to 6.
Its six negative controls requested no signatures.
A headless Chrome demo run through public tunnels changed the counter from 6 to 7.
It reloaded the page before and after the envelope signature. The record passed validation each time.
A later check on 2026-09-28 verified a fresh 1Password approval prompt after the user locked 1Password.
The OpenZeppelin adapter passed live acceptance on 2026-09-28 with `tests/openzeppelin-auth-live.ts`.
The CLI and the SDK each signed one authorization entry for an existing OpenZeppelin account.
Two increments changed its counter from 2 to 4. Six negative controls requested no signature and were not submitted.
[The OpenZeppelin record](../evidence/openzeppelin-live-2026-09-28.json) holds both results.
See [the runner notes](OPENZEPPELIN.md#live-acceptance-runner) for its checks, controls, and command.

Protocol references:
[Contract authorization](https://developers.stellar.org/docs/build/guides/auth/contract-authorization),
[Signing Soroban invocations](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations).
This implementation uses `@stellar/stellar-sdk` 17.1.0.
