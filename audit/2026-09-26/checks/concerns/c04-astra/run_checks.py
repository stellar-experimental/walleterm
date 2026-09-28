"""Rerun inspected, offline C04 checks against the frozen snapshot."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

REPO = Path('/Users/kalepail/Desktop/walleterm-v2')
AUDIT = REPO / 'audit/2026-09-26'
FROZEN = Path('/private/tmp/walleterm-audit-40d6cca9db73')
OUT = AUDIT / 'checks/concerns/c04-astra'
REVISION = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
manifest = json.loads((AUDIT / 'manifest.json').read_text())
assert manifest['revision'] == REVISION
rows = []
for name, expected in manifest['file_sha256'].items():
    content = (FROZEN / name).read_bytes()
    actual = hashlib.sha256(content).hexdigest()
    baseline = subprocess.run(
        ['git', '-C', str(REPO), 'show', f'{REVISION}:{name}'],
        check=True, capture_output=True,
    ).stdout
    rows.append({'file': name, 'sha256': actual, 'manifest_match': actual == expected,
                 'baseline_match': content == baseline})
snapshot = {'revision': REVISION, 'files': rows}
(OUT / 'source-verification.json').write_text(json.dumps(snapshot, indent=2) + '\n')
assert len(rows) == 199
assert all(row['manifest_match'] and row['baseline_match'] for row in rows)

commands = [
    ('parent-crash', FROZEN, ['bun', 'test', 'bridge/tunnel-child.test.ts']),
    ('supervisor-crash', REPO, ['bun', 'audit/2026-09-26/checks/03-runtime-daybreak/orphan-supervisor-check.ts']),
    ('supervisor-recovery', REPO, ['bun', 'audit/2026-09-26/checks/03-runtime-daybreak/orphan-recovery-check.ts']),
]
results = []
for name, cwd, command in commands:
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=20)
    (OUT / f'{name}.log').write_text(result.stdout + result.stderr)
    results.append({'check': name, 'started_utc': started, 'cwd': str(cwd),
                    'command': command, 'exit_code': result.returncode,
                    'log': f'{name}.log'})

# Verify both source and preserved reproductions without changing them.
for name in ('orphan-supervisor-check.ts', 'orphan-recovery-check.ts'):
    content = (AUDIT / 'checks/03-runtime-daybreak' / name).read_bytes()
    results.append({'reused_check': name, 'sha256': hashlib.sha256(content).hexdigest()})
assert all(hashlib.sha256((FROZEN / row['file']).read_bytes()).hexdigest() == row['sha256'] for row in rows)
(OUT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps({'snapshot_files_passed': len(rows), 'checks': results}, indent=2))
assert all(row.get('exit_code', 0) == 0 for row in results)
