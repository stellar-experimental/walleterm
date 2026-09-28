# Structured authorization signing

Use `walleterm sign-auth < request.json` for a reviewed unsigned AddressV2 entry.
The command requires installed Bun service files.

```json
{
  "auth_entry_xdr": "canonical Base64 SorobanAuthorizationEntry",
  "network_passphrase": "Test SDF Network ; September 2015",
  "public_key": "selected G-address",
  "address": "authorizing G-address or C-address",
  "adapter": { "type": "contract-ed25519" },
  "latest_ledger": 123456
}
```

1. Obtain the current ledger from a trusted RPC endpoint.
2. Check the complete entry against the authorized contract action.
3. Check the address, network, nonce, expiry, invocation tree, and contract signature format.
4. Select `account`, `contract-ed25519`, or the pinned `openzeppelin-ed25519` adapter.
5. Send the exact reviewed JSON to `walleterm sign-auth` with EOF.
6. Require `ok: true`, `verified: true`, and the same selected key and expected digest.
7. Verify the returned `signed_auth_entry_xdr` before adding it to the operation.
8. Run enforcing simulation and assemble the final transaction before envelope signing.

The CLI checks consistency with caller-provided `latest_ledger`. It performs no network calls.
The signature binds the complete AddressV2 payload.
The `contract-ed25519` adapter uses raw signature bytes. Other contracts can require another format.
The OpenZeppelin adapter also requires `verifier` and `context_rule_ids`.
Use the pinned OpenZeppelin reference to review those fields.
V1, SourceAccount, and delegated credentials require another workflow.
SourceAccount authorization remains valid inside ordinary transaction envelopes.
Preserve an uncertain signing result until its authorization expiry passes or the outcome becomes known.
