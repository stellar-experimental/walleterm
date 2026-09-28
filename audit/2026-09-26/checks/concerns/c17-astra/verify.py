import hashlib
import json
from pathlib import Path

audit = Path('/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26')
root = Path('/private/tmp/walleterm-audit-40d6cca9db73')
manifest = json.loads((audit / 'manifest.json').read_text())
for name, expected in manifest['file_sha256'].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
checks = audit / 'checks/concerns/c17-astra'
result = json.loads((checks / 'checkpoint-versions.json').read_text())
assert result['status'] == 'passed'
assert len(result['checks']) == 7
assert all(c['outcome'] in ['passed', 'passed_reproduction'] for c in result['checks'])
assert (checks / 'checkpoint-versions.stderr').stat().st_size == 0
index = json.loads((audit / 'research/06-contracts-astra/primary-source-index.json').read_text())
sources = []
for entry in index:
    if entry['file'] in ['cap-0071-01.md', 'cap-0085.md']:
        assert hashlib.sha256((audit / 'research/06-contracts-astra' / entry['file']).read_bytes()).hexdigest() == entry['sha256']
        sources.append(entry)
assert len(sources) == 2
report = audit / 'reports/concerns/c17-checkpoint-versions-astra.md'
assert report.is_file()
print(json.dumps({
    'status': 'passed', 'revision': manifest['revision'],
    'verified_tracked_files': len(manifest['file_sha256']),
    'targeted_checks': len(result['checks']), 'stderr_bytes': 0,
    'report_lines': len(report.read_text().splitlines()),
    'report_sha256': hashlib.sha256(report.read_bytes()).hexdigest(),
    'preserved_primary_sources': sources,
    'new_research_cost_usd': 0, 'jev_cost_usd': 0,
    'live_signing': 'not_run', 'testnet_transactions': 'not_run',
}, indent=2))
