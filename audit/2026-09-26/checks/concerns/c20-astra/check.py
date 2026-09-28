"""Verify C20 source identity and summarize preserved platform evidence."""

import hashlib
import json
from pathlib import Path
import subprocess


ROOT = Path('/Users/kalepail/Desktop/walleterm-v2')
AUDIT = ROOT / 'audit/2026-09-26'
OUT = AUDIT / 'checks/concerns/c20-astra'
REVISION = '40d6cca9db732a0db16d154c80d4a153bf33c6b7'
FROZEN = Path('/private/tmp/walleterm-audit-40d6cca9db73')

manifest = json.loads((AUDIT / 'manifest.json').read_text())
assert manifest['revision'] == REVISION
assert manifest['source_snapshot'] == str(FROZEN)
git_command = ['git', '-C', str(ROOT), 'ls-tree', '-rz', REVISION]
tree = subprocess.run(git_command, check=True, capture_output=True).stdout
blobs = {}
for entry in tree.split(b'\0'):
    if not entry:
        continue
    metadata, filename = entry.split(b'\t', 1)
    mode, kind, object_id = metadata.decode().split()
    assert kind == 'blob'
    blobs[filename.decode()] = object_id
assert set(blobs) == set(manifest['file_sha256'])
mismatches = []
for filename, expected_sha256 in manifest['file_sha256'].items():
    data = (FROZEN / filename).read_bytes()
    sha256 = hashlib.sha256(data).hexdigest()
    blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if sha256 != expected_sha256 or blob != blobs[filename]:
        mismatches.append(filename)
assert not mismatches, mismatches

scope = {
    'README.md': [(1, 29), (131, 154)],
    'docs/PLAN.md': [(1, 21)],
    'docs/INTERFACE.md': [(33, 38), (132, 147)],
    'docs/REQUIREMENTS.md': [(1, 16)],
    'main.go': [(51, 59), (94, 99), (126, 134)],
    'service.go': [(44, 70), (98, 126)],
    'scripts/install.ts': [(20, 36), (68, 87)],
    'Makefile': [(8, 14), (48, 52)],
    'go.mod': [(1, 3)],
    'package.json': [(1, 11), (21, 29)],
    '.github/workflows/test.yml': [(1, 36)],
    'service_test.go': [(29, 50)],
}
excerpts = []
for filename, ranges in scope.items():
    lines = (FROZEN / filename).read_text().splitlines()
    for first, last in ranges:
        excerpts.append(f'\n{filename}:{first}-{last}')
        excerpts.extend(f'{n}: {lines[n - 1]}' for n in range(first, min(last, len(lines)) + 1))
(OUT / 'source-excerpts.txt').write_text('\n'.join(excerpts) + '\n')

build_file = 'checks/08-product-astra/platform-builds.json'
recorded_builds = json.loads((AUDIT / build_file).read_text())
builds = []
for build in recorded_builds['builds']:
    builds.append({
        'GOOS': build['GOOS'],
        'GOARCH': build['GOARCH'],
        'command': build['command'],
        'build_exit': build['exit'],
        'file_result': build['file'],
        'help_exit': build.get('help', {}).get('exit'),
        'plugin_exit': build.get('plugin', {}).get('exit'),
        'runtime_record_present': 'help' in build or 'plugin' in build,
    })
assert len(builds) == 2
assert all(build['build_exit'] == 0 for build in builds)
assert {build['GOARCH'] for build in builds} == {'arm64', 'amd64'}
arm = next(build for build in builds if build['GOARCH'] == 'arm64')
intel = next(build for build in builds if build['GOARCH'] == 'amd64')
assert arm['help_exit'] == arm['plugin_exit'] == 0
assert not intel['runtime_record_present']

version_file = 'checks/08-product-daybreak/tool-versions.json'
versions = json.loads((AUDIT / version_file).read_text())
runner_file = 'research/08-product-daybreak/github-runner-source.md'
bun_file = 'research/08-product-daybreak/parallel-cli-bun-install-platforms.json'
bun_search = json.loads((AUDIT / bun_file).read_text())
bun_source = next(result for result in bun_search['results']
                  if result['url'] == 'https://bun.com/docs/installation')
source_excerpt = [line for excerpt in bun_source['excerpts']
                  for line in excerpt.splitlines()
                  if any(term in line.lower() for term in ['macos', 'macs]', 'silicon'])]
result = {
    'status': 'passed',
    'revision': REVISION,
    'snapshot': str(FROZEN),
    'source_identity': {
        'git_command': git_command,
        'manifest_files': len(manifest['file_sha256']),
        'git_files': len(blobs),
        'sha256_and_git_blob_matches': len(blobs),
        'mismatches': mismatches,
    },
    'source_scope': scope,
    'reused_build_evidence': {'file': build_file, 'builds': builds},
    'reused_host_evidence': {'file': version_file, 'host': versions['host'], 'tools': versions['tools']},
    'reused_primary_evidence': {
        'runner_note': {'file': runner_file, 'text': (AUDIT / runner_file).read_text()},
        'bun': {'file': bun_file, 'url': bun_source['url'], 'title': bun_source['title'],
                'publish_date': bun_source.get('publish_date'), 'relevant_lines': source_excerpt,
                'applicability': 'Rolling documentation; no version-specific product floor established.'},
    },
    'new_compilations': 'not_run',
    'new_runtime_tests': 'not_run',
    'new_provider_calls': 0,
    'new_research_usd': 0,
    'new_jev_usd': 0,
}
(OUT / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'status': result['status'], 'frozen_files_verified': len(blobs),
                  'preserved_builds_checked': len(builds), 'new_runtime_tests': 'not_run'}))
