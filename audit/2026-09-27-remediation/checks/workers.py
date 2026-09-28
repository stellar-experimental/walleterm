"""Run one bounded Sol worker at a time in the remediation-owned pane."""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
repo = root.parents[1]
control = json.loads((root/'checks/workspace.json').read_text())
pane = control['owned_pane']
temporary = Path(control['temporary_sources'])
queue_file = root/'queue.json'
queue = json.loads(queue_file.read_text())
action, concern = sys.argv[1:3]
row = next(r for r in queue if r['id'] == concern)
sessions_file = root/'sessions.json'
sessions = json.loads(sessions_file.read_text())

def write(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n')

def herdr(*args):
    result = subprocess.run(['herdr', *args], capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return json.loads(result.stdout)

def inventory():
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=repo).decode().split('\0')
    tracked = [n for n in tracked if n and not n.startswith('audit/')]
    extra = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=repo).decode().split('\0')
    extra = [n for n in extra if n and not n.startswith('audit/')]
    return dict(tracked_sha256={n:hashlib.sha256((repo/n).read_bytes()).hexdigest() for n in tracked},
                untracked_sha256={n:hashlib.sha256((repo/n).read_bytes()).hexdigest() for n in extra},
                untracked_source_files=extra)

if action in ('start', 'review', 'resume'):
    review = action == 'review'
    resume = action == 'resume'
    if resume:
        assert row['state'] in ['paused_partial', 'changes_required']
    else:
        assert row['state'] == ('implemented' if review else 'pending')
    assert all(r['state'] in ['accepted', 'deferred'] for r in queue[:queue.index(row)])
    assert not any(a['pane_id'] == pane for a in herdr('agent', 'list')['result']['agents'])
    name = ('review-' if review else 'fix-') + concern.lower() + '-sol'
    if resume:
        name += '-resumed'
    used = {session['name'] for session in sessions}
    if name in used:
        prefix = name
        suffix = 2
        while name in used:
            name = f'{prefix}-{suffix}'
            suffix += 1
    effort = 'xhigh' if review else row['effort']
    if not review and not resume:
        write(root/f'checks/{concern}-before.json', inventory())
        for name_in_repo in row['allowed_files']:
            target = repo/name_in_repo
            if target.exists():
                saved = temporary/concern/name_in_repo
                saved.parent.mkdir(parents=True, exist_ok=True)
                saved.write_bytes(target.read_bytes())
    command = ['agent','start',name,'--kind','codex','--pane',pane,'--',
               '-m','gpt-6-sol','-c',f'model_reasoning_effort="{effort}"',
               '--approve-for-me','--no-alt-screen']
    launch = herdr(*command)
    session = dict(name=name, concern=concern, role='review' if review else 'implementation',
                   model='gpt-6-sol', effort=effort, pane=pane, launch=launch, state='working')
    sessions.append(session)
    write(sessions_file, sessions)
    row.update(state='reviewing' if review else 'working', agent=name, pane=pane)
    write(queue_file, queue)
    if review:
        prompt = (f'Independently review only {concern}. Read {root}/briefs/COMMON.md and '
                  f'{root}/briefs/{concern}.md as requirements, then {root}/steps/{concern}.patch '
                  'and the current affected source and tests. This is a read-only review. '
                  'Do not read the implementation worker transcript before forming your conclusion. '
                  'Check correctness, minimal scope, cancellation or unknown-outcome safety, and regression quality. '
                  'Run only targeted offline checks that can change the verdict. Do not delegate or edit source. '
                  'Return accept or changes_required with exact evidence and any unresolved issue. '
                  'The user requested Sol; this fresh session is independent but uses the same model family.')
        prior_reviews = [s for s in sessions if s['concern'] == concern and s.get('verdict') == 'changes_required']
        if prior_reviews:
            prompt += (f' This is a focused recheck. Read {root}/steps/{concern}-review.txt for the unresolved finding. '
                       'Compare the saved prior review patch with the current patch. Verify the correction and its regression, '
                       'plus relevant successful controls. Do not repeat completed unaffected checks without a new reason.')
    else:
        prompt = (f'Read {root}/briefs/COMMON.md and {root}/briefs/{concern}.md. '
                  'Assess viability first. Implement only if the correction remains clear, narrow, and worthwhile. '
                  'Use the current repository and exact file ownership. Otherwise defer with the reason. '
                  'Return the decision, changed files, exact tests, and limits. Do not delegate or expand scope.')
        if resume:
            prompt += (f' Continue the unfinished concern. Read {root}/PAUSE.md and the current '
                       f'{root}/steps/{concern}.patch. Preserve useful partial edits, reassess their minimum scope, '
                       'and complete the missing regression coverage. Existing test success does not resolve '
                       'open review findings. The coordinator will arrange fresh independent review.')
            if (root/f'steps/{concern}-review.txt').exists():
                prompt += (f' Address the unresolved findings in {root}/steps/{concern}-review.txt. '
                           'Do not implement concerns that the reviewer rejected after checking native behavior.')
    herdr('agent','prompt',name,prompt)
    print(json.dumps(dict(started=name, effort=effort, pane=pane)))
elif action == 'record':
    verdict = sys.argv[3]
    assert verdict in ['accepted', 'implemented', 'deferred', 'changes_required', 'paused_partial']
    name = row['agent']
    agent = herdr('agent','get',name)['result']['agent']
    assert agent['pane_id'] == pane and agent['agent_status'] in ['done','idle']
    review = row['state'] == 'reviewing'
    output = subprocess.run(['herdr','agent','read',name,'--source','recent-unwrapped','--lines','180'],
                            capture_output=True,text=True,check=True)
    transcript = root/f'steps/{concern}-{ "review" if review else "worker" }.txt'
    if transcript.exists():
        suffix = 1
        while transcript.with_name(f'{transcript.stem}-{suffix}.txt').exists():
            suffix += 1
        transcript.with_name(f'{transcript.stem}-{suffix}.txt').write_text(transcript.read_text())
    transcript.write_text(output.stdout)
    if not review:
        before = json.loads((root/f'checks/{concern}-before.json').read_text())
        after = inventory()
        changed = [n for n, sha in after['tracked_sha256'].items()
                   if before['tracked_sha256'].get(n) != sha]
        changed += [n for n in after['untracked_source_files'] if n not in before['untracked_source_files']]
        assert set(changed) <= set(row['allowed_files']), changed
        patch = ''
        for name_in_repo in row['allowed_files']:
            old, new = temporary/concern/name_in_repo, repo/name_in_repo
            left = old.read_text().splitlines(True) if old.exists() else []
            right = new.read_text().splitlines(True) if new.exists() else []
            patch += ''.join(difflib.unified_diff(left,right,fromfile='a/'+name_in_repo,tofile='b/'+name_in_repo))
        (root/f'steps/{concern}.patch').write_text(patch)
        row['changed_files'] = changed
        write(root/f'checks/{concern}-after.json', after)
    else:
        expected = json.loads((root/f'checks/{concern}-after.json').read_text())
        actual = inventory()
        assert all(actual[key] == value for key, value in expected.items()), 'Review changed source files.'
        (root/f'steps/{name}.patch').write_text((root/f'steps/{concern}.patch').read_text())
    matching = next((s for s in sessions if s['name']==name), None)
    if matching is None:
        matching = dict(name=name, concern=concern, role='implementation',model='gpt-6-sol',effort=row['effort'],pane=pane)
        sessions.append(matching)
    matching.update(session=agent['agent_session']['value'], state='complete', verdict=verdict)
    write(sessions_file, sessions)
    row['state'] = verdict
    write(queue_file, queue)
    herdr('agent','send-keys',name,'ctrl+d')
    for attempt in range(30):
        if not any(a.get('name')==name for a in herdr('agent','list')['result']['agents']):
            break
        time.sleep(0.2)
    else:
        raise RuntimeError('Completed worker did not exit.')
    time.sleep(0.2)
    print(json.dumps(dict(recorded=concern, verdict=verdict, changed_files=row.get('changed_files',[]))))
else:
    raise SystemExit('Use start, resume, review, or record.')
