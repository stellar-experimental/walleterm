"""Check limited credential patterns without printing matching content."""
import json
from pathlib import Path
import re
import tarfile

root = Path(__file__).resolve().parents[1]
patterns = {
    'private_key_block': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'provider_key_shape': re.compile(rb'\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b'),
}
matches = []
scanned = 0

def inspect(name, content):
    global scanned
    if b'\0' in content[:4096]:
        return
    scanned += 1
    labels = [label for label, pattern in patterns.items() if pattern.search(content)]
    if labels:
        matches.append(dict(path=name, patterns=labels))

for path in root.rglob('*'):
    if not path.is_file() or path.suffix in {'.gz', '.png', '.jpg', '.pdf'}:
        continue
    inspect(str(path.relative_to(root)), path.read_bytes())
archive = root/'research/evidence.tar.gz'
if archive.exists():
    with tarfile.open(archive, 'r:gz') as saved:
        for member in saved.getmembers():
            if member.isfile():
                inspect('research/evidence.tar.gz::'+member.name,
                        saved.extractfile(member).read())
result = dict(files_scanned=scanned, matches=matches,
              scope='Audit text and archived research only. Filenames and pattern labels only. '
                    'This limited check does not establish the absence of all secrets.')
(root/'checks/artifact-pattern-scan.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(dict(files_scanned=scanned, matching_files=len(matches))))
raise SystemExit(bool(matches))
