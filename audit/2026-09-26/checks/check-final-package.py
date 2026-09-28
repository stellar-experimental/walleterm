"""Run the normal repository checks after preserving audit probes as text."""
from concurrent.futures import ThreadPoolExecutor
import datetime
import json
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parents[1]
repo = root.parents[1]
assert (root / 'checks/source-archive-map.json').is_file()
assert (root / 'research/evidence.tar.gz').is_file()
checks = [
    ('go-race', ['go', 'test', '-race', './...']),
    ('go-vet', ['go', 'vet', './...']),
    ('typescript', ['bun', 'run', 'typecheck']),
    ('format', ['bun', 'run', 'format:check']),
    ('bun', ['bun', 'run', 'test']),
]

def run(check):
    name, command = check
    started = time.monotonic()
    log = root / f'checks/final-package-{name}.txt'
    with log.open('w') as output:
        process = subprocess.run(command, cwd=repo, stdout=output,
                                 stderr=subprocess.STDOUT, timeout=300)
    return dict(name=name, command=command, cwd=str(repo),
                exit_code=process.returncode,
                seconds=round(time.monotonic()-started, 2),
                log=str(log.relative_to(root)))

with ThreadPoolExecutor(max_workers=5) as pool:
    results = list(pool.map(run, checks))
record = dict(completed_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
              purpose='Verify normal test discovery and checks with the audit package present.',
              results=results, passed=all(row['exit_code']==0 for row in results))
(root/'checks/final-package-results.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps(record, indent=2))
raise SystemExit(not record['passed'])
