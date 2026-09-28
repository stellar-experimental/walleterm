from pathlib import Path
import hashlib
import json
import subprocess

base = Path('/private/tmp/walleterm-audit-40d6cca9db73')
repo = Path('/Users/kalepail/Desktop/walleterm-v2')
revision = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
files = [str(p.relative_to(base)) for p in sorted((base / 'sdk').glob('*'))]
files += [
    'AGENTS.md', 'README.md', 'docs/PLAN.md', 'docs/INTERFACE.md',
    'docs/WEB-BRIDGE.md', 'docs/CONNECTION-UI.md', 'package.json', 'bun.lock',
    'scripts/build.ts', 'bridge/sdk.test.ts', 'bridge/connect.test.ts',
    'bridge/scan.test.ts', 'bridge/server.test.ts', 'bridge/server.ts',
    'bridge/transaction.ts', 'bridge/test/support.ts', 'demo/site/app.ts',
]
rows = []
for name in files:
    data = (base / name).read_bytes()
    expected = subprocess.check_output(['git', '-C', str(repo), 'show', revision + ':' + name])
    rows.append({'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'matches_revision': data == expected})
versions = {
    name: json.loads((base / 'node_modules' / name / 'package.json').read_text())['version']
    for name in ['@stellar/stellar-sdk', 'jsqr', 'qrcode', 'typescript']
}
result = {
    'revision': revision, 'snapshot': str(base), 'files': rows,
    'dependency_versions': versions,
    'bun': subprocess.check_output(['bun', '--version'], text=True).strip(),
}
Path(__file__).with_name('source-identity.json').write_text(json.dumps(result, indent=2) + '\n')
assert all(row['matches_revision'] for row in rows)
print(json.dumps({'verified_files': len(rows), 'matches_revision': True, 'versions': versions}))
