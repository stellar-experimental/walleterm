// The test host reports each call to its signer. The live harnesses count these events, because one request
// can print both a Signed line and a withheld line. Isolated offline mock keys only.
import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { createHost } from './host.ts';

const key = Keypair.random();
const site = 'https://site-one.example';

function transaction(id: string) {
  const tx = new TransactionBuilder(new Account(key.publicKey(), '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'test', value: 'hello' }))
    .setTimeout(180)
    .build();
  return {
    id,
    kind: 'transaction',
    address: key.publicKey(),
    network_passphrase: Networks.TESTNET,
    xdr: tx.toXDR(),
  };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), 'The condition never held.');
}

async function scenario(ending: 'delivered' | 'undelivered' | 'canceled' | 'failed') {
  let events = 0,
    signerCalls = 0;
  const logs: string[] = [];
  const host = await createHost({
    listSigners: async () => [{ public_key: key.publicKey() }],
    sign: async (_key, digest) => {
      signerCalls++;
      if (ending === 'failed') throw Object.assign(Error('Mock signer failure'), { status: 502 });
      return Buffer.from(key.sign(Buffer.from(digest, 'hex'))).toString('hex');
    },
    log: (line) => logs.push(line),
    onSign: () => events++,
  });
  onTestFinished(() => host.close());
  const call = async (path: string, data?: unknown, token?: string) => {
    const response = await fetch(host.origin + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Origin: site,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const { token } = (await call('/v1/connect', { code: await host.code(), wallet_scope: 'selected' })).data;
  assert.equal((await call('/v1/select', { public_key: key.publicKey() }, token)).status, 200);
  assert.equal((await call('/v1/requests', transaction('counted'), token)).status, 201);
  await until(() => logs.length > 0);
  if (ending === 'delivered')
    assert.equal((await call('/v1/requests/counted', undefined, token)).data.state, 'signed');
  if (ending === 'undelivered') assert.equal((await call('/v1/disconnect', {}, token)).status, 200);
  if (ending === 'canceled')
    assert.equal((await call('/v1/requests/counted/cancel', {}, token)).data.state, 'unknown');
  return { events, signerCalls, logs };
}

for (const ending of ['delivered', 'undelivered', 'canceled', 'failed'] as const)
  test(`a ${ending} request reports one signer call`, async () => {
    const { events, signerCalls, logs } = await scenario(ending);
    assert.equal(signerCalls, 1);
    assert.equal(events, 1, `terminal lines: ${JSON.stringify(logs)}`);
    // The terminal can print two lines for one call. That is why the harness counts events.
    if (ending === 'undelivered' || ending === 'canceled') assert.equal(logs.length, 2);
  });
