from pathlib import Path
import hashlib, json, re, subprocess

root = Path('/private/tmp/walleterm-audit-40d6cca9db73')
repo = '/Users/kalepail/Desktop/walleterm-v2'
revision = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
rows = subprocess.check_output(['git', '-C', repo, 'ls-tree', '-rz', revision]).split(b'\0')
files = []
for row in rows:
    if not row: continue
    meta, name = row.split(b'\t', 1)
    mode, kind, expected = meta.decode().split()
    p = root / name.decode()
    data = p.read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    files.append({'path': name.decode(), 'matches': actual == expected, 'git_blob': actual})
manifest = json.loads((root / 'fixtures/cap85/wasm/manifest.json').read_text())
sources = []
for name, expected in manifest['sources'].items():
    actual = hashlib.sha256((root / 'fixtures/cap85' / name).read_bytes()).hexdigest()
    sources.append({'path': name, 'expected': expected, 'actual': actual, 'matches': actual == expected})
versions = {}
for p in sorted((root / 'fixtures').rglob('Cargo.lock')):
    if 'target' in p.parts: continue
    versions[str(p.relative_to(root))] = dict(re.findall(r'name = "(soroban-sdk|soroban-env-host|stellar-xdr)"\nversion = "([^"]+)"', p.read_text()))
print(json.dumps({'revision': revision, 'tracked_count': len(files), 'all_match': all(x['matches'] for x in files), 'files': files, 'cap85_manifest_sources': sources, 'versions': versions}, indent=2))
