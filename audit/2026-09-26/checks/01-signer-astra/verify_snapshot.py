from pathlib import Path
import hashlib
import json
import subprocess

base = Path(__file__).resolve().parent
repo = base.parents[3]
snapshot = Path('/private/tmp/walleterm-audit-40d6cca9db73')
revision = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
rows = []
for entry in subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-r', '-z', revision]).split(b'\0'):
    if not entry:
        continue
    meta, name = entry.split(b'\t', 1)
    mode, kind, expected = meta.decode().split()
    relative = name.decode()
    body = (snapshot / relative).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest()
    rows.append({'path': relative, 'git_blob': expected, 'actual_blob': actual, 'match': expected == actual})
copies = {name: (base/name).read_bytes() == (snapshot/name).read_bytes()
          for name in ['main.go', 'service.go', 'main_test.go', 'go.mod']}
result = {'revision': revision, 'files': rows, 'all_match': all(r['match'] for r in rows), 'check_copies_match': copies}
(base / 'snapshot-verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'revision': revision, 'files': len(rows), 'all_match': result['all_match'], 'check_copies_match': copies}))
if not result['all_match'] or not all(copies.values()):
    raise SystemExit(1)
