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
