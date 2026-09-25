import { mkdirSync, lstatSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function lockJournal(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) {
    throw Error('The journal must be a private directory owned by this user. Use permissions 0700.');
  }
  const lock = join(directory, '.web-lock');
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = 'unknown';
    try { owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).pid; } catch { /* Preserve an uncertain lock. */ }
    throw Error(`The journal is locked (process ${owner}). Stop the command that owns this journal. After a crash, verify it stopped and its tunnel stopped before removing ${lock}. See ${join(lock, 'owner.json')}.`);
  }
  const ownerFile = join(lock, 'owner.json');
  const record = details => writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, ...details }), { mode: 0o600 });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.off('exit', release);
    rmSync(lock, { recursive: true, force: true });
  };
  try { writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' }); }
  catch (error) { release(); throw error; }
  process.once('exit', release);
  return { release, record };
}

export function stopChild(child, graceMs = 1500) {
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let escalation, deadline;
    const finish = error => {
      clearTimeout(escalation);
      clearTimeout(deadline);
      child.off('close', closed);
      error ? reject(error) : resolve();
    };
    const closed = () => finish();
    child.once('close', closed);
    escalation = setTimeout(() => child.kill('SIGKILL'), graceMs);
    deadline = setTimeout(() => finish(Error('The child process did not stop.')), graceMs * 2);
    child.kill('SIGTERM');
  });
}

export function bounded(work, milliseconds, signal, message) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      error ? reject(error) : resolve(value);
    };
    const aborted = () => finish(signal.reason || Error('The service stopped.'));
    if (signal?.aborted) return aborted();
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(Error(message)), milliseconds);
    Promise.resolve(work).then(value => finish(null, value), error => finish(error));
  });
}
