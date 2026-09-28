"""Read tracked frozen artifacts only. Never follow paths into ignored live evidence."""
import hashlib
import json
from pathlib import Path
import subprocess

repo = Path('/Users/kalepail/Desktop/walleterm-v2')
snapshot = Path('/private/tmp/walleterm-audit-40d6cca9db73')
revision = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
tracked = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-r', '--name-only', revision], text=True).splitlines()
documents = {'docs/PLAN.md', 'docs/INTERFACE.md', 'docs/TEST-MATRIX.md', 'docs/LIVE-TESTS.md',
             'docs/BUN-MIGRATION.md', 'docs/WALLET-SWITCH-VALIDATION.md', 'docs/VAULT-FILTER-VALIDATION.md'}
selected = [name for name in tracked if name.startswith(('tests/', 'evidence/', 'bridge/test/'))
            or name.endswith(('_test.go', '.test.ts')) or name in documents
            or name in ('AGENTS.md', 'README.md', 'package.json', '.gitignore')]
verified = []
for name in selected:
    data = (snapshot / name).read_bytes()
    original = subprocess.check_output(['git', '-C', str(repo), 'show', f'{revision}:{name}'])
    assert data == original, name
    verified.append({'file': name, 'sha256': hashlib.sha256(data).hexdigest(), 'matches_revision': True})

def distinct(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, f'Duplicate JSON key: {key}'
        result[key] = value
    return result

summaries = {}
for name in tracked:
    if not (name.startswith('evidence/') and name.endswith('.json')):
        continue
    data = json.loads((snapshot / name).read_text(), object_pairs_hook=distinct)
    summaries[name] = {'date': next((data[key] for key in ['date', 'observed_at', 'at', 'timestamp', 'checked_at'] if key in data), None),
                       'top_level_fields': list(data)}

protocol = json.loads((snapshot / 'evidence/protocol-acceptance.json').read_text())
counts = {}
for name, suite in protocol['suites'].items():
    hashes = [row['hash'] for row in suite['transactions']]
    assert len(hashes) == suite['successful_transactions']
    assert len(set(hashes)) == len(hashes)
    assert all(len(value) == 64 and all(c in '0123456789abcdef' for c in value) for value in hashes)
    counts[name] = {'rows': len(suite['rows']), 'transactions': len(hashes), 'status_counts': {s: sum(row['status'] == s for row in suite['rows']) for s in set(row['status'] for row in suite['rows'])}}
historical = []
for old_name, old_hash in protocol['source_sha256'].items():
    candidate = old_name.replace('.mjs', '.ts')
    historical.append({'recorded_file': old_name, 'recorded_path_in_revision': old_name in tracked,
                       'current_counterpart': candidate, 'same_bytes_as_historical_hash': hashlib.sha256((snapshot / candidate).read_bytes()).hexdigest() == old_hash})
print(json.dumps({'revision': revision, 'tracked_count': len(tracked), 'verified_count': len(verified),
                  'files': verified, 'tracked_json_summaries': summaries, 'protocol_counts': counts,
                  'historical_hash_comparison': historical, 'ignored_evidence_read': False,
                  'live_status_verified': False}, indent=2))
