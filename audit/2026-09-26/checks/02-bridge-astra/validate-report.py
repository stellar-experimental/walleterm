import datetime
import hashlib
import json
from pathlib import Path
import re

ROOT = Path('/Users/kalepail/Desktop/walleterm-v2')
AUDIT = ROOT / 'audit/2026-09-26'
CHECKS = AUDIT / 'checks/02-bridge-astra'
RESEARCH = AUDIT / 'research/02-bridge-astra'
REPORT = AUDIT / 'reports/02-bridge-astra.md'

manifest = json.loads((AUDIT / 'manifest.json').read_text())
snapshot = Path(manifest['source_snapshot'])
mismatches = []
for filename, expected in manifest['file_sha256'].items():
    actual = hashlib.sha256((snapshot / filename).read_bytes()).hexdigest()
    if actual != expected:
        mismatches.append(filename)

text = REPORT.read_text()
required_sections = ['Result', 'Scope and independence', 'Code coverage', 'Findings',
                     'Non-issues and accepted limits', 'Feature opportunity', 'Checks and commands',
                     'Research usage', 'Sources and applicability', 'Limits and blockers']
missing_sections = [s for s in required_sections if f'## {s}\n' not in text]
missing_links = []
for target in re.findall(r'\]\(([^)]+)\)', text):
    if not target.startswith(('https://', 'http://')) and not (REPORT.parent / target).resolve().is_file():
        missing_links.append(target)

test_counts = {}
for name, expected in [('targeted-tests.log', 62), ('adversarial-tests.log', 12)]:
    log = (CHECKS / name).read_text()
    found = re.search(r'\n\s+(\d+) pass\n\s+(\d+) fail\n', log)
    assert found, name
    passed, failed = map(int, found.groups())
    test_counts[name] = {'passed': passed, 'failed': failed, 'matches_report': passed == expected and failed == 0}

usage = json.loads((RESEARCH / 'usage-summary.json').read_text())
jev_total = sum(item['usage']['cost_usd'] for item in usage['jev_attempts'])
assert abs(jev_total - 0.028356624) < 1e-12

# Check prose sentences. Code, URLs, table rows, and identifiers need manual review.
long_sentences = []
for number, line in enumerate(text.splitlines(), 1):
    if not line.strip() or line.startswith(('#', '|', '`')):
        continue
    clean = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', line)
    clean = re.sub(r'`[^`]+`', 'IDENTIFIER', clean)
    for sentence in re.split(r'(?<=[.!?])\s+', clean):
        count = len(sentence.lstrip('- ').split())
        if count > 20:
            long_sentences.append({'line': number, 'words': count, 'sentence': sentence})

result = {
    'checked_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'revision': manifest['revision'],
    'source_files_checked': len(manifest['file_sha256']),
    'source_hash_mismatches': mismatches,
    'missing_report_sections': missing_sections,
    'missing_local_links': missing_links,
    'test_counts': test_counts,
    'jev_total_recorded_usd': jev_total,
    'jev_within_allocation': jev_total <= 1,
    'prose_sentences_above_20_words': long_sentences,
    'report_sha256': hashlib.sha256(REPORT.read_bytes()).hexdigest(),
    'status': 'passed' if not (mismatches or missing_sections or missing_links or long_sentences) and
              all(v['matches_report'] for v in test_counts.values()) else 'failed',
}
(CHECKS / 'report-validation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
raise SystemExit(0 if result['status'] == 'passed' else 1)
