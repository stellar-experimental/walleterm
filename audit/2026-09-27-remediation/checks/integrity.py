"""Check final remediation scope, source identity, review records, and document links."""
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parents[1]
repo = root.parents[1]

def read(name):
    return json.loads((root/name).read_text())

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

baseline = read('baseline.json')
queue = read('queue.json')
sessions = read('sessions.json')
final_source = read('checks/final-source.json')
errors = []
allowed = {name for row in queue for name in row['allowed_files']}
changed = [name for name, sha in baseline['initial_tracked_sha256'].items()
           if digest(repo/name) != sha]
unexpected = sorted(set(changed)-allowed)
errors.extend(f'Unexpected source change: {name}' for name in unexpected)
source_drift = [name for name, sha in final_source.items() if digest(repo/name) != sha]
errors.extend(f'Changed after verification: {name}' for name in source_drift)
extra = subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z'], cwd=repo).decode().split('\0')
extra = [name for name in extra if name and not name.startswith('audit/')]
errors.extend(f'Unexpected new source: {name}' for name in extra if name not in allowed)
protected = '.agents/skills/walleterm-site-bridge/references/interception.md'
protected_ok = digest(repo/protected) == baseline['initial_tracked_sha256'][protected]
if not protected_ok:
    errors.append('Preexisting interception document changed.')
head = subprocess.check_output(['git','rev-parse','HEAD'], cwd=repo, text=True).strip()
if head != baseline['head']:
    errors.append('HEAD changed.')
if not all(row['state'] in ('accepted','deferred') for row in queue):
    errors.append('Unfinished queue item.')
if not all(row['state'] == 'complete' for row in sessions):
    errors.append('Unfinished worker session.')

original = repo/'audit/2026-09-26'
expected_original = read('checks/original-audit-sha256.json')
actual_original = {str(p.relative_to(original)):digest(p) for p in original.rglob('*') if p.is_file()}
if actual_original != expected_original:
    errors.append('Original audit changed during final packaging.')
latest_original = max(p.stat().st_mtime for p in original.rglob('*') if p.is_file())
original_predates = latest_original < datetime.fromisoformat(baseline['started_utc']).timestamp()
if not original_predates:
    errors.append('An original audit file has a remediation-period modification time.')

missing_links = []
for document in [repo/'audit/README.md', *root.rglob('*.md')]:
    for target in re.findall(r'\[[^\]]+\]\(([^\n)]+)\)', document.read_text()):
        target = unquote(target.split('#',1)[0]).strip('<>')
        if not target or '://' in target or target.startswith('mailto:'):
            continue
        if (document.parent/target).resolve() == root/'checks/integrity.json':
            continue  # This invocation writes the referenced result below.
        if not (document.parent/target).exists():
            missing_links.append(dict(document=str(document.relative_to(repo)), target=target))
errors.extend(f'Missing link: {item}' for item in missing_links)
verification = read('checks/verification.json')
unexpected_checks = [row['name'] for row in verification
                     if row['exit_code'] and row['name'] != 'checkout-typescript']
errors.extend(f'Failed check: {name}' for name in unexpected_checks)
checkout_limits = read('checks/checkout-typescript-scope.json') if (root/'checks/checkout-typescript-scope.json').exists() else None
if any(row['name']=='checkout-typescript' and row['exit_code'] for row in verification):
    if not checkout_limits or not checkout_limits['paths']:
        errors.append('Unclassified checkout TypeScript failure.')
    elif not all(name.startswith('evidence/pagebook-2026-09-26/') and checkout_limits['ignored'][name]
                 for name in checkout_limits['paths']):
        errors.append('Checkout TypeScript failure outside the known ignored captures.')

result = dict(
    recorded_utc=datetime.now(timezone.utc).isoformat(), head=head,
    accepted=[row['id'] for row in queue if row['state']=='accepted' and row.get('kind')!='verification_correction'],
    verification_corrections=[row['id'] for row in queue if row.get('kind')=='verification_correction'],
    deferred_selected=[row['id'] for row in queue if row['state']=='deferred'],
    changed_tracked_source=changed, new_source=extra,
    protected_user_change_preserved=protected_ok, verified_source_files=len(final_source),
    source_drift_after_verification=source_drift,
    original_audit_files=len(actual_original), original_audit_matches_packaging_snapshot=actual_original==expected_original,
    original_audit_latest_mtime=datetime.fromtimestamp(latest_original,timezone.utc).isoformat(),
    original_audit_mtimes_predate_remediation=original_predates,
    completed_sessions=len(sessions),
    review_sessions=[dict(name=s['name'],concern=s['concern'],verdict=s.get('verdict'))
                     for s in sessions if s['role']=='review'],
    missing_document_links=missing_links, checkout_typescript_limit=checkout_limits, errors=errors)
(root/'checks/integrity.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
raise SystemExit(bool(errors))
