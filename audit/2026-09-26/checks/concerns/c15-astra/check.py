import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
AUDIT = HERE.parents[2]
REPO = AUDIT.parents[1]
SOURCE = pathlib.Path('/private/tmp/walleterm-audit-40d6cca9db73')
manifest = json.loads((AUDIT / 'manifest.json').read_text())
tree = subprocess.check_output(['git', 'ls-tree', '-rz', manifest['revision']], cwd=REPO)
tracked = {entry.split(b'\t', 1)[1].decode(): entry.split(b'\t', 1)[0].split()[-1].decode()
           for entry in tree.split(b'\0') if entry}
mismatches = []
for name, expected in manifest['file_sha256'].items():
    body = (SOURCE / name).read_bytes()
    blob = hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest()
    if hashlib.sha256(body).hexdigest() != expected or blob != tracked.get(name):
        mismatches.append(name)
assert not mismatches and set(tracked) == set(manifest['file_sha256'])
results = {'revision': manifest['revision'], 'source': str(SOURCE),
           'tracked_files_verified': len(tracked), 'mismatches': mismatches,
           'bun': subprocess.check_output(['bun', '--version'], text=True).strip()}
probe = AUDIT / 'checks/08-product-astra/distribution-probe.py'
original = subprocess.run(['python3', str(probe)], text=True, capture_output=True, check=True)
(HERE / 'preserved-probe-rerun.json').write_text(original.stdout)
results['preserved_probe_sha256'] = hashlib.sha256(probe.read_bytes()).hexdigest()
results['preserved_probe_exit'] = original.returncode
with tempfile.TemporaryDirectory(prefix='walleterm-c15-astra-', dir='/private/tmp') as temp:
    root = pathlib.Path(temp)
    build = root / 'build'
    for name in tracked:
        if (name.startswith(('sdk/', 'demo/')) or name in
                {'scripts/build.ts', 'package.json', 'bun.lock', 'tsconfig.json', 'tsconfig.sdk.json'}):
            target = build / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / name, target)
    (build / 'node_modules').symlink_to(SOURCE / 'node_modules', target_is_directory=True)
    process = subprocess.run(['bun', 'run', 'build'], cwd=build, text=True, capture_output=True)
    (HERE / 'build.log').write_text(process.stdout + process.stderr)
    results['build_exit'] = process.returncode
    assert process.returncode == 0
    fresh = {str(p.relative_to(build / 'dist')): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in (build / 'dist').rglob('*') if p.is_file()}
    supplied = {str(p.relative_to(SOURCE / 'dist')): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in (SOURCE / 'dist').rglob('*') if p.is_file()}
    results['build_matches_supplied_dist'] = fresh == supplied
    results['fresh_dist_sha256'] = fresh
    shutil.copytree(build / 'dist/sdk', root / 'sdk-only')
    shutil.copytree(build / 'dist', root / 'complete')
    shutil.copyfile(build / 'sdk/connect.css', root / 'complete/sdk/connect.css')
    results['fresh_imports'] = []
    for layout in ['sdk-only', 'complete']:
        for entry in ['walleterm.js', 'connect.js', 'scan.js']:
            filename = root / layout / ('sdk' if layout == 'complete' else '') / entry
            process = subprocess.run(['bun', '-e', 'await import(process.argv[1]);', str(filename)],
                                     text=True, capture_output=True)
            results['fresh_imports'].append({'layout': layout, 'entry': entry,
                                             'exit': process.returncode, 'stderr': process.stderr.strip()})
            assert (process.returncode == 0) == (layout == 'complete')
    process = subprocess.run(['bun', str(HERE / 'graph.ts'), str(build), str(root / 'complete')],
                             text=True, capture_output=True)
    (HERE / 'graph.json').write_text(process.stdout)
    (HERE / 'graph.stderr.txt').write_text(process.stderr)
    results['graph_exit'] = process.returncode
    assert process.returncode == 0, process.stderr
results['temporary_files_removed'] = not pathlib.Path(temp).exists()
results['status'] = 'passed'
(HERE / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps({key: value for key, value in results.items() if key != 'fresh_dist_sha256'}, indent=2))
