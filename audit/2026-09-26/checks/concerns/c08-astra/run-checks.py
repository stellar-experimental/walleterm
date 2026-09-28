import hashlib
import json
import pathlib
import shlex
import subprocess

repo = pathlib.Path('/Users/kalepail/Desktop/walleterm-v2')
snapshot = pathlib.Path('/private/tmp/walleterm-audit-40d6cca9db73')
output = pathlib.Path(__file__).resolve().parent
revision = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
manifest = json.loads((repo / 'audit/2026-09-26/manifest.json').read_text())
rows = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-rz', revision]).split(b'\0')
mismatches = []
tracked = []
for row in rows:
    if not row:
        continue
    metadata, name = row.split(b'\t')
    name = name.decode()
    data = (snapshot / name).read_bytes()
    expected = metadata.split()[2].decode()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    sha256 = hashlib.sha256(data).hexdigest()
    tracked.append(name)
    if actual != expected or sha256 != manifest['file_sha256'].get(name):
        mismatches.append(name)
integrity = {
    'revision': revision,
    'snapshot': str(snapshot),
    'tracked_files': len(tracked),
    'manifest_paths_match': set(tracked) == set(manifest['file_sha256']),
    'mismatches': mismatches,
    'sdk_version': json.loads((snapshot / 'node_modules/@stellar/stellar-sdk/package.json').read_text())['version'],
}
(output / 'integrity.json').write_text(json.dumps(integrity, indent=2) + '\n')
assert manifest['revision'] == revision
assert integrity['manifest_paths_match'] and not mismatches

commands = [
    ('version.log', snapshot, ['bun', '--version']),
    ('reproductions.log', repo, [
        'bun', 'test', 'audit/2026-09-26/checks/05-demo-astra/adversarial.test.ts',
        '-t', 'malformed success JSON|different confirmed hash|malformed JSON and tx_bad_seq|normal reload submits',
    ]),
    ('recovery.log', snapshot, [
        'bun', 'test', 'bridge/site.test.ts', '-t',
        'unknown submission remains protected after reload|another tab cannot overwrite an unknown submission|unknown submission expires only',
    ]),
]
results = []
for filename, cwd, argv in commands:
    completed = subprocess.run(argv, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (output / filename).write_text(completed.stdout)
    results.append({'cwd': str(cwd), 'argv': argv, 'command': shlex.join(argv),
                    'exit_code': completed.returncode, 'log': filename})
    print(json.dumps(results[-1]))
(output / 'commands.json').write_text(json.dumps(results, indent=2) + '\n')
assert all(result['exit_code'] == 0 for result in results)
print(json.dumps(integrity))
