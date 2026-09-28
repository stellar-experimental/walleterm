import datetime
import hashlib
import json
import subprocess
from pathlib import Path

revision = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
snapshot = Path('/private/tmp/walleterm-audit-40d6cca9db73')
repository = Path('/Users/kalepail/Desktop/walleterm-v2')
entries = []
for row in subprocess.check_output(['git', '-C', str(repository), 'ls-tree', '-rz', revision]).split(b'\0'):
    if not row:
        continue
    metadata, name = row.split(b'\t', 1)
    mode, kind, expected = metadata.split()
    relative = name.decode()
    data = (snapshot / relative).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    entries.append({
        'path': relative,
        'expected_git_blob': expected.decode(),
        'actual_git_blob': actual,
        'sha256': hashlib.sha256(data).hexdigest(),
        'matches': expected.decode() == actual,
    })
result = {
    'revision': revision,
    'snapshot': str(snapshot),
    'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'count': len(entries),
    'all_match': all(entry['matches'] for entry in entries),
    'entries': entries,
}
target = Path(__file__).with_name('source-manifest-final.json')
target.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({key: value for key, value in result.items() if key != 'entries'}, indent=2))
assert result['count'] == 199 and result['all_match']
