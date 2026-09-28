# C07 check record

All test commands used this working directory:

```text
/private/tmp/walleterm-audit-40d6cca9db73
```

All test commands used these environment overrides:

```text
TMPDIR=/private/tmp
BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-c07-astra-bun-cache
```

The runner captured both output streams in the named log.
`results.json` retains each exact argument array and exit code.

```sh
bun --version
bun test /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/04-sdk-daybreak/sdk-regressions.test.ts -t 'an unreadable 401 clears the active connection'
bun test /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c07-astra/c07.test.ts
bun test bridge/connect.test.ts -t 'reload removes a revoked|explicit disconnect clears|health checks do not overlap|an expired session removes'
git -C /Users/kalepail/Desktop/walleterm-v2 ls-tree -r --name-only 40d6cca9db732a0db16d154c80d4a153bf33c6b7
```

The version command returned `1.4.2`.
The original C07 test failed with exit 1; its other test remained filtered out.
The C07 observation tests passed: seven tests, exit 0.
The existing control tests passed: four tests, exit 0; 18 tests remained filtered out.
The tree command passed with exit 0.

The Python runner compared the tree paths with `manifest.json` keys under `file_sha256`.
It read only those 199 tracked snapshot files for content verification.
It calculated each digest with `hashlib.sha256((source/name).read_bytes()).hexdigest()`.
All digests matched before and after the tests.
Generated files outside the manifest did not enter the comparison.

The tests inject mock fetch and storage; they do not open sockets or request signatures.
The UI checks keep real health, restoration, storage, and synchronization methods.
They replace rendering methods with empty functions.
They do not prove browser CORS enforcement or a live intermediary trigger.
