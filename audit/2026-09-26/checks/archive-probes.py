"""Preserve audit probe bytes without entering the repository's test discovery."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
apply = '--apply' in sys.argv
suffixes = {'.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.go'}
probes = sorted(path for path in root.rglob('*')
                if path.is_file() and path.suffix in suffixes
                and root / 'research' not in path.parents)
rows = [{'original': str(path.relative_to(root)),
         'archived': str(path.relative_to(root)) + '.txt',
         'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in probes]
if apply:
    queue = json.loads((root / 'checks/concern-queue.json').read_text())
    assert len(queue) == 40 and all(row['state'] == 'complete' for row in queue)
    assert all((root / f'reports/09-overall-{model}.md').is_file() for model in ('astra','daybreak'))
    mapping = {str((root / row['original']).resolve()): root / row['archived'] for row in rows}
    for path in probes:
        target = path.with_name(path.name + '.txt')
        assert not target.exists()
        path.rename(target)
    for doc in root.rglob('*.md'):
        text = doc.read_text()
        def update_link(match):
            link = match.group(1)
            if '://' in link or link.startswith('#'):
                return match.group(0)
            value = re.sub(r':\d+$', '', link.split('#')[0].strip('<>'))
            absolute = str((doc.parent / value).resolve())
            if absolute not in mapping:
                return match.group(0)
            return '](' + os.path.relpath(mapping[absolute], doc.parent) + ')'
        text = re.sub(r'\]\(([^\s)]+)\)', update_link, text)
        # Preserve actual commands and source citations. Only update explicit audit artifact paths.
        for row in sorted(rows, key=lambda row:len(row['original']), reverse=True):
            for original in (str(root / row['original']), row['original']):
                text = text.replace('`' + original + '`', '`' + original + '.txt`')
        doc.write_text(text)
    for row in rows:
        assert hashlib.sha256((root / row['archived']).read_bytes()).hexdigest() == row['sha256']
    (root / 'checks/source-archive-map.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps({'mode':'applied' if apply else 'preview','probe_count':len(rows)},indent=2))
