#!/usr/bin/env python3
"""Verify C01 evidence and run only existing offline deadline/output checks."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

REPO = Path('/Users/kalepail/Desktop/walleterm-v2')
AUDIT = REPO / 'audit/2026-09-26'
HERE = AUDIT / 'checks/concerns/c01-astra'
SNAPSHOT = Path('/private/tmp/walleterm-audit-40d6cca9db73')
REVISION = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
SCOPED = ['AGENTS.md', 'README.md', 'docs/PLAN.md', 'docs/INTERFACE.md',
          'main.go', 'main_test.go', 'service.go', 'go.mod',
          'bridge/signer.ts', 'bridge/runtime.ts']

def digest(data):
    return hashlib.sha256(data).hexdigest()

def save(name, value):
    (HERE / name).write_text(json.dumps(value, indent=2) + '\n')

def verify():
    manifest = json.loads((AUDIT / 'manifest.json').read_text())
    assert manifest['revision'] == REVISION
    tree_command = ['git', '-C', str(REPO), 'ls-tree', '-r', '--name-only', REVISION]
    tree = subprocess.check_output(tree_command, text=True).splitlines()
    assert set(tree) == set(manifest['file_sha256'])
    mismatches = [name for name, expected in manifest['file_sha256'].items()
                  if digest((SNAPSHOT / name).read_bytes()) != expected]
    assert not mismatches, mismatches
    scoped = []
    for name in SCOPED:
        command = ['git', '-C', str(REPO), 'show', f'{REVISION}:{name}']
        expected = subprocess.check_output(command)
        actual = (SNAPSHOT / name).read_bytes()
        assert expected == actual, name
        scoped.append({'file': name, 'sha256': digest(actual), 'git_command': command})
    preserved = {}
    for name in ['audit_test.go', 'audit-output-deadline.log', 'audit-output-deadline.exit']:
        item = AUDIT / 'checks/01-signer-astra' / name
        preserved[str(item.relative_to(AUDIT))] = digest(item.read_bytes())
    save('verification.json', {
        'checked_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'revision': REVISION, 'snapshot': str(SNAPSHOT), 'tree_command': tree_command,
        'manifest_files_matched': len(tree), 'scoped_git_matches': scoped,
        'preserved_evidence_sha256': preserved, 'outcome': 'passed'})
    print(f'PASS: {len(tree)} manifest files; {len(scoped)} scoped Git matches')

def sources():
    goroot = Path(subprocess.check_output(['go', 'env', 'GOROOT'], text=True).strip())
    version = subprocess.check_output(['go', 'version'], text=True).strip()
    excerpts = [version, 'Accessed: ' + datetime.datetime.now(datetime.timezone.utc).isoformat()]
    records = []
    for name, start, end in [('net/net.go', 147, 180), ('os/file.go', 650, 693)]:
        item = goroot / 'src' / name
        contents = item.read_bytes()
        url = 'https://go.dev/src/' + name
        records.append({'path': str(item), 'sha256': digest(contents), 'url': url,
                        'version': version, 'lines': [start, end]})
        excerpts += ['', str(item), url]
        excerpts += [f'{i}: {line}' for i, line in enumerate(contents.decode().splitlines(), 1)
                     if start <= i <= end]
    (HERE / 'go-primary-excerpts.txt').write_text('\n'.join(excerpts) + '\n')
    save('go-primary-manifest.json', records)
    print(version + '; retained two local primary-source excerpts')

def tests(label):
    temporary = Path(tempfile.mkdtemp(prefix='wt-c01-astra-', dir='/private/tmp'))
    for name in ['cache', 'tmp']:
        (temporary / name).mkdir()
    overrides = {'GOCACHE': str(temporary / 'cache'), 'GOTMPDIR': str(temporary / 'tmp'),
                 'TMPDIR': str(temporary / 'tmp'), 'GOPROXY': 'off', 'GOSUMDB': 'off',
                 'GOTOOLCHAIN': 'local'}
    environment = os.environ.copy()
    environment.update(overrides)
    selection = ('^(TestListAndSignWithOfflineMock|TestListAndSignOutputFailure|'
                 'TestDiagnosticFailurePreventsSigning|TestAgentReadDeadlineReturnsTimeout|'
                 'TestInputReadDeadlineReturnsTimeout)$')
    command = ['go', 'test', '-count=1', '-race', '-run', selection, '-timeout=20s', '-v',
               'main.go', 'service.go', 'main_test.go']
    result = subprocess.run(command, cwd=SNAPSHOT, env=environment,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180)
    (HERE / f'{label}.log').write_text(result.stdout)
    save(f'{label}.json', {'command': command, 'cwd': str(SNAPSHOT), 'env': overrides,
                         'exit': result.returncode, 'log': f'{label}.log'})
    print(result.stdout)
    raise SystemExit(result.returncode)

if __name__ == '__main__':
    if sys.argv[1] == 'verify':
        verify()
        sources()
    elif sys.argv[1] == 'tests':
        tests(sys.argv[2])
    else:
        raise SystemExit('Expected verify or tests LABEL')
