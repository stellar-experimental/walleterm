"""Check C18 frozen documents without reading ignored live records."""
import hashlib
import json
import subprocess
from pathlib import Path

repo = Path('/Users/kalepail/Desktop/walleterm-v2')
audit = repo / 'audit/2026-09-26'
manifest = json.loads((audit / 'manifest.json').read_text())
root = Path(manifest['source_snapshot'])
revision = manifest['revision']
assert revision == '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
tracked = subprocess.check_output(
    ['git', '-C', str(repo), 'ls-tree', '-r', '--name-only', revision], text=True
).splitlines()
assert set(tracked) == set(manifest['file_sha256'])
selected = [
    'AGENTS.md', 'README.md', 'docs/PLAN.md', 'docs/INTERFACE.md',
    'docs/BUN-MIGRATION.md', 'docs/VAULT-FILTER-VALIDATION.md',
    'docs/WALLET-SWITCH-VALIDATION.md', 'evidence/README.md',
    'evidence/mobile-poc/README.md', 'evidence/browser-qa-2026-09-25/report.md',
] + [name for name in tracked if name.startswith('evidence/') and name.endswith('.json')]
verified = []
for name in selected:
    data = (root / name).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert digest == manifest['file_sha256'][name], name
    original = subprocess.check_output(['git', '-C', str(repo), 'show', f'{revision}:{name}'])
    assert data == original, name
    verified.append({'path': name, 'sha256': digest})

acceptance = json.loads((root / 'evidence/acceptance-summary.json').read_text())
protocol = json.loads((root / 'evidence/protocol-acceptance.json').read_text())
references = [
    acceptance['onepassword_lifecycle']['evidence'],
    acceptance['independent_installed_cli']['evidence'],
    protocol['installation'], protocol['final_state']['evidence'],
    *protocol['reviews'].values(),
]
missing = [
    {'path': 'evidence/' + name, 'in_baseline_tree': 'evidence/' + name in tracked}
    for name in references
]
assert len(missing) == 9 and not any(row['in_baseline_tree'] for row in missing)

tunnel = json.loads((root / 'evidence/tunnel-testnet-2026-09-25.json').read_text())
revisions = []
for recorded in [tunnel['revision'], tunnel['website_approval_run']['revision']]:
    full = subprocess.check_output(
        ['git', '-C', str(repo), 'rev-parse', recorded + '^{commit}'], text=True
    ).strip()
    ancestor = subprocess.run(
        ['git', '-C', str(repo), 'merge-base', '--is-ancestor', full, revision], capture_output=True
    ).returncode
    assert full != revision and ancestor == 0
    revisions.append({'recorded_revision': recorded, 'full_revision': full, 'baseline_ancestor': True})

preserved = json.loads((audit / 'checks/07-verification-astra/evidence-check.json').read_text())
reproduced = json.loads((audit / 'checks/concerns/c18-astra/evidence-check.json').read_text())
assert reproduced == preserved
result = {
    'revision': revision,
    'manifest_tree_paths': len(tracked),
    'verified_files': verified,
    'missing_local_references': missing,
    'tunnel_record_date': tunnel['date'],
    'historical_tunnel_revisions': revisions,
    'evidence_reproduction_matches_preserved_result': True,
    'new_research_cost_usd': 0,
    'new_jev_cost_usd': 0,
    'live_signing': 'not_run',
    'testnet_submission': 'not_run',
    'receipt_reconciliation': 'not_run',
    'ignored_local_records_read': False,
}
(audit / 'checks/concerns/c18-astra/provenance.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({
    'verified_files': len(verified), 'manifest_tree_paths': len(tracked),
    'absent_local_references': len(missing), 'tunnel_revisions': revisions,
    'preserved_reproduction_match': True,
}, indent=2))
