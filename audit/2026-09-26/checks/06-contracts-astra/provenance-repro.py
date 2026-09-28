"""Exercise the frozen build script with a local test commit and a build stub.

Only the pinned commit literal changes in the temporary script.
The build stub records the source bytes; it does not produce executable WASM.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

FROZEN = Path('/private/tmp/walleterm-audit-40d6cca9db73')
PIN = 'a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640'

def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()

with tempfile.TemporaryDirectory(prefix='06-contracts-provenance-', dir='/private/tmp') as tmp:
    root = Path(tmp)
    fixture = root / 'fixtures'
    source = fixture / '.oz-src'
    source.mkdir(parents=True)
    (fixture / 'contracts').mkdir()
    run(['git', 'init', '-q', str(source)])
    tracked = source / 'contract.rs'
    tracked.write_text('reviewed source\n')
    run(['git', '-C', str(source), 'add', 'contract.rs'])
    run(['git', '-C', str(source), '-c', 'user.name=Offline Audit',
         '-c', 'user.email=offline@example.invalid', '-c', 'commit.gpgsign=false',
         'commit', '-qm', 'isolated mock source'])
    commit = run(['git', '-C', str(source), 'rev-parse', 'HEAD'])
    tracked.write_text('unreviewed source change\n')
    script = (FROZEN / 'fixtures/build.sh').read_text()
    assert script.count(PIN) == 1
    (fixture / 'build.sh').write_text(script.replace(PIN, commit))
    shutil.copyfile(FROZEN / 'fixtures/manifest.ts', fixture / 'manifest.ts')
    binary = root / 'bin'
    binary.mkdir()
    stub = binary / 'stellar'
    stub.write_text('''#!/usr/bin/env python3
import pathlib,sys
args=sys.argv[1:]
out=pathlib.Path(args[args.index('--out-dir')+1])
if '--package' in args:
    package=args[args.index('--package')+1]
    (out/(package.replace('-','_')+'.wasm')).write_bytes(pathlib.Path('contract.rs').read_bytes())
else:
    (out/'local.wasm').write_bytes(b'build stub, not executable wasm')
''')
    stub.chmod(0o755)
    environment = {**os.environ, 'PATH': str(binary) + ':' + os.environ['PATH']}
    result = subprocess.run(['sh', str(fixture / 'build.sh')], env=environment,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    manifest = json.loads((fixture / 'wasm/manifest.json').read_text())
    dirty = run(['git', '-C', str(source), 'status', '--porcelain'])
    expected = hashlib.sha256(tracked.read_bytes()).hexdigest()
    artifacts = [v for k, v in manifest['artifacts'].items() if k.startswith('multisig_')]
    assert dirty == 'M contract.rs'
    assert manifest['oz_commit'] == commit
    assert len(artifacts) == 4
    assert all(v['commit'] == commit and v['sha256'] == expected for v in artifacts)
    print(json.dumps({
        'status': 'passed', 'defect_reproduced': True, 'build_exit': result.returncode,
        'dirty_source': dirty, 'head_equal_to_pin': True,
        'dirty_bytes_labeled_with_pin': len(artifacts),
        'source_script_sha256': hashlib.sha256(script.encode()).hexdigest(),
        'substitutions': ['pinned commit becomes the isolated test repository commit',
                          'stellar build becomes a source-byte recording stub'],
        'limits': 'No WASM compilation, upstream checkout, keys, signatures, or network.'
    }, indent=2))
