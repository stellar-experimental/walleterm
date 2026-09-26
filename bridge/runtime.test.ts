import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stopChild } from './runtime.ts';

test('a stopped child exits even when it ignores SIGTERM', async () => {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); console.log('ready');",
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await once(child.stdout, 'data');
    await stopChild(child, 100);
    assert.equal(child.signalCode, 'SIGKILL');
    const pid = child.pid;
    assert.ok(pid !== undefined);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
