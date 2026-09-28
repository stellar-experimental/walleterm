"""Compact raw provider evidence after all independent reviews complete."""
import gzip
import hashlib
import json
from pathlib import Path
import tarfile
import sys

root=Path(__file__).resolve().parents[1]
research=root/'research'
archive=research/'evidence.tar.gz'
manifest_path=research/'archive-manifest.json'
keep_names={'usage.json','usage-summary.json','sources.json','archive-manifest.json','evidence.tar.gz'}
files=sorted(p for p in research.rglob('*') if p.is_file() and p.suffix!='.md' and p.name not in keep_names)
rows={str(p.relative_to(research)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
if '--apply' not in sys.argv:
    print(json.dumps({'files_to_archive':len(rows),'uncompressed_bytes':sum(p.stat().st_size for p in files)}))
    raise SystemExit(0)
assert not archive.exists()
queue=json.loads((root/'checks/concern-queue.json').read_text())
assert len(queue)==40 and all(row['state']=='complete' for row in queue)
assert all((root/f'reports/09-overall-{model}.md').is_file() for model in ['astra','daybreak'])
with archive.open('wb') as raw, gzip.GzipFile(fileobj=raw,mode='wb',mtime=0,filename='') as compressed:
    with tarfile.open(fileobj=compressed,mode='w') as output:
        for path in files:
            info=output.gettarinfo(str(path),arcname=str(path.relative_to(research)))
            info.uid=info.gid=0
            info.uname=info.gname=''
            info.mtime=0
            with path.open('rb') as source:output.addfile(info,source)
with tarfile.open(archive,'r:gz') as saved:
    actual={m.name:hashlib.sha256(saved.extractfile(m).read()).hexdigest() for m in saved.getmembers() if m.isfile()}
assert actual==rows
record={'archive':'research/evidence.tar.gz','sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
        'file_sha256':rows,'files':len(rows),'bytes':archive.stat().st_size,
        'uncompressed_bytes':sum(p.stat().st_size for p in files),
        'restore':'Extract the archive into the research directory to restore the original logical paths.'}
manifest_path.write_text(json.dumps(record,indent=2)+'\n')
for path in files:path.unlink()
for directory in sorted((p for p in research.rglob('*') if p.is_dir()),key=lambda p:len(p.parts),reverse=True):
    if not any(directory.iterdir()):directory.rmdir()
print(json.dumps({k:v for k,v in record.items() if k!='file_sha256'},indent=2))
