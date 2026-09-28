# C05 focused check results

Date: 2026-09-26.
Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
Runtime: Bun 1.4.2.

## Command

```sh
XDG_CACHE_HOME=/private/tmp/c05-daybreak-cache BUN_INSTALL_CACHE_DIR=/private/tmp/c05-daybreak-cache/bun \
  bun test audit/2026-09-26/checks/concerns/c05-daybreak/remote-revision-boundary.test.ts
```

## Outcomes

- The restricted run failed because the sandbox blocked the loopback listener.
- Bun reported `EADDRINUSE` for the blocked `127.0.0.1` port-0 bind.
- The permitted loopback rerun passed three tests with zero failures.
- A-B reached revision 2 and returned one valid old A signature.
- A-B-A reached revision 3 and returned one valid old A signature.
- Both bridge records became `unknown` and withheld `signed_xdr`.
- Neither delayed-return case sent an SDK cancellation request.
- A pre-delivery switch aborted the signer signal and returned `requestState: "unknown"`.
- The late mock signer still produced bytes, but the bridge delivered no signed XDR.
- The transport rejected every non-loopback origin.
- The check made no submission request.
- The check used only isolated random mock keys.
- The check did not access 1Password or a public service.

The test file contains the assertions and compact JSON result fields.

