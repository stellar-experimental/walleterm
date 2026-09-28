import { requestError } from '../sdk/errors.ts';
import { spyOn, test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { launchService } from './launch.ts';

interface ChildRecord {
  parent_pid: number;
  supervisor_pid: number;
  cloudflared_pid: number;
}
interface TunnelRecord {
  pid: number;
  living: number[];
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
async function until(check: () => boolean, milliseconds = 3500) {
  const deadline = Date.now() + milliseconds;
  while (!check() && Date.now() < deadline) await delay(10);
  assert.ok(check(), 'The processes did not reach the expected state.');
}
// The mock ignores SIGTERM. Each run records its PID and each earlier run that still lives.
function mockCloudflared(directory: string) {
  const file = join(directory, 'tunnels.jsonl');
  writeFileSync(
    join(directory, 'cloudflared'),
    `#!${process.execPath}
const fs = require('node:fs');
const file = ${JSON.stringify(file)};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const earlier = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\\n').map((line) => JSON.parse(line).pid) : [];
fs.appendFileSync(file, JSON.stringify({ pid: process.pid, living: earlier.filter(alive) }) + '\\n');
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
console.log('https://mock-tunnel.trycloudflare.com');
`,
    { mode: 0o700 },
  );
  return (): TunnelRecord[] =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
}

test(
  'a hard parent crash stops the tunnel supervisor and its stubborn child',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'walleterm-parent-crash-'));
    mockCloudflared(directory);
    const supervisor = fileURLToPath(new URL('./main.ts', import.meta.url));
    // These spawn options match `startTunnel` in launch.ts.
    const script = `import {spawn} from 'node:child_process'; const child=spawn(process.execPath,[${JSON.stringify(supervisor)},'tunnel-child'],{detached:true,stdio:['pipe','pipe','pipe']}); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); setInterval(()=>{},1000);`;
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
      await until(() => !alive(started.supervisor_pid) && !alive(started.cloudflared_pid));
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

test(
  'a supervisor SIGKILL stops its stubborn tunnel before recovery and signals only that group',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'walleterm-supervisor-crash-'));
    const tunnels = mockCloudflared(directory);
    // Controls: one process shares this test's process group, and one leads its own group.
    const bystanders = [false, true].map((detached) =>
      spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached, stdio: 'ignore' }),
    );
    const kill = spyOn(process, 'kill');
    const supervisors: number[] = [];
    let running: Awaited<ReturnType<typeof launchService>> | undefined;
    try {
      running = await launchService(
        { port: 8791, label: 'Mock tunnel' },
        {
          create: () => ({
            service: 'walleterm',
            listen: async () => {},
            close: async () => {},
            setPublicOrigin() {},
          }),
          output: { write: () => true },
          environment: { PATH: `${directory}:${process.env.PATH}` },
          ready: async () => {},
          probe: async () => ({ status: 200, service: 'walleterm' }),
          healthIntervalMs: 5,
          recoveryDelayMs: 1,
        },
      );
      const service = running;
      const first = service.child;
      assert.ok(first?.pid);
      supervisors.push(first.pid);
      // The supervisor leads its own process group.
      assert.equal(process.kill(-first.pid, 0), true);
      const [{ pid: tunnel }] = tunnels();
      first.kill('SIGKILL');
      await until(() => tunnels().length === 2);
      assert.equal(alive(tunnel), false);
      assert.deepEqual(tunnels()[1].living, []);
      await until(() => service.child !== first);
      assert.ok(service.child?.pid);
      supervisors.push(service.child.pid);
      await service.stop(0);
      await until(() => !supervisors.some(alive) && !tunnels().some(({ pid }) => alive(pid)));
      for (const bystander of bystanders) assert.equal(alive(bystander.pid!), true);
      assert.deepEqual(
        kill.mock.calls.filter(([, signal]) => signal !== 0),
        supervisors.map((pid) => [-pid, 'SIGKILL']),
      );
    } finally {
      kill.mockRestore();
      await running?.stop(0);
      for (const bystander of bystanders) bystander.kill('SIGKILL');
      for (const { pid } of tunnels()) if (alive(pid)) process.kill(pid, 'SIGKILL');
      rmSync(directory, { recursive: true, force: true });
    }
  },
  { timeout: 10000 },
);
