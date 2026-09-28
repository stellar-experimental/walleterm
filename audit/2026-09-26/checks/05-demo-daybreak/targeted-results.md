# Targeted check results

Frozen revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

## Demo tests

Command:

```text
bun test bridge/site.test.ts bridge/activity.test.ts bridge/code-view.test.ts
```

Initial result: 38 passed and one local-listener test failed.

The restricted socket sandbox caused `EADDRINUSE` for port `0`.

Targeted permitted rerun:

```text
bun test bridge/code-view.test.ts -t "demo serves the exact bundled assets under the existing strict CSP"
```

Result: one passed and zero failed.

Final targeted result: 39 passed and zero failed.

## Signing and review tests

Commands:

```text
bun test bridge/server.test.ts -t "review records exact offer price, destination, memo and data bytes"
bun test bridge/server.test.ts -t "invalid signatures are never delivered"
bun test bridge/server.test.ts -t "SDK retries a failed poll and a lost first response"
```

The exact-review test passed inside the sandbox.

The two listener tests first failed with the same socket restriction.

Both targeted permitted reruns passed.

Final result: three passed and zero failed.

## Central evidence used

`checks/baseline-permitted-results.json` records passing Go race and Bun suites.

`checks/rust-summary.json` records 30 passing fixture tests across ten suites.

These central checks do not establish live testnet acceptance.

## Source integrity

The relevant hashes matched before and after targeted tests.

```text
7b59656b9b06900054620024d52ac55a1e5789136741c0dae528ab4573b79218  demo/site/app.ts
48e20167239941fd6614f3ccab5c11619593a044f3dcc46b4456dbf9fcfb54a5  demo/site/activity.ts
d22f14cf0efa2922997a9800b7de96a8bf4808b94773b5895a1841eb1a5413b0  demo/server.ts
1324ca12b747cf5c9504da4132e6ac601d92a839def31e4ae4f91e00c693441e  sdk/walleterm.ts
9c92c2cee9f8fe984d7786f9bac644832e4a78c6e7a9ca1bfc485a3f269dc6b8  bridge/transaction.ts
```

## Prohibited checks

Live signing: `not_run`.

Testnet submission: `not_run`.

Public service startup: `not_run`.

Private-key field access: `not_run`.
