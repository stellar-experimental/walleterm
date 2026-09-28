"""Refresh the report index and coordinator concern register."""
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
queue = json.loads((root/'checks/concern-queue.json').read_text())
concerns = json.loads((root/'concerns.json').read_text())
decisions = {row['id']:row for row in json.loads((root/'reconciliation.json').read_text())}
final = '--final' in sys.argv
if final:
    assert len(decisions) == 20 and all(row['overall_review'] == 'complete' for row in decisions.values())
    assert len(queue) == 40 and all(row['state'] == 'complete' for row in queue)
    assert all((root/f'reports/09-overall-{model}.md').is_file() for model in ['astra', 'daybreak'])
index = (root/'INDEX.md').read_text().split('<!-- concern-index -->')[0]
if final:
    index = index.replace('Status: in progress. The final report is not ready.',
                          'Status: complete. Start with the [final report](REPORT.md) and [feature assessment](FEATURES.md).')
    index = index.replace('| Overall review | Pending | Pending |',
                          '| Overall review | [Report](reports/09-overall-astra.md) | [Report](reports/09-overall-daybreak.md) |')
index += '<!-- concern-index -->\n## Focused concern reviews\n\n'
index += 'The coordinator decision distinguishes defects, conditional failures, accepted limits, and rejected claims.\n\n'
index += '| Candidate | Topic | Astra xhigh | Daybreak xhigh | Decision |\n|---|---|---|---|---|\n'
for item in concerns:
    links = []
    for model in ['astra','daybreak']:
        row = next(row for row in queue if row['concern']==item['id'] and row['model']==model)
        links.append(f"[Report]({row['report']})" if (root/row['report']).is_file() else 'Pending')
    decision = decisions.get(item['id'])
    label = f"{decision['status']}; {decision['severity']}" if decision else 'Pending'
    index += f"| {item['id']} | {item['title']} | {' | '.join(links)} | {label} |\n"
(root/'INDEX.md').write_text(index)
register = '# Concern register\n\nStatus: coordinator reconciliation in progress. Fresh overall review remains pending.\n\n'
if final:
    register = '# Concern register\n\nStatus: complete after both independent overall reviews.\n\n'
register += 'Severity describes the demonstrated impact. Priority also depends on the next intended use.\n'
register += 'Conditional findings require the stated fault or trust failure. They are not demonstrated attacks.\n\n'
register += '| ID | Topic | Decision | Severity | Practical action |\n|---|---|---|---|---|\n'
for item in concerns:
    row=decisions.get(item['id'])
    register += f"| {item['id']} | {item['title']} | {row['status'] if row else 'Pending'} | {row['severity'] if row else 'Pending'} | {row['priority'] if row else 'Await the independent concern pair.'} |\n"
for item in concerns:
    row=decisions.get(item['id'])
    if not row:continue
    register += f"\n## {row['id']}: {item['title']}\n\n"
    register += f"**Decision:** {row['status']}. **Severity:** {row['severity']}.\n\n"
    register += f"{row['scope']}\n\n{row['decision']}\n\n{row['mitigation']}\n\n"
    register += f"Confidence: {row['confidence']}.\n\n"
    register += 'Independent reports: '+', '.join(f"[{model}]({path})" for model,path in zip(['Astra','Daybreak'],row['reports']))+'.\n'
(root/'CONCERNS.md').write_text(register)
p = json.loads((root/'PROGRESS.json').read_text())
p.update(active=[r['name'] for r in queue if r['state'] in ['started','working']],
         completed=['area-'+r['id']+'-'+m for r in json.loads((root/'areas.json').read_text()) for m in ['astra','daybreak']]+[r['name'] for r in queue if r['state']=='complete'],
         pending=[r['name'] for r in queue if r['state']=='pending']+['09-overall-astra','09-overall-daybreak','final-synthesis'],
         next_action='Complete each fresh concern pair, then both overall reviews. Review the concurrent documentation delta. Archive probe extensions and verify normal repository checks.')
if final:
    p.update(status='complete', active=[], pending=[], next_action='None. The requested audit is complete.')
    p['completed'] += ['09-overall-astra', '09-overall-daybreak', 'final-synthesis']
(root/'PROGRESS.json').write_text(json.dumps(p,indent=2)+'\n')
print(f"Updated index: {sum(r['state']=='complete' for r in queue)}/40 focused reviews; {len(decisions)}/20 decisions.")
