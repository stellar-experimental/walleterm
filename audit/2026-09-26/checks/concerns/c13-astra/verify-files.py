import hashlib
import json
from pathlib import Path

audit = Path('/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26')
manifest = json.loads((audit / 'manifest.json').read_text())
snapshot = Path(manifest['source_snapshot'])
mismatches = [
    name for name, expected in manifest['file_sha256'].items()
    if hashlib.sha256((snapshot / name).read_bytes()).hexdigest() != expected
]
assert not mismatches, mismatches
index = json.loads((audit / 'research/06-contracts-astra/primary-source-index.json').read_text())
primary = next(entry for entry in index if entry['file'] == 'cap-0085.md')
primary_hash = hashlib.sha256(
    (audit / 'research/06-contracts-astra/cap-0085.md').read_bytes()
).hexdigest()
assert primary_hash == primary['sha256']
report = audit / 'reports/concerns/c13-x06-recovery-astra.md'
result = json.loads((audit / 'checks/concerns/c13-astra/recovery-result-2.json').read_text())
assert result['status'] == 'passed'
assert len(result['cases']) == 5
assert not (audit / 'checks/concerns/c13-astra/recovery-stderr-2.txt').read_text()
print(json.dumps({
    'revision': manifest['revision'],
    'checked_tracked_files': len(manifest['file_sha256']),
    'mismatches': mismatches,
    'preserved_CAP85_sha256': primary_hash,
    'scenario_assertions': '5 passed',
    'report_lines': len(report.read_text().splitlines()),
}, indent=2))
