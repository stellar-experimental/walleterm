import { requestError } from '../sdk/errors.ts';
import { openSync, closeSync, writeFileSync, fsyncSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export class UnknownSubmission extends Error {
  readonly code: 'unknown_submission';
  readonly label: string;
  readonly hash: string | undefined;
  declare archiveError?: string;
  declare recordError?: string;
  constructor(label: string, hash: string | undefined, cause: unknown) {
    super(
      `${label}: submission outcome is unknown for ${hash ?? 'the pending gate'}. Reconcile before continuing.`,
      { cause },
    );
    this.name = 'UnknownSubmission';
    this.code = 'unknown_submission';
    this.label = label;
    this.hash = hash;
  }
}

/** The network gave a definite result that differs from the expected one. */
export class KnownRejection extends Error {
  readonly code: 'known_rejection';
  readonly outcome: SubmissionOutcome<RpcStatus, unknown>;
  constructor(message: string, outcome: SubmissionOutcome<RpcStatus, unknown>) {
    super(message);
    this.code = 'known_rejection';
    this.outcome = outcome;
  }
}

/** The fields that the guard reads from RPC send and lookup responses. */
export interface RpcStatus {
  status: string;
  hash?: string;
  txHash?: string;
  ledger?: number;
  errorResult?: unknown;
}
export interface SubmittedTransaction {
  hash(): Uint8Array;
  toXDR(): string;
}
export interface SubmissionRpc<Sent extends RpcStatus, Found extends RpcStatus> {
  sendTransaction(tx: SubmittedTransaction): Promise<Sent>;
  getTransaction(hash: string): Promise<Found>;
}
export interface SubmissionOutcome<Result, Sent> {
  hash: string;
  status: string;
  ledger?: number;
  result: Result;
  sent: Sent;
}
export interface SubmitOptions {
  expectFailure?: boolean;
  attempt?: string;
}
type TimerHandle = ReturnType<typeof setTimeout> | number;
export interface SubmissionClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(timer: TimerHandle | undefined): void;
}
export interface SubmissionGuardOptions<Sent extends RpcStatus, Found extends RpcStatus> {
  rpc: SubmissionRpc<Sent, Found>;
  directory: string | URL;
  record: (id: string, status: string, details: Record<string, unknown>) => unknown;
  networkPassphrase: string;
  timeoutMs?: number;
  pollMs?: number;
  clock?: SubmissionClock;
}
// Parsed gates keep expectFailure and submittedAt as written. Only the checked fields have exact types.
interface Gate {
  attempt: string;
  label: string;
  hash: string;
  networkPassphrase: string;
  expectFailure?: unknown;
  submittedAt?: unknown;
}
type ArchiveEvent = Record<string, unknown>;

// Reads the transaction hash that an error reports, if any.
export function errorHash(error: unknown): string | undefined {
  return error instanceof Error && 'hash' in error && typeof error.hash === 'string' ? error.hash : undefined;
}

const defaultClock: SubmissionClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};
const json = (value: unknown) =>
  JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)) + '\n';
const terminal = (result: RpcStatus | undefined) =>
  result?.status === 'SUCCESS' || result?.status === 'FAILED';
const rejected = (result: RpcStatus | undefined) => result?.status === 'ERROR' && !!result.errorResult;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
function isGate(value: unknown): value is Gate {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    typeof value.hash === 'string' &&
    /^[a-f0-9]{64}$/.test(value.hash) &&
    typeof value.networkPassphrase === 'string' &&
    typeof value.attempt === 'string' &&
    /^[a-f0-9-]{36}$/.test(value.attempt)
  );
}
function readEvents(contents: string): ArchiveEvent[] {
  return contents
    .trim()
    .split('\n')
    .map((line) => {
      const event: unknown = JSON.parse(line);
      if (!isRecord(event)) throw new TypeError('The submission archive contains an invalid event.');
      return event;
    });
}

// clock is injectable for offline tests. No signer or network client is created here.
export function createSubmissionGuard<Sent extends RpcStatus, Found extends RpcStatus>({
  rpc,
  directory,
  record,
  networkPassphrase,
  timeoutMs = 120000,
  pollMs = 1500,
  clock = defaultClock,
}: SubmissionGuardOptions<Sent, Found>) {
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0 && Number.isFinite(pollMs) && pollMs > 0)) {
    throw new TypeError('Submission timing limits must be positive finite numbers.');
  }
  const root = resolve(directory instanceof URL ? fileURLToPath(directory) : directory);
  mkdirSync(root, { recursive: true });
  const gateFile = join(root, 'pending-submission.json');
  const timestamp = () => new Date(clock.now()).toISOString();

  function persist(file: string, value: unknown, flag: string) {
    const fd = openSync(file, flag, 0o600);
    try {
      writeFileSync(fd, json(value));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  function readGate(): Gate | null {
    let text;
    try {
      text = readFileSync(gateFile, 'utf8');
    } catch (errorValue) {
      const error = requestError(errorValue);
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const gate: unknown = JSON.parse(text);
    if (!isGate(gate)) {
      throw new Error('The pending submission gate is invalid. Preserve it for manual reconciliation.');
    }
    return gate;
  }
  const archiveFile = (gate: Gate) => join(root, `submission-${gate.attempt}.jsonl`);
  function event(gate: Gate, stage: string, details: Record<string, unknown> = {}) {
    persist(archiveFile(gate), { stage, timestamp: timestamp(), ...details }, 'a');
  }
  function blocked(gate: Gate | null, cause: unknown, archive = true) {
    const error = new UnknownSubmission(gate?.label ?? 'pending-submission', gate?.hash, cause);
    const details = {
      hash: error.hash,
      outcome: 'unknown',
      cause: String(cause),
      action: 'Reconcile the original hash before signing or submitting.',
    };
    if (archive && gate) {
      try {
        event(gate, 'blocked', details);
      } catch (failure) {
        error.archiveError = String(failure);
      }
    }
    try {
      record(`${error.label}.submission`, 'blocked', details);
    } catch (failure) {
      error.recordError = String(failure);
    }
    return error;
  }
  function pending() {
    try {
      return readGate();
    } catch (cause) {
      throw blocked(null, cause, false);
    }
  }
  function assertClear() {
    const gate = pending();
    if (gate) throw blocked(gate, new Error('An unresolved submission already exists.'), false);
  }
  function verifyResponse(gate: Gate, response: RpcStatus | undefined) {
    for (const hash of [response?.hash, response?.txHash]) {
      if (hash !== undefined && hash !== gate.hash)
        throw new Error('The RPC response contains a different transaction hash.');
    }
  }
  async function bounded<T>(action: () => T | PromiseLike<T>, deadline: number): Promise<T> {
    const remaining = deadline - clock.now();
    if (remaining <= 0) throw new Error('The submission deadline expired.');
    let timer: TimerHandle | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(action),
        new Promise<never>((_, reject) => {
          timer = clock.setTimeout(() => reject(new Error('The submission deadline expired.')), remaining);
        }),
      ]);
      if (clock.now() >= deadline) throw new Error('The submission deadline expired.');
      return result;
    } finally {
      clock.clearTimeout(timer);
    }
  }
  function clear(gate: Gate) {
    const current = readGate();
    if (!current || current.attempt !== gate.attempt) throw new Error('The pending submission gate changed.');
    unlinkSync(gateFile);
  }
  function finish<Result extends RpcStatus, Archived>(
    gate: Gate,
    result: Result,
    sent: Archived,
    reconciliation = false,
  ) {
    const failed = result.status === 'FAILED' || rejected(result);
    const matches = gate.expectFailure ? failed : result.status === 'SUCCESS';
    const outcome: SubmissionOutcome<Result, Archived> = {
      hash: gate.hash,
      status: result.status,
      ledger: result.ledger,
      result,
      sent,
    };
    event(gate, reconciliation ? 'reconciled' : 'terminal', { ...outcome });
    record(`${gate.label}.submission`, reconciliation ? 'reconciled' : matches ? 'passed' : 'failed', {
      hash: gate.hash,
      transaction_status: result.status,
      ledger: result.ledger,
      outcome: failed ? 'protocol_failure' : 'success',
      expectFailure: gate.expectFailure,
      expectationMatched: matches,
      archive: archiveFile(gate),
    });
    clear(gate);
    return { outcome, matches };
  }

  async function send(
    tx: SubmittedTransaction,
    label: string,
    { expectFailure = false, attempt = randomUUID() }: SubmitOptions = {},
  ) {
    assertClear();
    if (!/^[a-f0-9-]{36}$/.test(attempt)) throw new TypeError('The submission attempt is invalid.');
    const hash = Buffer.from(tx.hash()).toString('hex');
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('The transaction hash must contain 32 bytes.');
    const gate: Gate = { attempt, label, hash, networkPassphrase, expectFailure, submittedAt: timestamp() };
    const deadline = clock.now() + timeoutMs;
    persist(archiveFile(gate), { stage: 'prepared', ...gate, envelope_xdr: tx.toXDR() }, 'wx');
    try {
      persist(gateFile, gate, 'wx');
    } catch (errorValue) {
      const error = requestError(errorValue);
      if (error.code === 'EEXIST') assertClear();
      throw error;
    }
    let completed;
    try {
      const sent = await bounded(() => rpc.sendTransaction(tx), deadline);
      event(gate, 'sent', { response: sent }); // Durable before the first lookup.
      verifyResponse(gate, sent);
      let result: Sent | Found = sent;
      if (!terminal(sent) && !rejected(sent)) {
        if (!['PENDING', 'DUPLICATE'].includes(sent?.status))
          throw new Error(`Nonterminal send status: ${sent?.status}`);
        do {
          await bounded(
            () =>
              new Promise<void>((resolve) =>
                clock.setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - clock.now()))),
              ),
            deadline,
          );
          result = await bounded(() => rpc.getTransaction(hash), deadline);
          event(gate, 'polled', { response: result });
          verifyResponse(gate, result);
          if (terminal(result)) break;
          if (result?.status !== 'NOT_FOUND') throw new Error(`Nonterminal lookup status: ${result?.status}`);
        } while (true);
      }
      completed = finish(gate, result, sent);
    } catch (cause) {
      throw blocked(gate, cause);
    }
    if (!completed.matches) {
      throw new KnownRejection(
        `${label}: expected ${expectFailure ? 'protocol rejection' : 'SUCCESS'}, got ${completed.outcome.status}`,
        completed.outcome,
      );
    }
    return completed.outcome;
  }

  async function reconcile() {
    const gate = pending();
    if (!gate) return null;
    try {
      if (gate.networkPassphrase !== networkPassphrase)
        throw new Error('The pending submission belongs to a different network.');
      const result = await bounded(() => rpc.getTransaction(gate.hash), clock.now() + timeoutMs);
      event(gate, 'reconciliation_lookup', { response: result });
      verifyResponse(gate, result);
      if (!terminal(result)) throw new Error(`The original hash remains unresolved: ${result?.status}`);
      const events = readEvents(readFileSync(archiveFile(gate), 'utf8'));
      const sent = events.find((entry) => entry.stage === 'sent')?.response;
      return finish(gate, result, sent, true).outcome;
    } catch (cause) {
      throw blocked(gate, cause);
    }
  }

  function recoverKnownRejection(hash: string, attempt: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('The transaction hash is invalid.');
    if (!/^[a-f0-9-]{36}$/.test(attempt)) throw new TypeError('The submission attempt is invalid.');
    const gate = pending();
    if (gate && (gate.hash !== hash || gate.attempt !== attempt)) {
      throw blocked(gate, new Error('A different submission remains unresolved.'), false);
    }
    let contents;
    try {
      contents = readFileSync(join(root, `submission-${attempt}.jsonl`), 'utf8');
    } catch (errorValue) {
      const error = requestError(errorValue);
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const events = readEvents(contents);
    const prepared = events.find(
      (event) => event.stage === 'prepared' && event.hash === hash && event.attempt === attempt,
    );
    const terminal = [...events]
      .reverse()
      .find(
        (event) =>
          event.stage === 'terminal' &&
          event.hash === hash &&
          (event.status === 'ERROR' || event.status === 'FAILED'),
      );
    if (!prepared || !terminal) return null;
    if (gate) clear(gate);
    return { hash, status: terminal.status, ledger: terminal.ledger ?? null };
  }

  return { send, assertClear, reconcile, pending, recoverKnownRejection };
}
