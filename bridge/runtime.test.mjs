import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stopChild } from './runtime.mjs';

test('a stopped child exits even when it ignores SIGTERM', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); console.log('ready');"], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    await stopChild(child, 100);
    assert.equal(child.signalCode, 'SIGKILL');
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});
