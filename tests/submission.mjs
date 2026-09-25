import { openSync, closeSync, writeFileSync, fsyncSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export class UnknownSubmission extends Error {
  constructor(label, hash, cause) {
    super(`${label}: submission outcome is unknown for ${hash ?? 'the pending gate'}. Reconcile before continuing.`, { cause });
    this.name = 'UnknownSubmission';
    this.code = 'unknown_submission';
    this.label = label;
    this.hash = hash;
  }
}

const defaultClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: timer => clearTimeout(timer),
};
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item) + '\n';
const terminal = result => result?.status === 'SUCCESS' || result?.status === 'FAILED';
const rejected = result => result?.status === 'ERROR' && !!result.errorResult;

// clock is injectable for offline tests. No signer or network client is created here.
export function createSubmissionGuard({ rpc, directory, record, networkPassphrase, timeoutMs = 120000, pollMs = 1500, clock = defaultClock }) {
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0 && Number.isFinite(pollMs) && pollMs > 0)) {
    throw new TypeError('Submission timing limits must be positive finite numbers.');
  }
  const root = resolve(directory instanceof URL ? fileURLToPath(directory) : directory);
  mkdirSync(root, { recursive: true });
  const gateFile = join(root, 'pending-submission.json');
  const timestamp = () => new Date(clock.now()).toISOString();

  function persist(file, value, flag) {
    const fd = openSync(file, flag, 0o600);
    try { writeFileSync(fd, json(value)); fsyncSync(fd); }
    finally { closeSync(fd); }
  }
  function readGate() {
    let text;
    try { text = readFileSync(gateFile, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const gate = JSON.parse(text);
    if (!gate || typeof gate.label !== 'string' || !/^[a-f0-9]{64}$/.test(gate.hash) ||
        typeof gate.networkPassphrase !== 'string' || !/^[a-f0-9-]{36}$/.test(gate.attempt)) {
      throw new Error('The pending submission gate is invalid. Preserve it for manual reconciliation.');
    }
    return gate;
  }
  const archiveFile = gate => join(root, `submission-${gate.attempt}.jsonl`);
  function event(gate, stage, details = {}) {
    persist(archiveFile(gate), { stage, timestamp: timestamp(), ...details }, 'a');
  }
  function blocked(gate, cause, archive = true) {
    const error = new UnknownSubmission(gate?.label ?? 'pending-submission', gate?.hash, cause);
    const details = { hash: error.hash, outcome: 'unknown', cause: String(cause), action: 'Reconcile the original hash before signing or submitting.' };
    if (archive && gate) {
      try { event(gate, 'blocked', details); }
      catch (failure) { error.archiveError = String(failure); }
    }
    try { record(`${error.label}.submission`, 'blocked', details); }
    catch (failure) { error.recordError = String(failure); }
    return error;
  }
  function pending() {
    try { return readGate(); }
    catch (cause) { throw blocked(null, cause, false); }
  }
  function assertClear() {
    const gate = pending();
    if (gate) throw blocked(gate, new Error('An unresolved submission already exists.'), false);
  }
  function verifyResponse(gate, response) {
    for (const hash of [response?.hash, response?.txHash]) {
      if (hash !== undefined && hash !== gate.hash) throw new Error('The RPC response contains a different transaction hash.');
    }
  }
  async function bounded(action, deadline) {
    const remaining = deadline - clock.now();
    if (remaining <= 0) throw new Error('The submission deadline expired.');
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(action),
        new Promise((_, reject) => { timer = clock.setTimeout(() => reject(new Error('The submission deadline expired.')), remaining); }),
      ]);
      if (clock.now() >= deadline) throw new Error('The submission deadline expired.');
      return result;
    } finally { clock.clearTimeout(timer); }
  }
  function clear(gate) {
    const current = readGate();
    if (!current || current.attempt !== gate.attempt) throw new Error('The pending submission gate changed.');
    unlinkSync(gateFile);
  }
  function finish(gate, result, sent, reconciliation = false) {
    const failed = result.status === 'FAILED' || rejected(result);
    const matches = gate.expectFailure ? failed : result.status === 'SUCCESS';
    const outcome = { hash: gate.hash, status: result.status, ledger: result.ledger, result, sent };
    event(gate, reconciliation ? 'reconciled' : 'terminal', outcome);
    record(`${gate.label}.submission`, reconciliation ? 'reconciled' : matches ? 'passed' : 'failed', {
      hash: gate.hash, transaction_status: result.status, ledger: result.ledger,
      outcome: failed ? 'protocol_failure' : 'success', expectFailure: gate.expectFailure,
      expectationMatched: matches, archive: archiveFile(gate),
    });
    clear(gate);
    return { outcome, matches };
  }

  async function send(tx, label, { expectFailure = false } = {}) {
    assertClear();
    const hash = Buffer.from(tx.hash()).toString('hex');
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('The transaction hash must contain 32 bytes.');
    const gate = { attempt: randomUUID(), label, hash, networkPassphrase, expectFailure, submittedAt: timestamp() };
    const deadline = clock.now() + timeoutMs;
    persist(archiveFile(gate), { stage: 'prepared', ...gate, envelope_xdr: tx.toXDR() }, 'wx');
    try { persist(gateFile, gate, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') assertClear(); throw error; }
    let completed;
    try {
      const sent = await bounded(() => rpc.sendTransaction(tx), deadline);
      event(gate, 'sent', { response: sent }); // Durable before the first lookup.
      verifyResponse(gate, sent);
      let result = sent;
      if (!terminal(sent) && !rejected(sent)) {
        if (!['PENDING', 'DUPLICATE'].includes(sent?.status)) throw new Error(`Nonterminal send status: ${sent?.status}`);
        do {
          await bounded(() => new Promise(resolve => clock.setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - clock.now())))), deadline);
          result = await bounded(() => rpc.getTransaction(hash), deadline);
          event(gate, 'polled', { response: result });
          verifyResponse(gate, result);
          if (terminal(result)) break;
          if (result?.status !== 'NOT_FOUND') throw new Error(`Nonterminal lookup status: ${result?.status}`);
        } while (true);
      }
      completed = finish(gate, result, sent);
    } catch (cause) { throw blocked(gate, cause); }
    if (!completed.matches) {
      throw new Error(`${label}: expected ${expectFailure ? 'protocol rejection' : 'SUCCESS'}, got ${completed.outcome.status}`);
    }
    return completed.outcome;
  }

  async function reconcile() {
    const gate = pending();
    if (!gate) return null;
    try {
      if (gate.networkPassphrase !== networkPassphrase) throw new Error('The pending submission belongs to a different network.');
      const result = await bounded(() => rpc.getTransaction(gate.hash), clock.now() + timeoutMs);
      event(gate, 'reconciliation_lookup', { response: result });
      verifyResponse(gate, result);
      if (!terminal(result)) throw new Error(`The original hash remains unresolved: ${result?.status}`);
      const events = readFileSync(archiveFile(gate), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const sent = events.find(entry => entry.stage === 'sent')?.response;
      return finish(gate, result, sent, true).outcome;
    } catch (cause) { throw blocked(gate, cause); }
  }

  return { send, assertClear, reconcile };
}
