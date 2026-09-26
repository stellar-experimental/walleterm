import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { stopChild } from './runtime.ts';

// The parent owns stdin. Kernel EOF also arrives when the parent crashes.
const child = spawn('cloudflared', process.argv.slice(2), { stdio: ['ignore', 'pipe', 'pipe'] });
let stopping: Promise<never> | undefined;
function stop(code: number): Promise<never> {
  if (stopping) return stopping;
  stopping = Promise.resolve().then(async () => {
    try {
      await stopChild(child, 1000);
    } catch {
      code = 1;
    }
    process.exit(code);
  });
  return stopping;
}
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once('spawn', () => {
  try {
    writeFileSync(
      'child.json',
      JSON.stringify({ parent_pid: process.ppid, supervisor_pid: process.pid, cloudflared_pid: child.pid }),
      { mode: 0o600 },
    );
  } catch {
    void stop(1);
  }
});
child.once('error', () => {
  process.stderr.write('Cloudflared could not start. Check its installation.\n');
  void stop(1);
});
child.once('exit', (code) => {
  void stop(code ?? 1);
});
process.stdout.on('error', () => {
  void stop(1);
});
process.stderr.on('error', () => {
  void stop(1);
});
process.stdin.on('end', () => {
  void stop(0);
});
process.stdin.on('error', () => {
  void stop(1);
});
process.stdin.resume();
process.once('SIGINT', () => {
  void stop(0);
});
process.once('SIGTERM', () => {
  void stop(0);
});
