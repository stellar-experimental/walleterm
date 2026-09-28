"""Check explicit source line references against the frozen source manifest."""
import json
from pathlib import Path
import re

root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'manifest.json').read_text())
snapshot=Path(manifest['source_snapshot'])
known=set(manifest['file_sha256'])
errors=[]
checked=0
for report in (root/'reports').rglob('*.md'):
    for name,line in re.findall(r'(?<![A-Za-z0-9_./-])([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\.(?:ts|go|rs|md|sh|json)):(\d+)',report.read_text()):
        if name not in known:
            continue
        checked+=1
        count=len((snapshot/name).read_text().splitlines())
        if not 1<=int(line)<=count:
            errors.append({'report':str(report.relative_to(root)),'source':name,'line':int(line),'line_count':count})
result={'checked_known_source_references':checked,'out_of_range':errors,
        'limit':'Checks explicit known file paths only. It does not prove that each cited line supports its claim.'}
(root/'checks/source-reference-check.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
raise SystemExit(bool(errors))
