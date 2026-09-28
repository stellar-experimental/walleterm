# C15 Daybreak checks

- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Date: 2026-09-26.
- No check accessed keys, requested signatures, submitted transactions, or opened public services.

## Preserved evidence

- `checks/08-product-astra/distribution-probe.py` copies both supported and incomplete layouts.
- `checks/08-product-astra/distribution-probe.json` records the original probe result.
- `checks/08-product-astra/frozen-source.json` matches all 199 tracked files to the revision.
- `checks/08-product-astra/install-probe.json` confirms a complete isolated installation.

## Commands and outcomes

1. `python3 /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/08-product-astra/distribution-probe.py`
   Result: `passed`. The SDK-only copy failed with a missing parent chunk.
   The complete `dist/` copy imported successfully.
2. `bun test bridge/code-view.test.ts --test-name-pattern 'demo serves the exact bundled assets'`
   Result before socket permission: `inconclusive` with `EADDRINUSE` for the sandbox loopback bind.
3. The same Bun command ran with local loopback permission.
   Result: `passed`; one test passed, five tests were filtered, and zero tests failed.
   The test recursively fetched static and dynamic JavaScript dependencies from the demo server.

The first Python attempt used the frozen root as its working directory.
It failed because the relative audit path was absent there.
The absolute-path rerun above produced the relevant result.

## Research usage

No new provider query ran. The frozen source and preserved reproduction resolved the concern.
Visible cost was `$0.00`. Unknown provider charges were `$0.00` for this review.
