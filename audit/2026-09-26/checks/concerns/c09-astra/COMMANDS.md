# C09 check commands

Run the check driver from the caller repository:

```sh
python3 audit/2026-09-26/checks/concerns/c09-astra/run-checks.py
```

The driver checks all manifest files against the baseline Git tree before and after execution.
It also checks the SDK version and preserved SDK source hashes.

Git inventory command:

```sh
git -C /Users/kalepail/Desktop/walleterm-v2 ls-tree -rz 40d6cca9db732a0db16d154c80d4a153bf33c6b7
```

Working directory: `/Users/kalepail/Desktop/walleterm-v2`.

```sh
bun test audit/2026-09-26/checks/05-demo-astra/adversarial.test.ts -t 'fresh signing|finding: restored|storage failure before submission|storage failure after POST|unavailable Web Locks|normal reload|quota error saving waiting'
```

Exit: `0`. Evidence: `restoration.log`.

Working directory: `/private/tmp/walleterm-audit-40d6cca9db73`.

```sh
bun test bridge/site.test.ts -t 'wallet changes preserve|an unreadable journal|a damaged journal|another tab cannot|a saved review with invalid XDR|an unknown submission expires'
```

Exit: `0`. Evidence: `guards.log`.

All fetches use in-memory mocks. The tests open no sockets.
The existing adversarial tests use isolated mock keys and SDK 17.1.0 envelopes.
The site tests use mocked browser APIs. They do not establish browser implementation behavior.
Filtered tests remain skipped. No full baseline suite ran.
Passing fault reproductions establish current behavior. They do not establish a fix.
