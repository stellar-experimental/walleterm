import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

AUDIT = Path('/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26')
SNAPSHOT = Path('/private/tmp/walleterm-audit-40d6cca9db73')
OUTPUT = AUDIT / 'checks/concerns/c11-astra'
manifest = json.loads((AUDIT / 'manifest.json').read_text())

def verify_source():
    mismatches = []
    for name, wanted in manifest['file_sha256'].items():
        path = SNAPSHOT / name
        actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
        if actual != wanted:
            mismatches.append(name)
    return {'tracked_files': len(manifest['file_sha256']), 'mismatches': mismatches}

before = verify_source()
assert not before['mismatches'], before
commands = [
    ('original-reproduction', ['bun', 'test', str(AUDIT / 'checks/06-contracts-daybreak/rpc-root-injection.test.ts')]),
    ('signature-disclosure', ['bun', 'test', str(OUTPUT / 'signature-disclosure.test.ts')]),
    ('cap71-root-controls', ['bun', 'test', 'tests/cap71.test.ts', '--test-name-pattern', 'mocked CAP71 run']),
    ('cap85-self-test', ['bun', 'tests/cap85.ts']),
]
results = []
with tempfile.TemporaryDirectory(prefix='c11-astra-', dir='/private/tmp') as scratch:
    env = dict(os.environ, TMPDIR=scratch, BUN_RUNTIME_TRANSPILER_CACHE_PATH=scratch + '/bun-cache')
    for name, argv in commands:
        result = subprocess.run(argv, cwd=SNAPSHOT, env=env, capture_output=True, text=True, timeout=60)
        (OUTPUT / (name + '.log')).write_text(result.stdout + result.stderr)
        results.append({'name': name, 'cwd': str(SNAPSHOT), 'argv': argv, 'exit_code': result.returncode,
                        'log': name + '.log'})
        print(name, result.returncode)
after = verify_source()
record = {'revision': manifest['revision'], 'before': before, 'after': after, 'commands': results}
(OUTPUT / 'results.json').write_text(json.dumps(record, indent=2) + '\n')
assert not after['mismatches'], after
assert all(row['exit_code'] == 0 for row in results), results
