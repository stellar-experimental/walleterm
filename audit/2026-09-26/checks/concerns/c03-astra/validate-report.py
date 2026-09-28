import hashlib
import json
from pathlib import Path
import subprocess

root = Path('/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26')
checks = root / 'checks/concerns/c03-astra'
report = root / 'reports/concerns/c03-pairing-limit-astra.md'
body = report.read_text()
required = [
    checks / name for name in (
        'commands.md', 'pairing.test.ts', 'targeted-tests.log',
        'targeted-tests-permitted.log', 'snapshot-verification.json',
        'verify-snapshot.py', 'validate-report.py',
    )
] + [root / 'research/concerns/c03-astra/usage.json']
assert all(item.is_file() and item.stat().st_size for item in required)
assert '**Accepted limit.**' in body
assert '40d6cca9db732a0db16d154c80d4a153bf33c6b7' in body
assert all(section in body for section in (
    'Verdict and scope', 'Reachable behavior', 'Evidence and counterevidence',
    'Minimum mitigation and alternatives', 'Sources, costs, and limits',
))
for line in body.splitlines():
    if line and not line.startswith(('#', '|')):
        assert len(line.split()) <= 20, line
passed = (checks / 'targeted-tests-permitted.log').read_text()
assert '2 pass' in passed and '0 fail' in passed and '43 filtered out' in passed
assert 'EADDRINUSE' in (checks / 'targeted-tests.log').read_text()
usage = json.loads((root / 'research/concerns/c03-astra/usage.json').read_text())
assert usage['new_research_total_usd'] == usage['new_jev_usd'] == 0
assert usage['new_provider_calls'] == 0
assert not usage['new_unknown_provider_charges']
source = root / usage['preserved_source']['artifact']
assert hashlib.sha256(source.read_bytes()).hexdigest() == usage['preserved_source']['sha256']
snapshot = json.loads(subprocess.check_output(
    ['python3', str(checks / 'verify-snapshot.py')], text=True,
))
print(json.dumps({
    'status': 'passed', 'report_lines': len(body.splitlines()),
    'prose_line_limit': 'passed', 'evidence_files': len(required),
    'targeted_tests': {'passed': 2, 'failed': 0, 'filtered': 43},
    'new_research_usd': 0, 'new_jev_usd': 0,
    'preserved_source_hash': 'matched', 'final_snapshot': snapshot,
    'report_sha256': hashlib.sha256(report.read_bytes()).hexdigest(),
}, indent=2))
