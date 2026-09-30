import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { transactionPhases, walkthroughView } from '../../demo/site/walkthrough.ts';
import type { PhaseRecord } from '../../demo/site/walkthrough.ts';
import type { WalkthroughLedger } from '../../demo/site/contracts.ts';

// Pure presentation checks. Nothing here reads the network or signs.
function ledger(changes: Partial<WalkthroughLedger> = {}): WalkthroughLedger {
  return {
    signer: 'GSIGNER',
    set: 1,
    latest: 1,
    code: { account: true, target: true },
    account: { id: 'CACCOUNT', exists: true },
    target: { id: 'CTARGET', exists: true },
    count: 0,
    ...changes,
  };
}
const states = (value: ReturnType<typeof walkthroughView>) => [
  value.code.state,
  ...value.steps.map((step) => step.state),
];

test('walkthrough rows follow the ledger, one step at a time', () => {
  assert.deepEqual(states(walkthroughView(null)), ['pending', 'pending', 'pending', 'pending']);
  const cases: [Partial<WalkthroughLedger>, string[], string | null, number][] = [
    [
      {
        code: { account: false, target: false },
        account: { id: 'C', exists: false },
        target: { id: 'C', exists: false },
        count: undefined,
      },
      ['next', 'locked', 'locked', 'locked'],
      'upload-account',
      0,
    ],
    [
      {
        code: { account: true, target: false },
        account: { id: 'C', exists: false },
        target: { id: 'C', exists: false },
        count: undefined,
      },
      ['next', 'locked', 'locked', 'locked'],
      'upload-target',
      0,
    ],
    [
      { account: { id: 'C', exists: false }, target: { id: 'C', exists: false }, count: undefined },
      ['done', 'next', 'locked', 'locked'],
      'deploy-account',
      0,
    ],
    [
      { target: { id: 'C', exists: false }, count: undefined },
      ['done', 'done', 'next', 'locked'],
      'deploy-target',
      1,
    ],
    [{ count: 0 }, ['done', 'done', 'done', 'next'], 'increment', 2],
    [{ count: 3 }, ['done', 'done', 'done', 'done'], 'increment', 3],
  ];
  for (const [changes, rows, next, done] of cases) {
    const view = walkthroughView(ledger(changes));
    assert.deepEqual(states(view), rows);
    assert.equal(view.next, next);
    assert.equal(view.done, done);
  }
  assert.equal(
    walkthroughView(ledger({ code: { account: true, target: false } })).code.stage,
    'upload-target',
  );
});

test('an unfinished transaction marks its own row, including an upload', () => {
  assert.deepEqual(states(walkthroughView(ledger({ count: 2 }), 'increment')), [
    'done',
    'done',
    'done',
    'active',
  ]);
  const upload = walkthroughView(
    ledger({
      code: { account: false, target: true },
      account: { id: 'C', exists: false },
      target: { id: 'C', exists: false },
    }),
    'upload-account',
  );
  assert.deepEqual(upload.code, { state: 'active', stage: 'upload-account' });
});

const contract = (authorizationReady: boolean, stage: 'increment' | 'upload-account' = 'increment') => ({
  stage,
  authorizations:
    stage === 'increment' ? [{ xdr: 'entry', address: 'C', adapter: 'contract-ed25519' as const }] : [],
  authorizationReady,
});
const view = (record: PhaseRecord, progress?: string, confirmed?: string) =>
  transactionPhases(record, progress, confirmed).map(
    (phase) => `${phase.state}:${phase.label}${phase.detail ? ` (${phase.detail})` : ''}`,
  );

test('a contract call with an authorization shows both signatures in order', () => {
  assert.deepEqual(view({ state: 'review', contract: contract(false) }), [
    'current:Sign the authorization (Your smart account approves +1.)',
    'pending:Sign the transaction',
    'pending:Submit to testnet',
    'pending:Confirm on the ledger',
  ]);
  assert.deepEqual(
    view(
      { state: 'waiting', contract: contract(false) },
      'Waiting for 1Password on your Mac… 290s remaining.',
    ),
    [
      'current:Sign the authorization (Waiting for 1Password on your Mac… 290s remaining.)',
      'pending:Sign the transaction',
      'pending:Submit to testnet',
      'pending:Confirm on the ledger',
    ],
  );
  assert.deepEqual(view({ state: 'review', contract: contract(true) }), [
    'done:Sign the authorization (Signed. Simulation accepted it.)',
    'current:Sign the transaction',
    'pending:Submit to testnet',
    'pending:Confirm on the ledger',
  ]);
  assert.deepEqual(
    view(
      { state: 'submitted', contract: contract(true), result: { ledger: 42 } },
      '',
      'Counter increased from 2 to 3.',
    ),
    [
      'done:Sign the authorization (Signed. Simulation accepted it.)',
      'done:Sign the transaction',
      'done:Submit to testnet',
      'done:Confirm on the ledger (Ledger 42. Counter increased from 2 to 3.)',
    ],
  );
});

test('classic transactions and uploads have one signature', () => {
  for (const record of [{ state: 'signed' }, { state: 'signed', contract: contract(true, 'upload-account') }])
    assert.deepEqual(view(record), [
      'done:Sign the transaction (Signature verified.)',
      'current:Submit to testnet (Signature verified. Ready to submit.)',
      'pending:Confirm on the ledger',
    ]);
});

test('every stopped or uncertain state names the phase it stopped in', () => {
  const last = (record: PhaseRecord) =>
    transactionPhases(record).find((phase) => phase.state === 'failed' || phase.state === 'unknown');
  const cases: [PhaseRecord, string, string][] = [
    [{ state: 'signing_unknown', contract: contract(false) }, 'unknown', 'Sign the authorization'],
    [{ state: 'signing_unknown', contract: contract(true) }, 'unknown', 'Sign the transaction'],
    [{ state: 'denied', contract: contract(false) }, 'failed', 'Sign the authorization'],
    [{ state: 'canceled' }, 'failed', 'Sign the transaction'],
    [{ state: 'expired' }, 'failed', 'Sign the transaction'],
    [{ state: 'expired', signed_xdr: 'signed' }, 'failed', 'Submit to testnet'],
    [{ state: 'unknown', signed_xdr: 'signed' }, 'unknown', 'Submit to testnet'],
    [{ state: 'failed', result: { rejected: true, code: 'tx_bad_auth' } }, 'failed', 'Submit to testnet'],
    [{ state: 'failed', result: { successful: false } }, 'failed', 'Confirm on the ledger'],
    [{ state: 'failed' }, 'failed', 'Sign the transaction'],
  ];
  for (const [record, state, label] of cases) {
    const phase = last(record);
    assert.equal(phase?.state, state, record.state);
    assert.equal(phase?.label, label, record.state);
    assert.ok(phase?.detail, record.state);
  }
  assert.equal(
    last({ state: 'failed', result: { rejected: true, code: 'tx_bad_auth' } })?.detail,
    'Testnet rejected it: tx_bad_auth.',
  );
});

test('a stopped signature says whether anything was signed, and asks to decline only an open prompt', () => {
  const detail = (record: PhaseRecord) =>
    transactionPhases(record).find((phase) => phase.state === 'failed' || phase.state === 'unknown')?.detail;
  // A declined prompt, a canceled request, and an expired request signed nothing. None asks for another decline.
  assert.equal(detail({ state: 'denied' }), 'The signing request was declined. Nothing was signed.');
  assert.equal(detail({ state: 'canceled' }), 'The signing request was canceled. Nothing was signed.');
  assert.equal(detail({ state: 'expired' }), 'The signing request expired. Nothing was signed.');
  assert.equal(
    detail({ state: 'signing_unknown' }),
    'The signing result is unknown. If a 1Password prompt is still open, decline it.',
  );
  assert.equal(
    detail({ state: 'unknown', signed_xdr: 'signed' }),
    'The result is unknown. Select Check transaction status. Do not sign a replacement.',
  );
});
