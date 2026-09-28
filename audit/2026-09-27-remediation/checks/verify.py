"""Verify the combined remediation without changing application source."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time

root = Path(__file__).resolve().parents[1]
repo = root.parents[1]
queue = json.loads((root/'queue.json').read_text())
assert all(row['state'] in ('accepted', 'deferred') for row in queue)
type_only = sys.argv[1:] == ['--type-only']
assert not sys.argv[1:] or type_only
results = ([row for row in json.loads((root/'checks/initial-verification.json').read_text())
            if row['name'] in ('go-race', 'go-vet', 'bun-suite')]
           if type_only else [])

def run(name, command, cwd=repo):
    start = time.monotonic()
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=300)
    (root/f'checks/{name}.log').write_text(result.stdout + result.stderr)
    row = dict(name=name, command=command, cwd=str(cwd), exit_code=result.returncode,
               seconds=round(time.monotonic()-start, 2))
    results.append(row)
    (root/'checks/verification.json').write_text(json.dumps(results, indent=2)+'\n')
    print(json.dumps(row), flush=True)
    return result

tracked = subprocess.check_output(['git','ls-files','-z'], cwd=repo).decode().split('\0')
tracked = [name for name in tracked if name and not name.startswith('audit/')]
extra = subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z'], cwd=repo).decode().split('\0')
extra = [name for name in extra if name and not name.startswith('audit/')]
source_names = tracked + extra
hashes = {name:hashlib.sha256((repo/name).read_bytes()).hexdigest() for name in source_names}
if type_only:
    earlier = json.loads((root/'checks/initial-final-source.json').read_text())
    assert hashes.keys() == earlier.keys()
    assert [name for name in hashes if hashes[name] != earlier[name]] == ['bridge/connect.test.ts']
    previous = Path(json.loads((root/'checks/workspace.json').read_text())['temporary_sources'])/'V01/bridge/connect.test.ts'
    result = run('type-only-erasure', ['bun', '-e',
        "const t = new Bun.Transpiler({loader:'ts'}); "
        "const a = t.transformSync(await Bun.file(process.argv[1]).text()); "
        "const b = t.transformSync(await Bun.file(process.argv[2]).text()); "
        "if(a !== b) throw new Error('Executable test content changed'); "
        "console.log('The corrected test has identical transpiled JavaScript.');",
        str(previous), str(repo/'bridge/connect.test.ts')])
    assert result.returncode == 0
(root/'checks/final-source.json').write_text(json.dumps(hashes, indent=2)+'\n')

run('diff', ['git','diff','--check'])
if not type_only:
    run('go-race', ['go','test','-race','./...'])
    run('go-vet', ['go','vet','./...'])
run('format', ['bun','run','format:check'])
if not type_only:
    run('bun-suite', ['bun','run','test'])
checkout = run('checkout-typescript', ['bun','run','typecheck'])
if checkout.returncode:
    paths = sorted(set(re.findall(r'^([^\n(]+\.tsx?)\(\d+,\d+\): error', checkout.stdout+checkout.stderr, re.M)))
    ignored = {name:subprocess.run(['git','check-ignore','--quiet',name], cwd=repo).returncode == 0 for name in paths}
    (root/'checks/checkout-typescript-scope.json').write_text(json.dumps(dict(paths=paths, ignored=ignored), indent=2)+'\n')

with tempfile.TemporaryDirectory(prefix='walleterm-remediation-verify-', dir='/private/tmp') as temp:
    isolated = Path(temp)
    for name in source_names:
        target = isolated/name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(repo/name, target)
        assert hashlib.sha256(target.read_bytes()).hexdigest() == hashes[name]
    shutil.copytree(repo/'audit', isolated/'audit')
    (isolated/'node_modules').symlink_to(repo/'node_modules', target_is_directory=True)
    run('isolated-typescript', ['bun','run','typecheck'], isolated)

assert all(hashlib.sha256((repo/name).read_bytes()).hexdigest() == digest for name,digest in hashes.items())
print(json.dumps(dict(source_files=len(hashes), source_unchanged_by_checks=True)), flush=True)
