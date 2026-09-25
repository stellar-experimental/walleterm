import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockJournal, stopChild } from './runtime.mjs';

test('one process owns the journal until release and existing records remain', () => {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-state-'));
  chmodSync(directory, 0o700);
  let first, second;
  try {
    writeFileSync(join(directory, 'preserve.json'), 'journal');
    first = lockJournal(directory);
    assert.throws(() => lockJournal(directory), /journal is locked/);
    first.release();
    assert.equal(existsSync(join(directory, '.web-lock')), false);
    second = lockJournal(directory);
    assert.equal(existsSync(join(directory, 'preserve.json')), true);
  } finally { first?.release(); second?.release(); rmSync(directory, { recursive: true, force: true }); }
});

test('a shared journal directory is rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-state-'));
  chmodSync(directory, 0o777);
  try { assert.throws(() => lockJournal(directory), /private directory/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

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
