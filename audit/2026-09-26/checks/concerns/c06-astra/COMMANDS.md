# C06 check record

All source reads used `/private/tmp/walleterm-audit-40d6cca9db73`.
The shell directory was `/Users/kalepail/Desktop/walleterm-v2`.
Only assigned C06 evidence and report files changed.

## New targeted probe

```sh
bun test audit/2026-09-26/checks/concerns/c06-astra/late-pairing.test.ts > audit/2026-09-26/checks/concerns/c06-astra/late-pairing.log 2>&1
```

Outcome: passed, two tests, zero failures, Bun `1.4.2 (744846f84)`.
Passing assertions demonstrate the defect on unchanged source.
The cases pause the selection response and the previous-session disconnection response.
Both cases use real `WalletermConnect.connect()`, `destroy()`, and `WalletermClient` methods.
The probe mocks DOM display, storage, fetch, and the user's completed wallet choice.
All HTTP requests use an in-memory handler at `https://c06.invalid`.
The handler has no network fallback and accepts only connection routes.
It respects the request signal during each held response.
No server, browser, camera, key generation, signature, or submission ran.
This probe establishes reachable asynchronous control flow, not physical-device frequency.

## Source identity

The executed Python command compared these files against Git objects:

```python
import hashlib, json, subprocess
from pathlib import Path
revision = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
root = Path('/private/tmp/walleterm-audit-40d6cca9db73')
files = ['AGENTS.md', 'README.md', 'docs/PLAN.md', 'docs/INTERFACE.md',
         'docs/CONNECTION-UI.md', 'sdk/connect.ts', 'sdk/scan.ts',
         'sdk/walleterm.ts', 'demo/site/app.ts', 'bridge/server.ts',
         'bridge/scan.test.ts', 'bridge/connect.test.ts', 'package.json']
rows = []
for name in files:
    frozen = (root / name).read_bytes()
    baseline = subprocess.check_output(['git', 'show', f'{revision}:{name}'])
    rows.append({'file': name, 'sha256': hashlib.sha256(frozen).hexdigest(),
                 'matches_baseline': frozen == baseline})
assert all(row['matches_baseline'] for row in rows)
evidence = {'revision': revision, 'snapshot': str(root), 'files': rows}
Path('audit/2026-09-26/checks/concerns/c06-astra/source-identity.json').write_text(
    json.dumps(evidence, indent=2) + '\n')
```

Outcome: passed; all 13 files match.
Git commands read objects only.

## Preserved evidence

Read `checks/04-sdk-astra/destroy-scan.test.ts.txt` and `destroy-scan.log`.
Read `checks/04-sdk-daybreak/sdk-regressions.test.ts.txt` and the original report's recorded failure.
Read `checks/coordinator-reproductions.txt` for its camera result.
Read `bridge/scan.test.ts` for existing cancellation and late-permission coverage.
The review reused those checks; it did not rerun them or the baseline suite.

The source search used this pattern:

```sh
rg -n 'WalletermConnect|destroy\(|pagehide|disconnect|signTransaction|onChange' /private/tmp/walleterm-audit-40d6cca9db73/demo/site/app.ts /private/tmp/walleterm-audit-40d6cca9db73/bridge/connect.test.ts /private/tmp/walleterm-audit-40d6cca9db73/bridge/scan.test.ts
```

The demo has one component construction and no destruction call.
No live checks ran. No implementation fix ran.
