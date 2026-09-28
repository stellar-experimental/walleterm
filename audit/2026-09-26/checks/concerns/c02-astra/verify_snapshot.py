import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

repository = Path('/Users/kalepail/Desktop/walleterm-v2')
audit = repository / 'audit/2026-09-26'
manifest = json.loads((audit / 'manifest.json').read_text())
snapshot = Path(manifest['source_snapshot'])
revision = manifest['revision']
tree = subprocess.check_output(
    ['git', '-C', str(repository), 'ls-tree', '-rz', revision]
)
blobs = {}
for entry in tree.split(b'\0'):
    if not entry:
        continue
    metadata, filename = entry.split(b'\t', 1)
    mode, kind, digest = metadata.split()
    assert kind == b'blob', (filename, kind)
    blobs[filename.decode()] = digest.decode()

mismatches = []
for filename, sha256 in manifest['file_sha256'].items():
    content = (snapshot / filename).read_bytes()
    blob_hash = hashlib.sha1(
        b'blob ' + str(len(content)).encode() + b'\0' + content
    ).hexdigest()
    if hashlib.sha256(content).hexdigest() != sha256 or blobs.get(filename) != blob_hash:
        mismatches.append(filename)

evidence_files = [
    'briefs/COMMON.md',
    'briefs/CONCERN.md',
    'briefs/C02-demo-url.md',
    'reports/03-runtime-astra.md',
    'checks/03-runtime-astra/targeted.test.ts',
    'checks/03-runtime-astra/malformed-encoded.log',
    'research/03-runtime-astra/cloudflare-normalization.md',
    'checks/concerns/c02-astra/malformed-rerun.log',
    'checks/concerns/c02-astra/malformed-permitted.log',
]
result = {
    'checked_utc': datetime.now(timezone.utc).isoformat(),
    'revision': revision,
    'snapshot': str(snapshot),
    'manifest_count': len(manifest['file_sha256']),
    'git_tree_count': len(blobs),
    'manifest_paths_match_git_tree': set(blobs) == set(manifest['file_sha256']),
    'sha256_or_git_blob_mismatches': mismatches,
    'evidence_sha256': {
        name: hashlib.sha256((audit / name).read_bytes()).hexdigest()
        for name in evidence_files
    },
}
output = audit / 'checks/concerns/c02-astra/source-verification.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
assert result['manifest_paths_match_git_tree'] and not mismatches
