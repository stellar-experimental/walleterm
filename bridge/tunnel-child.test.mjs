import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
test('a hard parent crash stops the tunnel supervisor and its stubborn child', { timeout: 6000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-parent-crash-'));
  writeFileSync(join(directory, 'cloudflared'), `#!${process.execPath}\nprocess.on('SIGTERM',()=>{}); setInterval(()=>{},1000); console.log('ready');\n`, { mode: 0o700 });
  const supervisor = fileURLToPath(new URL('./tunnel-child.mjs', import.meta.url));
  const script = `import {spawn} from 'node:child_process'; const child=spawn(process.execPath,[${JSON.stringify(supervisor)}],{stdio:['pipe','pipe','pipe']}); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', script],
    { cwd: directory, env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let record;
  try {
    await once(parent.stdout, 'data');
    record = JSON.parse(readFileSync(join(directory, 'child.json'), 'utf8'));
    assert.equal(record.parent_pid, parent.pid);
    const exited = once(parent, 'exit'); parent.kill('SIGKILL'); await exited;
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline && (alive(record.supervisor_pid) || alive(record.cloudflared_pid))) await delay(25);
    assert.equal(alive(record.cloudflared_pid), false);
    assert.equal(alive(record.supervisor_pid), false);
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
    if (record) for (const pid of [record.supervisor_pid, record.cloudflared_pid]) { if (alive(pid)) process.kill(pid, 'SIGKILL'); }
    rmSync(directory, { recursive: true, force: true });
  }
});
