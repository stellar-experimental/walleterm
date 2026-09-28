# C02 daybreak checks

## Frozen source identity

Command:

```sh
jq '{revision, source_snapshot, tracked_files:(.file_sha256|length), demo_server_hash:.file_sha256["demo/server.ts"]}' audit/2026-09-26/manifest.json
shasum -a 256 /private/tmp/walleterm-audit-40d6cca9db73/demo/server.ts
```

Result: `passed`.

- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Tracked files: `199`.
- Manifest hash: `d22f14cf0efa2922997a9800b7de96a8bf4808b94773b5895a1841eb1a5413b0`.
- Measured hash: `d22f14cf0efa2922997a9800b7de96a8bf4808b94773b5895a1841eb1a5413b0`.

## Preserved reproduction review

Reviewed files:

- `checks/03-runtime-astra/targeted.test.ts:80-99`.
- `checks/03-runtime-astra/malformed-encoded.log`.

The test starts only `createDemoSite()` in a child process.
It sets a public-looking origin and connects directly through `127.0.0.1`.
It sends `GET //%25` with a matching `Host` header.
It asserts that the child survives and then requests `/api/session`.

## Independent rerun

Command:

```sh
bun test audit/2026-09-26/checks/03-runtime-astra/targeted.test.ts -t 'malformed demo request does not terminate its process'
```

The first sandboxed run timed out after 6000 ms.
The socket sandbox blocked the loopback feedback loop.
This result is `blocked`, not a product result.

The approved loopback rerun used the same command outside the socket sandbox.
It completed in 204 ms and exited with code 1.
The test failed because the child exited with code 1.
Bun reported `TypeError: Invalid URL` at `demo/server.ts:47:18`.
The raw response started with `HTTP/1.1 200 OK` before the child exit.
The failure reproduced the reported process termination.

Result: `failed as expected`; C02 is confirmed on loopback.

## Causal checks

1. An uncaught `new URL()` error explains the exit.
   The rerun produced that error at the assigned source line.
2. The host check could block the request first.
   The reproduction uses the configured host, so the check permits it.
3. Cloudflare could change the target before forwarding.
   Preserved primary evidence shows configurable URL normalization.
   No authorized evidence proves the Quick Tunnel setting or forwarded target.

No added test was necessary.
The preserved test already provides a fast, exact, and isolated failure signal.
No debug instrumentation was added.

## Research and cost

No new provider call ran.
New Jev usage was `$0`, below the `$0.25` cap.
Total new visible research cost was `$0`, below the `$1` cap.
The review reused `research/03-runtime-astra/cloudflare-normalization.md`.
Unknown provider charges were `$0` for this review because no provider ran.

## Prohibited checks

- Public Quick Tunnel reproduction: `not_run`.
- Live 1Password signing: `not_run`.
- Stellar submission: `not_run`.

