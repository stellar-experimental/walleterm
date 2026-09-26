import { onTestFinished, test } from 'bun:test';
import { requestError } from '../sdk/errors.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createSubmissionGuard,
  UnknownSubmission,
  type RpcStatus,
  type SubmissionClock,
  type SubmittedTransaction,
} from './submission.ts';

const hash = 'ab'.repeat(32);
const tx = { hash: () => Uint8Array.from(Buffer.from(hash, 'hex')), toXDR: () => 'offline-envelope' };
const nextTx = { hash: () => Buffer.alloc(32, 0xcd), toXDR: () => 'another-offline-envelope' };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeClock() {
  let now = 0,
    next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    elapse: (ms: number) => {
      now += ms;
    },
    setTimeout(fn: () => void, ms: number) {
      const id = ++next;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: unknown) => {
      if (typeof id === 'number') timers.delete(id);
    },
    async tick(ms: number) {
      const end = now + ms;
      await turn();
      while (true) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        const [id, timer] = due[0];
        timers.delete(id);
        now = timer.at;
        timer.fn();
        await turn();
      }
      now = end;
      await turn();
    },
  };
}
interface Handlers {
  send: (value: SubmittedTransaction) => Promise<RpcStatus>;
  lookup: (value: string) => Promise<RpcStatus>;
}
type RecordCall = [id: string, status: string, details: { [key: string]: unknown }];
function setup(overrides: Partial<Handlers> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-submission-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const clock = fakeClock();
  const records: RecordCall[] = [];
  const calls: { send: number; lookup: string[] } = { send: 0, lookup: [] };
  const handlers: Handlers = {
    send: async () => ({ status: 'PENDING', hash }),
    lookup: async () => ({ status: 'SUCCESS', ledger: 100, txHash: hash }),
    ...overrides,
  };
  const rpc = {
    async sendTransaction(value: SubmittedTransaction) {
      calls.send++;
      return handlers.send(value);
    },
    async getTransaction(value: string) {
      calls.lookup.push(value);
      return handlers.lookup(value);
    },
  };
  const options = {
    rpc,
    directory,
    networkPassphrase: 'offline test network',
    record: (...args: RecordCall) => records.push(args),
    timeoutMs: 30,
    pollMs: 5,
    clock: clock satisfies SubmissionClock,
  };
  const guard = createSubmissionGuard(options);
  const gateFile = join(directory, 'pending-submission.json');
  const archives = () =>
    readdirSync(directory)
      .filter((file) => file.endsWith('.jsonl'))
      .sort();
  const events = (file = archives()[0]): ArchiveLine[] =>
    readFileSync(join(directory, file), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { guard, options, directory, gateFile, archives, events, records, handlers, calls, clock };
}
// Archive lines are test observations. Each read checks the field it uses.
interface ArchiveLine {
  stage?: string;
  envelope_xdr?: string;
  response?: { status?: string; errorResult?: { fee?: string } };
}
const unknown = (error: unknown, expectedHash = hash): error is UnknownSubmission => {
  assert.ok(error instanceof UnknownSubmission);
  assert.equal(error.code, 'unknown_submission');
  assert.equal(error.hash, expectedHash);
  return true;
};

test('archived rejection cannot clear a newer attempt with the same hash', async () => {
  let sends = 0;
  const { guard, gateFile, options } = setup({
    send: async () => {
      sends++;
      if (sends === 1) return { status: 'ERROR', hash, errorResult: {} };
      throw new Error('The response was lost.');
    },
  });
  const oldAttempt = '11111111-1111-4111-8111-111111111111';
  const newAttempt = '22222222-2222-4222-8222-222222222222';
  await assert.rejects(
    guard.send(tx, 'old', { attempt: oldAttempt }),
    (error) => requestError(error).code === 'known_rejection',
  );
  await assert.rejects(guard.send(tx, 'new', { attempt: newAttempt }), unknown);
  const restarted = createSubmissionGuard(options);
  assert.throws(() => restarted.recoverKnownRejection(hash, oldAttempt), unknown);
  assert.equal(restarted.recoverKnownRejection(hash, newAttempt), null);
  assert.equal(JSON.parse(readFileSync(gateFile, 'utf8')).attempt, newAttempt);
});
async function resultAfterTick<T>(promise: Promise<T>, clock: ReturnType<typeof fakeClock>, ms = 5) {
  // Attach a rejection handler before advancing the injected clock.
  type Settled = { value?: T; error?: unknown };
  const result = promise.then(
    (value): Settled => ({ value }),
    (error: unknown): Settled => ({ error }),
  );
  await clock.tick(ms);
  return result;
}

test('gate and envelope persist before send; sent response persists before lookup', async () => {
  const f = setup();
  f.handlers.send = async (value) => {
    assert.equal(value, tx);
    assert.equal(JSON.parse(readFileSync(f.gateFile, 'utf8')).hash, hash);
    assert.equal(f.events()[0].envelope_xdr, 'offline-envelope');
    assert.throws(f.guard.assertClear, unknown);
    return { status: 'PENDING', hash };
  };
  f.handlers.lookup = async (requestedHash) => {
    assert.equal(requestedHash, hash);
    assert.equal(f.events().find((event) => event.stage === 'sent')?.response?.status, 'PENDING');
    return { status: 'SUCCESS', ledger: 100, txHash: hash };
  };
  const { value, error } = await resultAfterTick(f.guard.send(tx, 'accepted'), f.clock);
  assert.ifError(error);
  assert.deepEqual(value, {
    hash,
    status: 'SUCCESS',
    ledger: 100,
    result: { status: 'SUCCESS', ledger: 100, txHash: hash },
    sent: { status: 'PENDING', hash },
  });
  assert.equal(f.calls.send, 1);
  assert.equal(existsSync(f.gateFile), false);
  assert.doesNotThrow(f.guard.assertClear);
  assert.equal(f.records.at(-1)?.[1], 'passed');
  assert.equal(f.records.at(-1)?.[2].status, undefined);
  assert.equal(f.records.at(-1)?.[2].transaction_status, 'SUCCESS');
});

test('dropped send response retains original hash and blocks a second send', async () => {
  const drop = new Error('send response dropped');
  const f = setup({
    send: async () => {
      throw drop;
    },
  });
  await assert.rejects(f.guard.send(tx, 'lost-send', { expectFailure: true }), (error) => {
    assert.ok(unknown(error));
    assert.equal(error.cause, drop);
    return true;
  });
  assert.equal(JSON.parse(readFileSync(f.gateFile, 'utf8')).hash, hash);
  assert.equal(f.records.at(-1)?.[1], 'blocked');
  assert.equal(f.events().at(-1)?.stage, 'blocked');
  await assert.rejects(f.guard.send(nextTx, 'must-not-send'), unknown);
  assert.equal(f.calls.send, 1);
  assert.equal(f.calls.lookup.length, 0);
  assert.equal(f.archives().length, 1);
});

test('dropped poll response retains sent response and blocks signer guard', async () => {
  const drop = new Error('poll response dropped');
  const f = setup({
    lookup: async () => {
      throw drop;
    },
  });
  const { error } = await resultAfterTick(f.guard.send(tx, 'lost-poll', { expectFailure: true }), f.clock);
  assert.ok(unknown(error));
  assert.equal(error.cause, drop);
  assert.equal(f.events().find((event) => event.stage === 'sent')?.response?.status, 'PENDING');
  assert.throws(f.guard.assertClear, unknown);
  assert.deepEqual(f.calls.lookup, [hash]);
  assert.equal(f.calls.send, 1);
});

test('pending NOT_FOUND lookups reach a bounded deadline without resubmission', async () => {
  const f = setup({ lookup: async () => ({ status: 'NOT_FOUND' }) });
  const { error } = await resultAfterTick(f.guard.send(tx, 'pending'), f.clock, 30);
  assert.ok(unknown(error));
  assert.match(String(error.cause), /deadline expired/);
  assert.equal(existsSync(f.gateFile), true);
  assert.ok(f.calls.lookup.length > 0 && f.calls.lookup.length <= 6);
  assert.ok(f.calls.lookup.every((value) => value === hash));
  assert.equal(f.calls.send, 1);
});

for (const phase of ['send', 'lookup']) {
  test(`a hanging ${phase} call times out and a late response cannot clear the gate`, async () => {
    let resolveRPC: ((value: RpcStatus) => void) | undefined;
    const f = setup({
      [phase]: () =>
        new Promise((resolve) => {
          resolveRPC = resolve;
        }),
    });
    const { error } = await resultAfterTick(f.guard.send(tx, 'hanging'), f.clock, 30);
    unknown(error);
    assert.ok(resolveRPC);
    resolveRPC({ status: 'SUCCESS', ledger: 100, hash });
    await turn();
    assert.throws(f.guard.assertClear, unknown);
    assert.equal(f.calls.send, 1);
  });
}

test('a recreated guard remains blocked; NOT_FOUND reconciliation does not clear it', async () => {
  const f = setup({
    send: async () => {
      throw new Error('lost');
    },
    lookup: async () => ({ status: 'NOT_FOUND' }),
  });
  await assert.rejects(f.guard.send(tx, 'restart'), unknown);
  const recreated = createSubmissionGuard(f.options);
  assert.throws(recreated.assertClear, unknown);
  await assert.rejects(recreated.send(nextTx, 'second'), unknown);
  await assert.rejects(recreated.reconcile(), unknown);
  assert.throws(recreated.assertClear, unknown);
  assert.deepEqual(f.calls.lookup, [hash]);
  assert.equal(f.calls.send, 1);
});

for (const status of ['SUCCESS', 'FAILED']) {
  test(`explicit reconciliation clears only the original terminal ${status} hash`, async () => {
    const f = setup({
      send: async () => {
        throw new Error('lost');
      },
    });
    await assert.rejects(f.guard.send(tx, 'reconcile'), unknown);
    const before = readFileSync(join(f.directory, f.archives()[0]), 'utf8');
    f.handlers.lookup = async (requestedHash) => {
      assert.equal(requestedHash, hash);
      return { status, ledger: 101, txHash: hash };
    };
    const recreated = createSubmissionGuard(f.options);
    const result = await recreated.reconcile();
    assert.equal(result?.hash, hash);
    assert.equal(result?.status, status);
    assert.equal(result?.sent, undefined);
    assert.doesNotThrow(recreated.assertClear);
    assert.equal(f.calls.send, 1);
    assert.ok(readFileSync(join(f.directory, f.archives()[0]), 'utf8').startsWith(before));
    assert.equal(f.records.at(-1)?.[1], 'reconciled');
    assert.equal(await recreated.reconcile(), null);
    assert.deepEqual(f.calls.lookup, [hash]);
  });
}

for (const status of ['PENDING', 'DUPLICATE', 'TRY_AGAIN_LATER', 'ERROR', 'unexpected']) {
  test(`reconciliation leaves ${status} blocked, including ERROR with a result`, async () => {
    const f = setup({
      send: async () => {
        throw new Error('lost');
      },
      lookup: async () => ({ status, errorResult: { result: 'txBadAuth' } }),
    });
    await assert.rejects(f.guard.send(tx, 'reconcile'), unknown);
    await assert.rejects(f.guard.reconcile(), unknown);
    assert.equal(existsSync(f.gateFile), true);
    assert.equal(f.calls.send, 1);
  });
}

for (const sendStatus of ['PENDING', 'DUPLICATE']) {
  for (const status of ['SUCCESS', 'FAILED']) {
    for (const expectFailure of [false, true]) {
      test(`${sendStatus} followed by ${status}, expectFailure=${expectFailure}`, async () => {
        const f = setup({
          send: async () => ({ status: sendStatus, hash }),
          lookup: async () => ({ status, ledger: 200 }),
        });
        const { value, error } = await resultAfterTick(
          f.guard.send(tx, 'outcome', { expectFailure }),
          f.clock,
        );
        const matches = expectFailure ? status === 'FAILED' : status === 'SUCCESS';
        if (matches) {
          assert.ifError(error);
          assert.equal(value?.status, status);
          assert.equal(value?.sent.status, sendStatus);
        } else {
          assert.ok(error instanceof Error);
          assert.equal(error instanceof UnknownSubmission, false);
          assert.match(error.message, /expected/);
        }
        assert.equal(existsSync(f.gateFile), false);
        assert.equal(f.calls.send, 1);
        assert.equal(f.records.at(-1)?.[1], matches ? 'passed' : 'failed');
      });
    }
  }
}

for (const expectFailure of [false, true]) {
  test(`definite ERROR plus errorResult clears the gate, expectFailure=${expectFailure}`, async () => {
    const f = setup({
      send: async () => ({ status: 'ERROR', hash, errorResult: { result: 'txBadAuth', fee: 100n } }),
    });
    const promise = f.guard.send(tx, 'rejected', { expectFailure });
    if (expectFailure) assert.equal((await promise).status, 'ERROR');
    else
      await assert.rejects(
        promise,
        (error) =>
          !(error instanceof UnknownSubmission) && /expected SUCCESS/.test(requestError(error).message),
      );
    assert.equal(existsSync(f.gateFile), false);
    assert.equal(f.calls.lookup.length, 0);
    assert.equal(f.events().find((event) => event.stage === 'sent')?.response?.errorResult?.fee, '100');
  });
}

for (const status of ['ERROR', 'TRY_AGAIN_LATER', 'NOT_FOUND', 'unexpected']) {
  test(`nonterminal send ${status} blocks even when failure was expected`, async () => {
    const f = setup({ send: async () => ({ status, hash }) });
    await assert.rejects(f.guard.send(tx, 'unknown', { expectFailure: true }), unknown);
    assert.equal(existsSync(f.gateFile), true);
    assert.equal(f.calls.lookup.length, 0);
  });
}

test('separate attempts with the same label preserve previous archives exactly', async () => {
  const f = setup({ send: async () => ({ status: 'SUCCESS', hash, ledger: 100 }) });
  await f.guard.send(tx, '../same label');
  const file = f.archives()[0];
  const before = readFileSync(join(f.directory, file), 'utf8');
  await f.guard.send(tx, '../same label');
  assert.equal(f.archives().length, 2);
  assert.equal(readFileSync(join(f.directory, file), 'utf8'), before);
  assert.equal(f.calls.send, 2);
});

test('another guard cannot send while the first call is still pending', async () => {
  let resolveSend: ((value: RpcStatus) => void) | undefined;
  const f = setup({
    send: () =>
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
  });
  const first = f.guard.send(tx, 'first');
  await turn();
  const second = createSubmissionGuard(f.options);
  await assert.rejects(second.send(nextTx, 'second'), unknown);
  assert.equal(f.calls.send, 1);
  assert.ok(resolveSend);
  resolveSend({ status: 'SUCCESS', hash, ledger: 100 });
  await first;
  assert.doesNotThrow(second.assertClear);
});

test('a changed response hash cannot replace the original submission hash', async () => {
  const f = setup({ send: async () => ({ status: 'SUCCESS', hash: 'cd'.repeat(32), ledger: 100 }) });
  await assert.rejects(f.guard.send(tx, 'wrong-hash'), unknown);
  assert.equal(JSON.parse(readFileSync(f.gateFile, 'utf8')).hash, hash);
  f.handlers.lookup = async () => ({ status: 'SUCCESS', txHash: 'cd'.repeat(32), ledger: 100 });
  await assert.rejects(f.guard.reconcile(), unknown);
  assert.equal(existsSync(f.gateFile), true);
});

test('network mismatch and malformed gates fail closed without an RPC call', async () => {
  const f = setup({
    send: async () => {
      throw new Error('lost');
    },
  });
  await assert.rejects(f.guard.send(tx, 'network'), unknown);
  const wrongNetwork = createSubmissionGuard({ ...f.options, networkPassphrase: 'different network' });
  await assert.rejects(wrongNetwork.reconcile(), unknown);
  assert.equal(f.calls.lookup.length, 0);
  writeFileSync(f.gateFile, '{invalid');
  assert.throws(f.guard.assertClear, (error) => error instanceof UnknownSubmission);
  await assert.rejects(f.guard.send(tx, 'second'), (error) => error instanceof UnknownSubmission);
  assert.equal(f.calls.send, 1);
});

test('a response after the absolute deadline cannot clear the gate', async () => {
  const f = setup();
  f.handlers.send = async () => {
    f.clock.elapse(31);
    return { status: 'SUCCESS', hash, ledger: 100 };
  };
  await assert.rejects(f.guard.send(tx, 'late-response'), unknown);
  assert.equal(existsSync(f.gateFile), true);
  assert.equal(f.calls.send, 1);
});

test('a separate process reads the unresolved gate before signer use', async () => {
  const f = setup({
    send: async () => {
      throw new Error('lost');
    },
  });
  await assert.rejects(f.guard.send(tx, 'previous-process'), unknown);
  const script = `
    import { createSubmissionGuard, UnknownSubmission } from ${JSON.stringify(new URL('./submission.ts', import.meta.url).href)};
    const guard = createSubmissionGuard({ rpc: {}, directory: process.argv[1], record() {}, networkPassphrase: 'offline test network' });
    try { guard.assertClear(); process.exitCode = 2; }
    catch (error) {
      if (!(error instanceof UnknownSubmission)) throw error;
      console.log(JSON.stringify({ code: error.code, hash: error.hash }));
    }
  `;
  const child = spawnSync(process.execPath, ['-e', script, f.directory], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { code: 'unknown_submission', hash });
  assert.equal(existsSync(f.gateFile), true);
});

test('a nonterminal polling response blocks without another send', async () => {
  const f = setup({ lookup: async () => ({ status: 'PENDING' }) });
  const { error } = await resultAfterTick(f.guard.send(tx, 'nonterminal-poll'), f.clock);
  unknown(error);
  assert.equal(f.calls.send, 1);
  assert.deepEqual(f.calls.lookup, [hash]);
  assert.equal(f.records.at(-1)?.[1], 'blocked');
  assert.equal(existsSync(f.gateFile), true);
});
