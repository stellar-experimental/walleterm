#!/usr/bin/env python3
"""Read-only C19 verification. Write evidence only inside the assigned directories."""
import hashlib
import json
import re
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path('/Users/kalepail/Desktop/walleterm-v2')
AUDIT = REPO / 'audit/2026-09-26'
FROZEN = Path('/private/tmp/walleterm-audit-40d6cca9db73')
REV = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
OUT = AUDIT / 'checks/concerns/c19-astra'
RESEARCH = AUDIT / 'research/concerns/c19-astra'
commands = []


def run(args, cwd=REPO, input_text=None):
    result = subprocess.run(args, cwd=cwd, input=input_text, text=True, capture_output=True)
    commands.append(dict(argv=args, cwd=str(cwd), exit_code=result.returncode,
                         stdout=result.stdout, stderr=result.stderr))
    assert result.returncode == 0, commands[-1]
    return result.stdout


manifest = json.loads((AUDIT / 'manifest.json').read_text())
assert manifest['revision'] == REV
tree = {}
for entry in run(['git', 'ls-tree', '-rz', '--full-tree', REV]).split('\0'):
    if entry:
        meta, name = entry.split('\t', 1)
        mode, kind, oid = meta.split()
        assert kind == 'blob'
        tree[name] = oid
assert set(tree) == set(manifest['file_sha256'])
mismatches = []
for name, oid in tree.items():
    data = (FROZEN / name).read_bytes()
    if (hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() != oid
            or hashlib.sha256(data).hexdigest() != manifest['file_sha256'][name]):
        mismatches.append(name)
assert not mismatches, mismatches
tracked_snapshots = [name for name in tree if 'test_snapshots' in Path(name).parts]
assert not tracked_snapshots
assert (REPO / '.gitignore').read_bytes() == (FROZEN / '.gitignore').read_bytes()

roots = ['fixtures/cap85/contracts', 'fixtures/cap85/contracts-sdk27']
directories = run(['find', *roots, '-type', 'd', '-name', 'test_snapshots', '-prune', '-print'], FROZEN).splitlines()
generated = sorted(str(p.relative_to(FROZEN)) for name in directories
                   for p in (FROZEN / name).rglob('*') if p.is_file())
assert generated
ignored = run(['git', 'check-ignore', '--no-index', '-v', '--stdin'], input_text='\n'.join(generated) + '\n')
assert len(ignored.splitlines()) == len(generated)
assert all(line.startswith('.gitignore:27:**/test_snapshots/\t') for line in ignored.splitlines())
run(['sh', '-n', 'fixtures/cap85/build.sh'], FROZEN)
references = []
pattern = re.compile(r'test_snapshots|from_(?:ledger_)?snapshot_file|assert_snapshot|Snapshot::read_file')
for name in tree:
    if name.endswith(('.rs', '.ts', '.sh', '.yml', '.yaml')) or name == 'Makefile':
        for number, line in enumerate((FROZEN / name).read_text().splitlines(), 1):
            if pattern.search(line):
                references.append(dict(path=name, line=number, text=line))
assert [r['path'] for r in references] == ['fixtures/cap85/build.sh']
tests = sorted(name for name in tree if name.startswith('fixtures/cap85/') and name.endswith('/src/test.rs'))
assert len(tests) == 5
assertion_counts = {name: len(re.findall(r'\bassert(?:_eq|_ne)?!', (FROZEN / name).read_text())) for name in tests}

registry = Path('/Users/kalepail/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f')
sdk_evidence = []
excerpts = []
for root in roots:
    lock = (FROZEN / root / 'Cargo.lock').read_text()
    block = next(b for b in lock.split('[[package]]') if '\nname = "soroban-sdk"\n' in b)
    package = dict(re.findall(r'^([a-z]+) = "([^"]*)"$', block, re.MULTILINE))
    sdk = registry / ('soroban-sdk-' + package['version'])
    archive = registry.parent.parent / 'cache' / registry.name / (sdk.name + '.crate')
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == package['checksum']
    vcs = json.loads((sdk / '.cargo_vcs_info.json').read_text())
    version = package['version']
    spans = {'src/env.rs': [(267, 287), (1920, 1960), (2034, 2122)] if version == '27.0.6'
             else [(322, 342), (1986, 2030), (2108, 2193)], 'src/testutils.rs': [(73, 109)]}
    files = {}
    for filename, ranges in spans.items():
        data = (sdk / filename).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        with tarfile.open(archive) as tar:
            assert data == tar.extractfile(sdk.name + '/' + filename).read()
        files[filename] = digest
        lines = data.decode().splitlines()
        for start, end in ranges:
            excerpts.append(f'\n{sdk / filename}:{start}-{end}\n' + '\n'.join(
                f'{n}: {lines[n-1]}' for n in range(start, min(end, len(lines))+1)))
    sdk_evidence.append(dict(workspace=root, version=version, package_checksum=package['checksum'],
                             vcs=vcs, source_sha256=files))

OUT.mkdir(parents=True, exist_ok=True)
RESEARCH.mkdir(parents=True, exist_ok=True)
(RESEARCH / 'sdk-source-excerpts.txt').write_text('\n'.join(excerpts) + '\n')
(RESEARCH / 'sdk-provenance.json').write_text(json.dumps(sdk_evidence, indent=2) + '\n')
result = dict(checked_utc=datetime.now(timezone.utc).isoformat(), baseline=REV,
              status='passed', tracked_file_count=len(tree), manifest_file_count=len(manifest['file_sha256']),
              frozen_hash_mismatches=mismatches, tracked_test_snapshots=tracked_snapshots,
              manifest_test_snapshots=[p for p in manifest['file_sha256'] if 'test_snapshots' in Path(p).parts],
              cleanup_directories=directories, generated_files=generated, generated_file_count=len(generated),
              all_generated_files_ignored=True, source_snapshot_references=references,
              fixture_assertion_counts=assertion_counts, sdk_versions=[s['version'] for s in sdk_evidence],
              cleanup_executed=False, build_executed=False, cargo_tests_executed=False,
              commands=commands)
(OUT / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: result[k] for k in ['status', 'tracked_file_count', 'manifest_file_count',
                 'frozen_hash_mismatches', 'tracked_test_snapshots', 'generated_file_count',
                 'all_generated_files_ignored', 'sdk_versions', 'fixture_assertion_counts']}, indent=2))
