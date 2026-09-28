"""C12 only: verify frozen inputs, rerun the preserved mock, and test a guard.

No network, real cached checkout, compiler, signer, or deployment is used.
All new Git state belongs to temporary mock repositories under /private/tmp.
"""
from pathlib import Path
import hashlib
import json
import os
import platform
import subprocess
import tempfile

AUDIT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
FROZEN = Path('/private/tmp/walleterm-audit-40d6cca9db73')
REVISION = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
PIN = 'a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640'
ENV = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}
commands = []


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def run(args, cwd=None, check=True):
    result = subprocess.run(args, cwd=cwd, env=ENV, capture_output=True, text=True)
    commands.append({'argv': args, 'cwd': str(cwd) if cwd else None,
                     'exit_code': result.returncode})
    if check:
        assert result.returncode == 0, result.stderr
    return result


manifest = json.loads((AUDIT / 'manifest.json').read_text())
assert manifest['revision'] == REVISION
fixture_manifest = json.loads((FROZEN / 'fixtures/wasm/manifest.json').read_text())
assert fixture_manifest['oz_commit'] == PIN
artifacts = [name for name in fixture_manifest['artifacts'] if name.startswith('multisig_')]
assert len(artifacts) == 4
paths = ['fixtures/build.sh', 'fixtures/manifest.ts', 'fixtures/wasm/manifest.json',
         'fixtures/README.md', 'tests/contracts.ts', 'tests/extended-contracts.ts']
paths += ['fixtures/wasm/' + name for name in artifacts]
source_hashes = {name: digest(FROZEN / name) for name in paths}
assert all(value == manifest['file_sha256'][name] for name, value in source_hashes.items())
artifact_results = {}
for name in artifacts:
    item = fixture_manifest['artifacts'][name]
    file = FROZEN / 'fixtures/wasm' / name
    assert digest(file) == item['sha256']
    assert file.stat().st_size == item['bytes']
    assert item['commit'] == PIN
    artifact_results[name] = {'sha256': digest(file), 'bytes': file.stat().st_size,
                              'manifest_match': True, 'baseline_match': True}

primary_dir = AUDIT / 'research/06-contracts-astra'
index = json.loads((primary_dir / 'primary-source-index.json').read_text())
primary = next(item for item in index if item['file'] == 'oz-account.rs')
assert digest(primary_dir / primary['file']) == primary['sha256']

repro = AUDIT / 'checks/06-contracts-astra/provenance-repro.py'
reproduced = run(['python3', str(repro)])
(OUT / 'provenance-rerun.json').write_text(reproduced.stdout)
(OUT / 'provenance-rerun.stderr.txt').write_text(reproduced.stderr)
result = json.loads(reproduced.stdout)
assert result == json.loads((repro.parent / 'provenance-result.json').read_text())
assert result['source_script_sha256'] == source_hashes['fixtures/build.sh']

guard_results = []
with tempfile.TemporaryDirectory(prefix='c12-astra-guard-', dir='/private/tmp') as tmp:
    root = Path(tmp)
    run(['git', 'init', '-q', str(root)])
    tracked = root / 'contract.rs'
    tracked.write_text('reviewed source\n')
    run(['git', '-C', str(root), 'add', 'contract.rs'])
    run(['git', '-C', str(root), '-c', 'user.name=Offline Audit',
         '-c', 'user.email=offline@example.invalid', '-c', 'commit.gpgsign=false',
         'commit', '-qm', 'isolated mock source'])
    head = run(['git', '-C', str(root), 'rev-parse', 'HEAD']).stdout.strip()
    for case in ['clean', 'unstaged', 'staged']:
        if case == 'unstaged':
            tracked.write_text('developer change\n')
        if case == 'staged':
            run(['git', '-C', str(root), 'add', 'contract.rs'])
        before = {'file': digest(tracked), 'index': digest(root / '.git/index'),
                  'head': run(['git', '-C', str(root), 'rev-parse', 'HEAD']).stdout.strip()}
        git_status = run(['git', '-C', str(root), 'status', '--porcelain']).stdout.rstrip('\n')
        guard = run(['sh', '-c',
                     'git -C "$1" diff --quiet -- && git -C "$1" diff --cached --quiet --',
                     'c12-guard', str(root)], check=False)
        after = {'file': digest(tracked), 'index': digest(root / '.git/index'),
                 'head': run(['git', '-C', str(root), 'rev-parse', 'HEAD']).stdout.strip()}
        assert before == after
        assert after['head'] == head
        assert guard.returncode == (0 if case == 'clean' else 1)
        guard_results.append({'case': case, 'status': git_status,
                              'guard_exit': guard.returncode,
                              'file_index_head_preserved': before == after})

assert source_hashes == {name: digest(FROZEN / name) for name in paths}
summary = {
    'status': 'passed', 'revision': REVISION, 'platform': platform.platform(),
    'versions': {name: run(args).stdout.strip() for name, args in {
        'git': ['git', '--version'], 'bun': ['bun', '--version'],
        'python': ['python3', '--version']}.items()},
    'frozen_inputs_verified': source_hashes,
    'openzeppelin_artifacts': artifact_results,
    'preserved_primary_source': primary,
    'existing_reproduction_sha256': digest(repro),
    'reproduction_matches_preserved_result': True,
    'guard_results': guard_results,
    'frozen_inputs_unchanged': True,
    'limits': ['The compiler stub produces source bytes, not executable WASM.',
               'Guard checks run alone; no production fix was applied.',
               'No historical source-equivalent build was established.',
               'Untracked inputs and concurrent source mutation are outside C12.'],
    'new_research_cost_usd': 0, 'new_jev_cost_usd': 0,
}
(OUT / 'check-result.json').write_text(json.dumps(summary, indent=2) + '\n')
(OUT / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'frozen_inputs': len(paths),
                  'artifacts': len(artifacts), 'reproduction': 'passed',
                  'guard_cases': len(guard_results), 'research_cost_usd': 0}))
