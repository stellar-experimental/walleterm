"""Run only C09 checks against the frozen source. Use existing offline tests."""
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

REPO = Path('/Users/kalepail/Desktop/walleterm-v2')
AUDIT = REPO / 'audit/2026-09-26'
OUT = Path(__file__).resolve().parent
MANIFEST = json.loads((AUDIT / 'manifest.json').read_text())
SNAPSHOT = Path(MANIFEST['source_snapshot'])
REVISION = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
assert MANIFEST['revision'] == REVISION


def integrity():
    command = ['git', '-C', str(REPO), 'ls-tree', '-rz', REVISION]
    rows = subprocess.check_output(command).split(b'\0')
    entries = {}
    for row in rows:
        if row:
            metadata, name = row.split(b'\t')
            entries[name.decode()] = metadata.split()[2].decode()
    assert set(entries) == set(MANIFEST['file_sha256'])
    mismatches = []
    for name, expected in entries.items():
        data = (SNAPSHOT / name).read_bytes()
        sha256 = hashlib.sha256(data).hexdigest()
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if sha256 != MANIFEST['file_sha256'][name] or blob != expected:
            mismatches.append(name)
    result = {'command': command, 'tracked_files': len(entries), 'mismatches': mismatches}
    assert not mismatches, result
    return result


results = {'revision': REVISION, 'snapshot': str(SNAPSHOT), 'before': integrity(), 'checks': []}
sdk = json.loads((SNAPSHOT / 'node_modules/@stellar/stellar-sdk/package.json').read_text())
assert sdk['version'] == '17.1.0'
results['sdk_version'] = sdk['version']
preserved = json.loads((AUDIT / 'research/05-demo-astra/sdk-source.json').read_text())
results['sdk_source_matches'] = []
for source in preserved['files']:
    actual = hashlib.sha256(Path(source['path']).read_bytes()).hexdigest()
    assert actual == source['sha256']
    results['sdk_source_matches'].append({'path': source['path'], 'sha256': actual})

checks = [
    ('restoration.log', REPO, [
        'bun', 'test', 'audit/2026-09-26/checks/05-demo-astra/adversarial.test.ts', '-t',
        'fresh signing|finding: restored|storage failure before submission|storage failure after POST|'
        'unavailable Web Locks|normal reload|quota error saving waiting',
    ]),
    ('guards.log', SNAPSHOT, [
        'bun', 'test', 'bridge/site.test.ts', '-t',
        'wallet changes preserve|an unreadable journal|a damaged journal|another tab cannot|'
        'a saved review with invalid XDR|an unknown submission expires',
    ]),
]
for filename, cwd, command in checks:
    completed = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, timeout=60)
    (OUT / filename).write_text(completed.stdout)
    results['checks'].append({'cwd': str(cwd), 'command': command,
                              'exit_code': completed.returncode, 'log': filename})
    print(f'{filename}: exit {completed.returncode}')
    print(completed.stdout)
results['after'] = integrity()
results['research'] = {'new_calls': 0, 'new_cost_usd': 0, 'new_jev_cost_usd': 0}
(OUT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
lines = ['# C09 check commands', '', 'Run the check driver from the caller repository:', '',
         '```sh', 'python3 audit/2026-09-26/checks/concerns/c09-astra/run-checks.py', '```', '',
         'The driver checks all manifest files against the baseline Git tree before and after execution.',
         'It also checks the SDK version and preserved SDK source hashes.', '',
         'Git inventory command:', '', '```sh', shlex.join(results['before']['command']), '```', '']
for check in results['checks']:
    lines += [f"Working directory: `{check['cwd']}`.", '', '```sh',
              shlex.join(check['command']), '```', '',
              f"Exit: `{check['exit_code']}`. Evidence: `{check['log']}`.", '']
lines += ['All fetches use in-memory mocks. The tests open no sockets.',
          'The existing adversarial tests use isolated mock keys and SDK 17.1.0 envelopes.',
          'The site tests use mocked browser APIs. They do not establish browser implementation behavior.',
          'Filtered tests remain skipped. No full baseline suite ran.',
          'Passing fault reproductions establish current behavior. They do not establish a fix.', '']
(OUT / 'COMMANDS.md').write_text('\n'.join(lines))
print('Integrity: 199 tracked files matched before and after execution.')
raise SystemExit(any(check['exit_code'] for check in results['checks']))
