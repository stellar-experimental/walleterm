import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys

AUDIT = Path('/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26')
CHECKS = AUDIT / 'checks/concerns/c10-astra'
MANIFEST = json.loads((AUDIT / 'manifest.json').read_text())
SNAPSHOT = Path(MANIFEST['source_snapshot'])


def integrity():
    mismatches = []
    for name, expected in MANIFEST['file_sha256'].items():
        actual = hashlib.sha256((SNAPSHOT / name).read_bytes()).hexdigest()
        if actual != expected:
            mismatches.append(name)
    return {'files': len(MANIFEST['file_sha256']), 'mismatches': mismatches}


before = integrity()
if before['mismatches']:
    raise SystemExit('Snapshot integrity failed before checks.')

commands = [
    ('existing-reproductions.log', [
        'bun', 'test', str(AUDIT / 'checks/05-demo-astra/adversarial.test.ts'),
        '-t', 'fresh signing rejects|normal signed review|normal reload submits',
    ]),
    ('signed-review.log', ['bun', 'test', str(CHECKS / 'signed-review.test.ts')]),
]
results = []
for filename, command in commands:
    result = subprocess.run(command, cwd=SNAPSHOT, text=True, capture_output=True)
    (CHECKS / filename).write_text(result.stdout + result.stderr)
    results.append({'command': shlex.join(command), 'cwd': str(SNAPSHOT),
                    'exit_code': result.returncode, 'log': filename})

sdk = json.loads((SNAPSHOT / 'node_modules/@stellar/stellar-sdk/package.json').read_text())
preserved = json.loads((AUDIT / 'research/05-demo-astra/sdk-source.json').read_text())
sdk_hashes = []
for entry in preserved['files']:
    actual = hashlib.sha256(Path(entry['path']).read_bytes()).hexdigest()
    sdk_hashes.append({'path': entry['path'], 'sha256': actual,
                       'matches_preserved_source': actual == entry['sha256']})

after = integrity()
summary = {
    'revision': MANIFEST['revision'], 'snapshot': str(SNAPSHOT),
    'before': before, 'after': after, 'sdk_version': sdk['version'],
    'preserved_sdk_evidence': sdk_hashes, 'checks': results,
    'new_research_usd': 0, 'new_jev_usd': 0,
    'live_signing': 'not_run', 'live_submission': 'not_run',
}
(CHECKS / 'results.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
sys.exit(bool(after['mismatches']) or any(r['exit_code'] for r in results)
         or not all(r['matches_preserved_source'] for r in sdk_hashes))
