"""Start the two final independent reviewers in the owned shell panes."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
queue = json.loads((root/'checks/concern-queue.json').read_text())
assert len(queue) == 40 and all(row['state'] == 'complete' for row in queue)
assert len(json.loads((root/'reconciliation.json').read_text())) == 20
record = root/'checks/overall-launches.json'
assert not record.exists()

def herdr(*args):
    process = subprocess.run(['herdr', *args], text=True, capture_output=True, timeout=45)
    if process.returncode:
        raise RuntimeError(process.stderr or process.stdout)
    return json.loads(process.stdout)

launches = []
for label, model, pane in [('astra', 'gpt-6-astra', 'w44:p1R'),
                           ('daybreak', 'gpt-daybreak-blue-latest', 'w44:p1S')]:
    name = 'wa09-' + label
    command = ['agent', 'start', name, '--kind', 'codex', '--pane', pane, '--',
               '-m', model, '-c', 'model_reasoning_effort="xhigh"',
               '--approve-for-me', '--no-alt-screen']
    result = herdr(*command)
    launches.append(dict(name=name, model=model, effort='xhigh', pane=pane,
                         command=['herdr']+command, launch=result))
    record.write_text(json.dumps(launches, indent=2)+'\n')
    prompt = (
        f'Run the fresh overall and summary audit as {label} xhigh. '
        f'Read {root}/briefs/COMMON.md and {root}/briefs/09-overall.md. '
        'The specific overall brief requires all completed area and focused reports; '
        'its cross-review scope overrides the initial area-only independence rule. '
        'Do not read the paired overall report before your first conclusion. '
        f'Own {root}/reports/09-overall-{label}.md and your corresponding checks/research directories. '
        'All 40 focused reviews are complete. Read REPORT.md, CONCERNS.md, reconciliation.json, '
        'FEATURES.md, coverage and evidence. Challenge classifications and minimum mitigations. '
        'Inspect the exact concurrent skill-reference delta and record its SHA-256. '
        'Use the frozen source. Do not edit production or delegate. '
        'Use all requested research surfaces for useful unresolved questions; reuse settled primary evidence. '
        'New research cap $10 total, Jev at most $1. No live signing, submissions, public tunnels, '
        'private-key fields, publishing, or package installation into the real prefix. '
        'Do not repeat passed broad suites. Clearly distinguish mock behavior from actual provider incidents. '
        'The coordinator will archive probe extensions and rerun normal repository checks after both reports. '
        'Keep that final packaging check pending; do not block your substantive review on it. '
        'Finish when your evidence supports the final assessment. A clean review is valid.'
    )
    herdr('agent', 'prompt', name, prompt)
    print(json.dumps(dict(started=name, model=model, effort='xhigh', pane=pane)), flush=True)
