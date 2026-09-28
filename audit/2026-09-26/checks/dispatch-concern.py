"""Rotate only the three explicitly owned audit panes after coordinator review."""
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
owned = {'w44:p1Q', 'w44:p1R', 'w44:p1S'}

def herdr(*args):
    process = subprocess.run(['herdr', *args], text=True, capture_output=True, timeout=45)
    if process.returncode:
        raise RuntimeError(process.stderr or process.stdout)
    return json.loads(process.stdout)

def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')

old_name = sys.argv[1]
new_name = sys.argv[2] if len(sys.argv) > 2 else None
queue_path = root / 'checks/concern-queue.json'
queue = json.loads(queue_path.read_text())
old = next(row for row in queue if row['name'] == old_name)
new = next((row for row in queue if row['name'] == new_name), None)
assert new_name is None or new is not None and new['state'] == 'pending'
assert (root / old['report']).is_file()
state = herdr('agent', 'list')['result']['agents']
agent = next(row for row in state if row.get('name') == old_name)
pane = agent['pane_id']
assert pane in owned and agent['agent_status'] in ('done', 'idle')
assert old['pane'] == pane
session = agent['agent_session']['value']
registry_path = root / 'checks/reviewer-sessions.json'
registry = json.loads(registry_path.read_text())
if not any(row['name'] == old_name for row in registry):
    registry.append(dict(name=old_name, pane=pane, session=session,
                         model='gpt-6-astra' if old['model']=='astra' else 'gpt-daybreak-blue-latest',
                         effort='xhigh', state='complete'))
write(registry_path, registry)
old['state'] = 'complete'
write(queue_path, queue)
herdr('agent', 'send-keys', old_name, 'ctrl+d')
for attempt in range(20):
    live = herdr('agent', 'list')['result']['agents']
    if not any(row.get('name') == old_name for row in live):
        break
    time.sleep(0.2)
else:
    raise RuntimeError('Completed reviewer did not exit.')
time.sleep(0.2)
if new is None:
    print(json.dumps(dict(completed=old_name, pane=pane, shell_ready=True)))
    raise SystemExit(0)
model = 'gpt-6-astra' if new['model']=='astra' else 'gpt-daybreak-blue-latest'
launch = herdr('agent', 'start', new_name, '--kind', 'codex', '--pane', pane, '--',
               '-m', model, '-c', 'model_reasoning_effort="xhigh"', '--approve-for-me', '--no-alt-screen')
assert launch['result']['agent']['agent_status'] in ('idle', 'done')
new.update(state='started', pane=pane)
write(queue_path, queue)
prompt = (
    f"Review only {new['concern']} as the fresh {new['model']} xhigh reviewer. "
    f"Read {root}/briefs/COMMON.md, {root}/briefs/CONCERN.md, and {root}/{new['brief']}. "
    "Follow their bounded scope and report ownership. Use the frozen source. "
    "Do not edit production or delegate. The user authorized the report files. "
    "All requested research tools and skill paths appear in COMMON.md. "
    "Use them where unresolved facts require evidence. Reuse preserved primary evidence. "
    "Cap new research at $1 total, Jev at $0.25. "
    "Inspect existing reproductions before adding tests. Stop when the concern has decisive evidence. "
    "Do not expand to adjacent candidates. Write the assigned report with verdict, scope, "
    "minimum mitigation, counterevidence, costs, and exact checks. "
    "Do not read the paired concern report."
)
herdr('agent', 'prompt', new_name, prompt)
new['state'] = 'working'
write(queue_path, queue)
print(json.dumps(dict(completed=old_name, started=new_name, pane=pane, model=model, effort='xhigh')))
