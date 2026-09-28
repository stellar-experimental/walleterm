"""Verify audit artifacts without touching source or live state."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile

root = Path(__file__).resolve().parents[1]
repo = root.parents[1]
manifest = json.loads((root / 'manifest.json').read_text())
snapshot = Path(manifest['source_snapshot'])
drift = {}
for label, base in [('snapshot', snapshot), ('checkout', repo)]:
    differences = []
    for name, expected in manifest['file_sha256'].items():
        target = base / name
        actual = hashlib.sha256(target.read_bytes()).hexdigest() if target.is_file() else None
        if actual != expected:
            differences.append(name)
    drift[label] = differences
head = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
current_tracked = set(subprocess.check_output(
    ['git', '-C', str(repo), 'ls-files', '-z'], text=True).split('\0')) - {''}
source_additions = sorted(name for name in current_tracked - set(manifest['file_sha256'])
                          if not name.startswith('audit/'))
reviewed_drift = []
delta_file = root / 'checks/concurrent-source-change.json'
if delta_file.exists():
    delta = json.loads(delta_file.read_text())
    name = delta['file']
    target = repo / name
    if (delta.get('review_status') == 'reviewed by both overall reviewers'
            and target.is_file()
            and hashlib.sha256(target.read_bytes()).hexdigest() == delta['current_sha256']):
        reviewed_drift.append(name)
unreviewed_drift = sorted(set(drift['checkout']) - set(reviewed_drift))
archive_errors = []
with tarfile.open(root / 'checks/source-baseline.tar.gz', 'r:gz') as archive:
    archived = {member.name: hashlib.sha256(archive.extractfile(member).read()).hexdigest()
                for member in archive.getmembers() if member.isfile()}
    if archived != manifest['file_sha256']:
        archive_errors.append('Archived source does not match the source manifest.')
missing = []
for report in root.rglob('*.md'):
    if '/research/' in str(report) or '/checks/' in str(report):
        continue
    for link in re.findall(r'\]\(([^\s)]+)\)', report.read_text()):
        if '://' in link or link.startswith('#'):
            continue
        link = re.sub(r':\d+$', '', link.split('#')[0].strip('<>'))
        if link and not (report.parent / link).exists():
            missing.append({'file': str(report.relative_to(root)), 'target': link})
research_archive_errors = []
research_payloads = {}
research_archive = root / 'research/evidence.tar.gz'
if research_archive.exists():
    archive_record = json.loads((root / 'research/archive-manifest.json').read_text())
    if hashlib.sha256(research_archive.read_bytes()).hexdigest() != archive_record['sha256']:
        research_archive_errors.append('Research archive hash changed.')
    with tarfile.open(research_archive, 'r:gz') as archive:
        hashes = {}
        for member in archive.getmembers():
            if not member.isfile():
                continue
            payload = archive.extractfile(member).read()
            hashes[member.name] = hashlib.sha256(payload).hexdigest()
            if Path(member.name).name in ('search.json', 'usage.json'):
                research_payloads['research/' + member.name] = payload
        if hashes != archive_record['file_sha256']:
            research_archive_errors.append('Research contents do not match the archive manifest.')
for output in (root / 'research').rglob('*.json'):
    if output.name in ('search.json', 'usage.json'):
        research_payloads[str(output.relative_to(root))] = output.read_bytes()
costs = []
for name, payload in sorted(research_payloads.items()):
    if Path(name).name != 'search.json':
        continue
    try:
        data = json.loads(payload)
        if not isinstance(data, dict):
            continue
        usage = data.get('usage', {})
        cost = usage.get('cost_usd') if isinstance(usage, dict) else None
        companion = str(Path(name).with_name('usage.json'))
        if cost is None and companion in research_payloads:
            usage = json.loads(research_payloads[companion])
            cost = usage.get('cost_usd', usage.get('total_cost_usd'))
        if isinstance(cost, (int, float)):
            costs.append({'path': name, 'status': data.get('status'), 'cost_usd': cost})
    except (ValueError, OSError):
        continue
usage = {
    'authorized_limit_usd': 250,
    'jev_reported_or_reserved_usd': round(sum(row['cost_usd'] for row in costs), 9),
    'jev_runs': costs,
    'other_provider_cost': 'Unknown where tools expose no dollar charge; query counts are bounded by reviewer contracts.',
}
(root / 'research/usage.json').write_text(json.dumps(usage, indent=2) + '\n')
result = {
    'baseline': manifest['revision'], 'current_head': head,
    'head_matches': head == manifest['revision'],
    'tracked_files': len(manifest['file_sha256']), 'source_drift': drift,
    'missing_document_links': missing,
    'report_count': len(list((root / 'reports').rglob('*.md'))),
    'audit_bytes': sum(f.stat().st_size for f in root.rglob('*') if f.is_file()),
    'jev_reported_or_reserved_usd': usage['jev_reported_or_reserved_usd'],
    'reviewed_checkout_delta': reviewed_drift,
    'unreviewed_checkout_delta': unreviewed_drift,
    'new_tracked_source_files': source_additions,
    'source_archive_errors': archive_errors,
    'research_archive_errors': research_archive_errors,
}
queue = json.loads((root / 'checks/concern-queue.json').read_text())
result['focused_reviews_complete'] = sum(row['state'] == 'complete' for row in queue)
result['focused_reviews_expected'] = len(queue)
final_errors = []
package_limits = []
if '--final' in sys.argv:
    package_checks = root / 'checks/final-package-results.json'
    if not package_checks.exists():
        final_errors.append('Missing normal repository checks after audit packaging.')
    else:
        final_checks = json.loads(package_checks.read_text())
        failures = [row for row in final_checks['results'] if row['exit_code'] != 0]
        isolated_file = root / 'checks/isolated-package-typescript.json'
        isolated = json.loads(isolated_file.read_text()) if isolated_file.exists() else {}
        isolated_scope_passed = (
            len(failures) == 1 and failures[0]['name'] == 'typescript'
            and isolated.get('status') == 'passed' and isolated.get('exit_code') == 0
            and isolated.get('source_baseline') == manifest['revision']
            and isolated.get('tracked_source_hashes_verified') == 199
            and isolated.get('audit_package_copied') is True
            and isolated.get('all_outside_paths_ignored') is True
            and isolated.get('outside_baseline_paths')
            and not set(isolated['outside_baseline_paths']) & set(manifest['file_sha256']))
        if len(final_checks['results']) != 5 or (failures and not isolated_scope_passed):
            final_errors.append('Required audit package checks lack passing evidence.')
        elif isolated_scope_passed:
            package_limits.append('The checkout TypeScript check failed on concurrent ignored Pagebook captures. '
                                  'The exact frozen source plus audit package passed an isolated TypeScript check. '
                                  'The original checkout failure remains recorded.')
    if result['focused_reviews_complete'] != 40:
        final_errors.append('Forty focused concern reviews must complete.')
    for name in ['REPORT.md', 'reports/09-overall-astra.md', 'reports/09-overall-daybreak.md']:
        if not (root / name).is_file():
            final_errors.append('Missing final artifact: ' + name)
    if any(path.suffix in {'.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.go'}
           for path in root.rglob('*') if path.is_file()):
        final_errors.append('Archive audit probe source before final validation.')
    sessions = json.loads((root / 'checks/reviewer-sessions.json').read_text())
    if (len(sessions) != 58 or len({row['session'] for row in sessions}) != 58
            or any(row['state'] != 'complete' or row['effort'] != 'xhigh' for row in sessions)):
        final_errors.append('Require 58 distinct completed xhigh review sessions.')
    for model in ('gpt-6-astra', 'gpt-daybreak-blue-latest'):
        if sum(row['model'] == model for row in sessions) != 29:
            final_errors.append('Require 29 review sessions for ' + model)
    if result['report_count'] != 58:
        final_errors.append('Require 58 independent reports.')
    decisions = json.loads((root / 'reconciliation.json').read_text())
    if (len(decisions) != 20 or len({row['id'] for row in decisions}) != 20
            or any(row['overall_review'] != 'complete' for row in decisions)):
        final_errors.append('Require 20 reconciled decisions after overall review.')
    coverage = json.loads((root / 'checks/coverage-map.json').read_text())['files']
    if set(coverage) != set(manifest['file_sha256']) or any(not areas for areas in coverage.values()):
        final_errors.append('Source coverage does not include every baseline file.')
    probe_map = root / 'checks/source-archive-map.json'
    if not probe_map.exists():
        final_errors.append('Missing source probe archive map.')
    else:
        for row in json.loads(probe_map.read_text()):
            target = root / row['archived']
            if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != row['sha256']:
                final_errors.append('Changed archived probe: ' + row['archived'])
result['final_errors'] = final_errors
result['final_package_limits'] = package_limits
(root / 'checks/audit-integrity.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
raise SystemExit(bool(missing or drift['snapshot'] or unreviewed_drift
                      or source_additions or archive_errors or research_archive_errors or final_errors
                      or not result['head_matches']))
