import hashlib
import json
import pathlib
import subprocess

revision = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
snapshot = pathlib.Path('/private/tmp/walleterm-audit-40d6cca9db73')
repo = pathlib.Path('/Users/kalepail/Desktop/walleterm-v2')
rows = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-rz', revision]).split(b'\0')
checked = 0
mismatches = []
for row in rows:
    if not row:
        continue
    metadata, name = row.split(b'\t')
    _, _, expected = metadata.split()
    data = (snapshot / name.decode()).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    checked += 1
    if actual != expected.decode():
        mismatches.append(name.decode())
result = {'revision': revision, 'snapshot': str(snapshot), 'tracked_files': checked, 'mismatches': mismatches}
pathlib.Path(__file__).with_name('snapshot-integrity.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
raise SystemExit(bool(mismatches))
