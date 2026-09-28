import hashlib
import json
from pathlib import Path
import subprocess

root = Path('/Users/kalepail/Desktop/walleterm-v2')
manifest = json.loads((root / 'audit/2026-09-26/manifest.json').read_text())
snapshot = Path(manifest['source_snapshot'])
hashes = manifest['file_sha256']
tree = subprocess.check_output(
    ['git', '-C', str(root), 'ls-tree', '-r', '--name-only', manifest['revision']], text=True,
).splitlines()
mismatches = [name for name, expected in hashes.items()
              if hashlib.sha256((snapshot / name).read_bytes()).hexdigest() != expected]
result = {
    'revision': manifest['revision'],
    'snapshot': str(snapshot),
    'tracked_files': len(hashes),
    'hash_mismatches': mismatches,
    'baseline_tree_matches_manifest': sorted(tree) == sorted(hashes),
}
print(json.dumps(result, indent=2))
assert not mismatches
assert result['baseline_tree_matches_manifest']
