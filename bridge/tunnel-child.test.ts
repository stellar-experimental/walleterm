import { requestError } from '../sdk/errors.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

interface ChildRecord {
  parent_pid: number;
  supervisor_pid: number;
  cloudflared_pid: number;
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (errorValue) {
    const error = requestError(errorValue);
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
test(
  'a hard parent crash stops the tunnel supervisor and its stubborn child',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'walleterm-parent-crash-'));
    writeFileSync(
      join(directory, 'cloudflared'),
      `#!${process.execPath}\nprocess.on('SIGTERM',()=>{}); setInterval(()=>{},1000); console.log('ready');\n`,
      { mode: 0o700 },
    );
    const supervisor = fileURLToPath(new URL('./tunnel-child.ts', import.meta.url));
    const script = `import {spawn} from 'node:child_process'; const child=spawn(process.execPath,[${JSON.stringify(supervisor)}],{stdio:['pipe','pipe','pipe']}); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); setInterval(()=>{},1000);`;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let record: ChildRecord | undefined;
    try {
      await once(parent.stdout, 'data');
      const started: ChildRecord = JSON.parse(readFileSync(join(directory, 'child.json'), 'utf8'));
      record = started;
      assert.equal(started.parent_pid, parent.pid);
      const exited = once(parent, 'exit');
      parent.kill('SIGKILL');
      await exited;
      const deadline = Date.now() + 3500;
      while (Date.now() < deadline && (alive(started.supervisor_pid) || alive(started.cloudflared_pid)))
        await delay(25);
      assert.equal(alive(started.cloudflared_pid), false);
      assert.equal(alive(started.supervisor_pid), false);
    } finally {
      if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
      if (record)
        for (const pid of [record.supervisor_pid, record.cloudflared_pid]) {
          if (alive(pid)) process.kill(pid, 'SIGKILL');
        }
      rmSync(directory, { recursive: true, force: true });
    }
  },
  { timeout: 6000 },
);
