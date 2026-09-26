import type { ChildProcess } from 'node:child_process';

export function stopChild(child: ChildProcess | undefined, graceMs = 1500): Promise<void> {
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let escalation: ReturnType<typeof setTimeout>, deadline: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
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

export function bounded<T>(
  work: T | PromiseLike<T>,
  milliseconds: number,
  signal: AbortSignal | undefined,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let aborted: () => void;
  return new Promise<T>((resolve, reject) => {
    aborted = () => reject(signal?.reason || Error('The service stopped.'));
    if (signal?.aborted) return aborted();
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => reject(Error(message)), milliseconds);
    Promise.resolve(work).then(resolve, reject);
  }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
  });
}
