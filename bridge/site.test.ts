import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { browserScript } from './test/support.ts';
import * as sdk from '@stellar/stellar-sdk';
import { attachAuthSignature, createAuthEntry, inspectAuthEntry } from '../sdk/authorization.ts';
import { authorizationExpiry, deployment, hex, validateContractReview } from '../demo/site/contracts.ts';
import type { ContractReview } from '../demo/site/contracts.ts';

// The page reads and writes only these element members.
interface MockElement {
  hidden: boolean;
  disabled: boolean;
  open: boolean;
  value: string;
  textContent: string;
  children: unknown[];
  onclick?: () => unknown;
  classList: { toggle(): void };
  setAttribute(): void;
  addEventListener(): void;
  focus(): void;
  showModal(): void;
  close(): void;
  append(...nodes: unknown[]): void;
  replaceChildren(...nodes: unknown[]): void;
  add(): void;
}
function element(): MockElement {
  return {
    hidden: false,
    disabled: false,
    open: false,
    value: '',
    textContent: '',
    children: [],
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener() {},
    focus() {},
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    add() {},
  };
}
interface ConnectionChange {
  client: unknown;
  account: unknown;
}
function contextFor(html: string, extras: Record<string, unknown> = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map((m) => [m[1], element()]));
  const context = vm.createContext({
    document: { getElementById: (id: string) => elements.get(id), createElement: element },
    URLSearchParams,
    AbortSignal,
    AbortController,
    createCodeView: (node: MockElement) => (text: string) => {
      node.textContent = text;
    },
    highlightConnectionCommand() {},
    createActivityLog: () => ({ record() {}, transaction() {}, wrapFetch: (fetcher: unknown) => fetcher }),
    WalletermConnect: class {
      onChange: (value: ConnectionChange) => void;
      client?: { disconnect(): Promise<void> };
      constructor(_element: unknown, { onChange }: { onChange: (value: ConnectionChange) => void }) {
        this.onChange = onChange;
      }
      sync() {}
      setBusy() {}
      async disconnect() {
        assert.ok(this.client);
        await this.client.disconnect();
        this.onChange({ client: null, account: null });
      }
    },
    location: { hash: '' },
    history: { replaceState() {} },
    setInterval() {},
    clearInterval() {},
    Option: class {},
    navigator: { locks: { request: async (_name: string, fn: () => unknown) => fn() } },
    ...extras,
  });
  // Errors must come from the page realm. A test-realm requestError fails its instanceof check and drops fields.
  vm.runInContext(browserScript(new URL('../sdk/errors.ts', import.meta.url)), context);
  const run = (code: string): unknown => vm.runInContext(code, context);
  const el = (id: string) => {
    const node = elements.get(id);
    assert.ok(node, `Missing element ${id}.`);
    return node;
  };
  const click = (id: string) => {
    const handler = el(id).onclick;
    assert.ok(handler, `Element ${id} has no click handler.`);
    return handler();
  };
  return { context, elements, el, click, run, promise: (code: string) => Promise.resolve(run(code)) };
}
const app = () => browserScript(new URL('../demo/site/app.ts', import.meta.url));
const ok = (data: unknown) => ({ ok: true, json: async () => data });

function contractPage() {
  const key = sdk.Keypair.random(),
    signer = key.publicKey();
  const accountId = deployment(signer, 'account').id,
    targetId = deployment(signer, 'target').id;
  const call = new sdk.Contract(targetId).call(
    'ping',
    sdk.nativeToScVal(accountId, { type: 'address' }),
    sdk.xdr.ScVal.scvU32(1),
  );
  const body = call.body;
  if (body.type !== 'invokeHostFunction' || body.value.hostFunction.type !== 'hostFunctionTypeInvokeContract')
    throw Error();
  const invocation = new sdk.xdr.SorobanAuthorizedInvocation({
    function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      body.value.hostFunction.invokeContract,
    ),
    subInvocations: [],
  });
  const unsigned = createAuthEntry({ address: accountId, invocation, nonce: 8n, expirationLedger: 160 });
  const review: ContractReview = {
    stage: 'increment',
    accountId,
    targetId,
    before: 4,
    authorizationReady: false,
    authorizations: [{ xdr: unsigned, address: accountId, adapter: 'contract-ed25519' }],
  };
  const transaction = new sdk.TransactionBuilder(new sdk.Account(signer, '1'), {
    fee: '600',
    networkPassphrase: sdk.Networks.TESTNET,
  })
    .addOperation(
      sdk.Operation.invokeHostFunction({
        func: body.value.hostFunction,
        auth: [sdk.xdr.SorobanAuthorizationEntry.fromXDR(unsigned, 'base64')],
      }),
    )
    .setSorobanData(new sdk.SorobanDataBuilder().setResourceFee('500').build())
    .setTimeout(180)
    .build();
  let stored: string | null = null,
    authSignatures = 0,
    envelopes = 0,
    ledger = 100;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: sdk,
    contractHex: hex,
    validateContractReview,
    authorizationExpiry,
    contractRecord: {
      kind: 'contract_counter',
      address: signer,
      hash: hex(transaction.hash()),
      xdr: transaction.toXDR(),
      state: 'waiting',
      contract: review,
    },
    crypto,
    localStorage: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
      removeItem: () => {
        stored = null;
      },
    },
    demoRpc: () => ({ getLatestLedger: async () => ({ sequence: ledger }) }),
    assembleAuthorizedContract: async (_server: unknown, _transaction: unknown, value: ContractReview) => {
      assert.equal(value.authorizations[0].signed, true);
      return new sdk.TransactionBuilder(new sdk.Account(signer, '1'), {
        fee: '800',
        networkPassphrase: sdk.Networks.TESTNET,
      })
        .addOperation(
          sdk.Operation.invokeHostFunction({
            func: body.value.hostFunction,
            auth: [sdk.xdr.SorobanAuthorizationEntry.fromXDR(value.authorizations[0].xdr, 'base64')],
          }),
        )
        .setSorobanData(new sdk.SorobanDataBuilder().setResourceFee('700').build())
        .setTimeout(180)
        .build();
    },
    contractWallet: {
      token: 'mock',
      async signAuthEntry(
        encoded: string,
        options: { address: string; adapter: { type: 'contract-ed25519' } },
      ) {
        authSignatures++;
        const input = {
          auth_entry_xdr: encoded,
          public_key: signer,
          address: options.address,
          adapter: options.adapter,
          network_passphrase: sdk.Networks.TESTNET,
        };
        const checked = inspectAuthEntry(input, signer, 100);
        return {
          signedAuthEntryXdr: attachAuthSignature(input, signer, 100, hex(key.sign(checked.digest))),
          signerAddress: signer,
        };
      },
      async signTransaction(encoded: string) {
        envelopes++;
        const signed = sdk.TransactionBuilder.fromXDR(encoded, sdk.Networks.TESTNET);
        signed.sign(key);
        return { signedTxXdr: signed.toXDR(), signerAddress: signer };
      },
    },
  });
  f.run(app());
  f.run('pending=contractRecord; wallet=contractWallet');
  return {
    ...f,
    stored: () => stored,
    signatures: () => ({ authSignatures, envelopes }),
    setLedger(value: number) {
      ledger = value;
    },
  };
}

test('demo signs custom authorization first and requires a separate transaction-signing action', async () => {
  const f = contractPage();
  await f.promise('requestSignature()');
  assert.deepEqual(f.signatures(), { authSignatures: 1, envelopes: 0 });
  assert.equal(f.run('pending.state'), 'review');
  assert.equal(f.run('pending.contract.authorizationReady'), true);
  f.run('render()');
  assert.equal(f.el('sign').textContent, 'Sign transaction');
  assert.ok(f.stored()?.includes('signed'));
  await f.promise("pending.state='waiting'; requestSignature()");
  assert.deepEqual(f.signatures(), { authSignatures: 1, envelopes: 1 });
  assert.equal(f.run('pending.state'), 'signed');
});

test('unknown custom authorization survives clearing until its ledger expiry passes', async () => {
  const f = contractPage();
  f.run("pending.state='signing_unknown'; save()");
  const saved = f.stored();
  await f.click('clear');
  assert.equal(f.stored(), saved);
  assert.equal(f.run('pending.state'), 'signing_unknown');
  assert.match(f.el('status').textContent, /after ledger 160/);
  f.setLedger(161);
  await f.click('clear');
  assert.equal(f.run('pending'), null);
  assert.match(f.el('status').textContent, /stopped request was cleared/);
});

test('discard and clear replace the review instruction with the actual outcome', async () => {
  const discarded = contractPage();
  discarded.run("pending.state='review'; save(); render()");
  assert.equal(discarded.el('clear').textContent, 'Discard');
  await discarded.click('clear');
  assert.equal(discarded.run('pending'), null);
  assert.equal(discarded.stored(), null);
  assert.equal(discarded.el('status').textContent, 'The transaction was discarded. Choose another action.');
  assert.deepEqual(discarded.signatures(), { authSignatures: 0, envelopes: 0 });

  const signed = contractPage();
  await signed.promise('requestSignature()');
  await signed.promise("pending.state='waiting'; requestSignature()");
  assert.equal(signed.run('pending.state'), 'signed');
  await signed.click('clear');
  assert.equal(signed.run('pending'), null);
  assert.equal(
    signed.el('status').textContent,
    'The signed transaction was cleared without submission. Choose another action.',
  );
});

test('unverified authorization responses keep the reviewed entry and its expiry protected', async () => {
  const f = contractPage();
  const original = f.run('pending.xdr');
  f.run(
    "contractWallet.signAuthEntry=async()=>{throw Object.assign(Error('Unverified authorization result.'),{requestState:'unknown',canceled:false})}",
  );
  await assert.rejects(f.promise('requestSignature()'), /Unverified/);
  assert.equal(f.run('pending.state'), 'signing_unknown');
  assert.equal(f.run('pending.xdr'), original);
  assert.equal(f.run('authorizationExpiry(pending.contract)'), 160);
  await f.click('clear');
  assert.equal(f.run('pending.state'), 'signing_unknown');
});

test('a saved contract journal rejects another signed transaction before submission', async () => {
  const f = contractPage();
  await f.promise('requestSignature()');
  await f.promise("pending.state='waiting'; requestSignature()");
  f.run('save()');
  const saved = JSON.parse(f.stored()!);
  const other = sdk.Keypair.random();
  const transaction = new sdk.TransactionBuilder(new sdk.Account(other.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: sdk.Networks.TESTNET,
  })
    .addOperation(sdk.Operation.manageData({ name: 'unreviewed', value: 'different' }))
    .setTimeout(180)
    .build();
  transaction.sign(other);
  saved.signed_xdr = transaction.toXDR();
  f.context.changedJournal = saved;
  assert.throws(() => f.run('verifySignedRecord(changedJournal)'), /differs from/);
  f.context.localStorage.getItem = () => JSON.stringify(saved);
  assert.throws(() => f.run('readJournal()'), /differs from/);
});

test('a definitive RPC rejection preserves its result without polling', async () => {
  const f = contractPage();
  await f.promise('requestSignature()');
  await f.promise("pending.state='waiting'; requestSignature()");
  f.run('account={address:pending.address}; save()');
  let polls = 0;
  f.context.demoRpc = () => ({
    sendTransaction: async () => ({
      status: 'ERROR',
      errorResult: { result: { type: 'txInsufficientBalance' }, toXdr: () => 'rejection-xdr' },
    }),
    getTransaction: async () => {
      polls++;
      throw Error('Unexpected poll.');
    },
  });
  await f.click('submit');
  assert.equal(f.run('pending.state'), 'failed');
  assert.equal(f.run('pending.result.result_xdr'), 'rejection-xdr');
  assert.equal(polls, 0);
});

test('an RPC error without rejection evidence preserves the unknown submission', async () => {
  const f = contractPage();
  await f.promise('requestSignature()');
  await f.promise("pending.state='waiting'; requestSignature()");
  f.run('account={address:pending.address}; save()');
  let polls = 0;
  f.context.demoRpc = () => ({
    sendTransaction: async () => ({ status: 'ERROR' }),
    getTransaction: async () => {
      polls++;
      throw Error('No transaction evidence.');
    },
  });
  await f.click('submit');
  assert.equal(f.run('pending.state'), 'unknown');
  assert.equal(polls, 1);
  assert.match(f.el('status').textContent, /uncertain/);
});

const reviewSdk = {
  Networks: { TESTNET: 'testnet' },
  Asset: class {},
  TransactionBuilder: {
    fromXDR: () => ({
      source: 'GORIGINAL',
      fee: '100',
      sequence: '2',
      memo: { value: null },
      timeBounds: { minTime: '0', maxTime: '1' },
      operations: [{ type: 'manageData', name: 'walleterm-demo' }],
    }),
  },
};
for (const kind of ['note', 'payment', 'offer', 'cancel_offer'] as const) {
  test(`${kind} keeps transaction details after signing, reopening, and reload`, async () => {
    const sdk = await import('@stellar/stellar-sdk');
    const signer = sdk.Keypair.random(),
      address = signer.publicKey(),
      recipient = sdk.Keypair.random().publicKey();
    const operation =
      kind === 'note'
        ? sdk.Operation.manageData({ name: 'walleterm-demo', value: 'review-note' })
        : kind === 'payment'
          ? sdk.Operation.payment({ destination: recipient, asset: sdk.Asset.native(), amount: '0.01' })
          : sdk.Operation.manageSellOffer({
              selling: sdk.Asset.native(),
              buying: new sdk.Asset('USDC', recipient),
              amount: kind === 'offer' ? '0.1' : '0',
              price: '2',
              offerId: kind === 'offer' ? '0' : '77',
            });
    const tx = new sdk.TransactionBuilder(new sdk.Account(address, '10'), {
      fee: '100',
      networkPassphrase: sdk.Networks.TESTNET,
    })
      .addOperation(operation)
      .addMemo(sdk.Memo.id('42'))
      .setTimeout(180)
      .build();
    const originalXdr = tx.toXDR(),
      hash = Buffer.from(tx.hash()).toString('hex');
    tx.sign(signer);
    const signedXdr = tx.toXDR();
    const expected = {
      source: address,
      fee_stroops: '100',
      sequence: '11',
      memo: '42',
      time_bounds: tx.timeBounds,
      operation:
        kind === 'note'
          ? { type: 'manageData', name: 'walleterm-demo', value: Buffer.from('review-note').toString('hex') }
          : kind === 'payment'
            ? { type: 'payment', destination: recipient, asset: 'XLM', amount: '0.0100000' }
            : {
                type: 'manageSellOffer',
                selling: 'XLM',
                buying: `USDC:${recipient}`,
                amount: kind === 'offer' ? '0.1000000' : '0.0000000',
                price: '2',
                offerId: kind === 'offer' ? '0' : '77',
              },
    };
    let stored: string | null = JSON.stringify({
      kind,
      state: 'review',
      address,
      hash,
      xdr: originalXdr,
      ...(kind === 'payment' ? { recipient } : {}),
    });
    let signs = 0;
    const submissions: string[] = [];
    const extras = {
      StellarSdk: sdk,
      Uint8Array,
      localStorage: {
        getItem: () => stored,
        setItem: (_key: string, value: string) => {
          stored = value;
        },
      },
      client: {
        token: 'mock-session',
        async signTransaction(text: string) {
          signs++;
          assert.equal(text, originalXdr);
          return { signedTxXdr: signedXdr };
        },
      },
      address,
      fetch: async (url: string, options?: RequestInit) => {
        assert.equal(url, 'https://horizon-testnet.stellar.org/transactions');
        assert.equal(options?.method, 'POST');
        submissions.push(new URLSearchParams(String(options?.body)).get('tx')!);
        return ok({ hash, ledger: 1, successful: false });
      },
    };
    const html = readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8');
    const source = app();
    const f = contextFor(html, extras);
    f.run(source);
    f.run('connection.onChange({client, account:{address}})');
    assert.deepEqual(JSON.parse(f.el('details').textContent).transaction, expected);
    assert.equal(f.el('sign').hidden, false);
    assert.equal(f.el('submit').hidden, true);
    await f.click('sign');
    assert.equal(signs, 1);
    assert.equal(f.run('pending.state'), 'signed');
    assert.deepEqual(JSON.parse(f.el('details').textContent).transaction, expected);
    assert.equal(f.el('sign').hidden, true);
    assert.equal(f.el('submit').hidden, false);
    assert.equal(f.el('submit').disabled, false);
    assert.equal(f.el('clear').hidden, false);
    assert.equal(JSON.parse(stored!).xdr, originalXdr);
    assert.equal(JSON.parse(stored!).signed_xdr, signedXdr);
    const saved = stored;
    f.click('close-review');
    f.click('open-review');
    assert.equal(f.el('review').open, true);
    assert.deepEqual(JSON.parse(f.el('details').textContent).transaction, expected);
    assert.equal(stored, saved);
    const restored = contextFor(html, extras);
    restored.run(source);
    assert.equal(restored.run('pending.state'), 'signed');
    assert.equal(restored.el('review').open, true);
    assert.deepEqual(JSON.parse(restored.el('details').textContent).transaction, expected);
    assert.equal(restored.el('sign').hidden, true);
    assert.equal(restored.el('submit').hidden, false);
    assert.equal(restored.el('submit').disabled, false);
    assert.equal(stored, saved);
    assert.equal(signs, 1);
    assert.deepEqual(submissions, []);
    await restored.click('submit');
    assert.deepEqual(submissions, [signedXdr]);
    assert.equal(restored.run('pending.hash'), hash);
    assert.equal(signs, 1);
  });
}
test('signing shows retry progress and stops at the server expiry after the page wakes', async () => {
  let now = Date.now(),
    tick: (() => void) | undefined,
    cleared = false;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    Date: class extends Date {
      static override now() {
        return now;
      }
    },
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      TransactionBuilder: { fromXDR: () => ({ timeBounds: { maxTime: Math.floor(now / 1000) + 180 } }) },
    },
    localStorage: { getItem: () => null, setItem() {} },
    setInterval(fn: () => void) {
      tick = fn;
      return 1;
    },
    clearInterval() {
      cleared = true;
    },
  });
  f.run(app());
  const signing = f.promise(`
    pending={kind:'note', state:'waiting', address:'GORIGINAL', xdr:'mock', hash:'hash'};
    busy=true; actionPhase='signing';
    wallet={signTransaction: (_xdr, options) => new Promise((_resolve,reject) => {
      options.onProgress({state:'retrying', expiresAt:new Date(Date.now()+10000).toISOString()});
      options.signal.addEventListener('abort', () => reject(Object.assign(Error('Timed out'),{canceled:false})),{once:true});
    })};
    requestSignature().catch(() => {});
  `);
  assert.match(f.el('review-progress-state').textContent, /Retrying the same request/);
  assert.equal(f.el('review-status').hidden, true);
  assert.match(f.el('review-countdown').textContent, /10s remaining/);
  const announcement = f.el('review-progress-state').textContent;
  now += 1000;
  assert.ok(tick);
  tick();
  assert.equal(f.el('review-progress-state').textContent, announcement);
  assert.match(f.el('review-countdown').textContent, /9s remaining/);
  now += 10001;
  assert.ok(tick);
  tick();
  await signing;
  assert.equal(f.run('pending.state'), 'signing_unknown');
  assert.equal(f.run('signingController'), null);
  assert.equal(cleared, true);
});
test('wallet changes preserve the original transaction journal and signer', () => {
  for (const state of ['signed', 'unknown', 'signing_unknown']) {
    let stored: string | null | undefined;
    const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: reviewSdk,
      localStorage: {
        getItem: () => null,
        setItem: (_key: string, value: string) => {
          stored = value;
        },
      },
    });
    f.run(app());
    f.run(
      `pending={kind:'note', address:'GORIGINAL', hash:'original-hash', xdr:'original-xdr', signed_xdr:'original-signature', state:'${state}'}; save()`,
    );
    const before = stored;
    f.run("connection.onChange({ client: {token:'same-session'}, account: {address:'GSECOND'} })");
    assert.equal(stored, before);
    assert.equal(f.run('pending.address'), 'GORIGINAL');
    assert.equal(f.run('pending.signed_xdr'), 'original-signature');
    assert.equal(f.run('connectedTo(pending.address)'), false);
  }
});

test('an unknown signing outcome remains distinct from a confirmed cancellation', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      TransactionBuilder: {
        fromXDR: () => ({ timeBounds: { maxTime: Math.floor(Date.now() / 1000) + 180 } }),
      },
    },
    localStorage: { getItem: () => null, setItem() {} },
  });
  f.run(app());
  for (const error of ["{requestState:'unknown'}", '{canceled:false}']) {
    await f.run(
      `pending={kind:'note', state:'waiting', address:'GORIGINAL', xdr:'original', hash:'hash'}; wallet={signTransaction: async () => {throw Object.assign(Error('Stopped'), ${error})}}; requestSignature().catch(() => {})`,
    );
    assert.equal(f.run('pending.state'), 'signing_unknown');
  }
});
test('demo denial and expiry finish the request; unknown submission remains protected after reload', async () => {
  const html = readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8');
  const source = app();
  let stored: string | null | undefined;
  const f = contextFor(html, {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      TransactionBuilder: {
        fromXDR: () => ({ timeBounds: { maxTime: Math.floor(Date.now() / 1000) + 180 } }),
      },
    },
    WalletermClient: class {},
    localStorage: {
      getItem: () => stored || null,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
      removeItem: () => {
        stored = null;
      },
    },
  });
  f.run(source);
  for (const state of ['denied', 'expired']) {
    await f.run(
      `pending = {xdr:'mock', state:'waiting'}; wallet = {token:'mock', signTransaction: async () => {throw Object.assign(Error('${state}'), {requestState:'${state}'})}}; requestSignature().catch(() => {});`,
    );
    f.run('render()');
    assert.equal(f.run('pending.state'), state);
    assert.equal(f.el('clear').hidden, true);
    assert.equal(f.el('check').hidden, true);
  }
  f.run(
    "pending={kind:'note', address:'GSOURCE', xdr:'mock', state:'unknown', hash:'original'}; save(); render();",
  );
  assert.equal(f.el('clear').hidden, true);
  assert.equal(f.el('check').hidden, false);
  const restored = contextFor(html, {
    StellarSdk: { Networks: { TESTNET: 'testnet' } },
    WalletermClient: class {},
    localStorage: { getItem: () => stored, setItem() {}, removeItem() {} },
  });
  restored.run(source);
  assert.equal(restored.run('pending.state'), 'unknown');
  assert.equal(restored.el('clear').hidden, true);
  assert.equal(restored.el('review').open, true);
  const saved = stored;
  restored.click('close-review');
  assert.equal(stored, saved);
  assert.equal(restored.run('pending.state'), 'unknown');
});

test('a reload preserves an open signing request until the user clears it', async () => {
  let stored: string | null = JSON.stringify({
    kind: 'note',
    address: 'GSOURCE',
    hash: 'original',
    state: 'waiting',
    xdr: 'mock',
  });
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' } },
    WalletermClient: class {},
    localStorage: {
      getItem: () => stored,
      setItem() {},
      removeItem: () => {
        stored = null;
      },
    },
  });
  f.run(app());
  assert.equal(f.run('pending.state'), 'waiting');
  assert.ok(stored);
  assert.match(
    f.el('status').textContent,
    /Decline the 1Password prompt if it appears, then clear this record/,
  );
  await f.click('clear');
  assert.equal(f.run('pending'), null);
  assert.equal(stored, null);
  assert.equal(
    f.el('status').textContent,
    'The stopped request was cleared. Decline any 1Password prompt that appears.',
  );
});
test('an unreadable journal blocks new transaction actions', async () => {
  for (const stored of ['{broken', JSON.stringify({ state: 'unknown', kind: 'note' })]) {
    const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: {},
      WalletermClient: class {},
      localStorage: {
        getItem: () => stored,
        setItem: () => {
          throw Error('must not write');
        },
        removeItem: () => {
          throw Error('must not remove');
        },
      },
    });
    f.run(app());
    f.run("account={address:'GSOURCE'}; render()");
    assert.equal(f.el('payment').disabled, true);
    assert.match(f.el('status').textContent, /Preserve it before continuing/);
    await f.click('payment');
    assert.equal(f.run('pending') == null, true);
  }
});
test('a damaged journal still permits disconnect without changing storage', async () => {
  const stored = '{broken';
  let disconnected = false;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {},
    WalletermClient: class {},
    localStorage: {
      getItem: () => stored,
      setItem: () => {
        throw Error('must not write');
      },
      removeItem: () => {
        throw Error('must not remove');
      },
    },
  });
  f.run(app());
  f.context.disconnectMock = async () => {
    disconnected = true;
  };
  f.run("wallet={token:'mock', disconnect:disconnectMock}; account={address:'GSOURCE'}; render()");
  await f.run('connection.client = wallet; connection.disconnect()');
  assert.equal(disconnected, true);
  assert.equal(f.run('account'), null);
  assert.equal(stored, '{broken');
});
test('another tab cannot overwrite an unknown submission', async () => {
  let stored: string | null = null;
  const localStorage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
    removeItem: () => {
      stored = null;
    },
  };
  const html = readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8');
  const source = app();
  const first = contextFor(html, { StellarSdk: {}, WalletermClient: class {}, localStorage });
  const second = contextFor(html, { StellarSdk: {}, WalletermClient: class {}, localStorage });
  first.run(source);
  second.run(source);
  first.run("pending={kind:'note', address:'GSOURCE', xdr:'mock', state:'unknown', hash:'original'}; save()");
  second.run("account={address:'GSOURCE'}; render()");
  await second.click('note');
  const saved: { hash?: string } = JSON.parse(stored ?? 'null');
  assert.equal(saved.hash, 'original');
  assert.equal(second.run('pending.hash'), 'original');
  assert.equal(second.el('note').disabled, true);
  assert.match(second.el('status').textContent, /Another tab changed/);
});

test('demo selects an existing recent testnet account without recipient input', async () => {
  const calls: string[] = [];
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      StrKey: {
        isValidEd25519PublicKey: (value: string) => ['GSOURCE', 'GREMOVED', 'GRECIPIENT'].includes(value),
      },
    },
    WalletermClient: class {},
    localStorage: { getItem: () => null },
    fetch: async (url: string) => {
      calls.push(url);
      if (url.includes('/operations?'))
        return ok({
          _embedded: {
            records: [
              { source_account: 'GSOURCE' },
              { source_account: 'bad' },
              { source_account: 'GREMOVED' },
              { source_account: 'GRECIPIENT' },
            ],
          },
        });
      if (url.endsWith('/GREMOVED'))
        return { ok: false, status: 404, json: async () => ({ detail: 'Account missing' }) };
      return ok({ account_id: 'GRECIPIENT' });
    },
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}");
  assert.equal(await f.run('paymentRecipient()'), 'GRECIPIENT');
  assert.equal(f.elements.has('recipient'), false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((url) => url.startsWith('https://horizon-testnet.stellar.org/')));
});

test('recipient lookup reports failure without choosing an unchecked account', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { StrKey: { isValidEd25519PublicKey: () => true } },
    WalletermClient: class {},
    localStorage: { getItem: () => null },
    fetch: async (url: string) =>
      url.includes('/operations?')
        ? ok({ _embedded: { records: [{ source_account: 'GCANDIDATE' }] } })
        : { ok: false, status: 503, json: async () => ({ detail: 'Horizon unavailable' }) },
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}");
  await assert.rejects(f.promise('paymentRecipient()'), /Horizon unavailable/);
});

test('demo funds a missing testnet account once with Friendbot', async () => {
  const calls: string[] = [];
  let funded = false;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {},
    WalletermClient: class {},
    localStorage: { getItem: () => null },
    fetch: async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://friendbot.stellar.org/')) {
        funded = true;
        return ok({});
      }
      return funded
        ? ok({ account_id: 'GNEW', sequence: '1' })
        : { ok: false, status: 404, json: async () => ({ detail: 'Account missing' }) };
    },
  });
  f.run(app());
  f.run("account={address:'GNEW'}");
  assert.equal(await f.run('sourceAccount().then(account => account.sequence)'), '1');
  assert.deepEqual(calls, [
    'https://horizon-testnet.stellar.org/accounts/GNEW',
    'https://friendbot.stellar.org/?addr=GNEW',
    'https://horizon-testnet.stellar.org/accounts/GNEW',
  ]);
});

test('demo reports a Friendbot failure and does not hide Horizon errors', async () => {
  const run = async (responses: unknown[]) => {
    const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: {},
      WalletermClient: class {},
      localStorage: { getItem: () => null },
      fetch: async () => responses.shift(),
    });
    f.run(app());
    f.run("account={address:'GNEW'}");
    return f.run('sourceAccount()');
  };
  const missing = () => ({ ok: false, status: 404, json: async () => ({ detail: 'Account missing' }) });
  await assert.rejects(
    run([missing(), { ok: false, status: 400, json: async () => ({}) }, missing()]),
    /Friendbot could not fund/,
  );
  await assert.rejects(
    run([{ ok: false, status: 503, json: async () => ({ detail: 'Horizon unavailable' }) }]),
    /Horizon unavailable/,
  );
});

test('an unknown submission expires only after a ledger closes past its time bound', async () => {
  const maxTime = 1_800_000_000;
  const order: string[] = [];
  const make = (closed: number) => {
    let stored: string | null = null;
    return contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: {
        Networks: { TESTNET: 'testnet' },
        TransactionBuilder: { fromXDR: () => ({ sequence: '11', timeBounds: { maxTime: String(maxTime) } }) },
      },
      WalletermClient: class {},
      localStorage: {
        getItem: () => stored,
        setItem: (_key: string, value: string) => {
          stored = value;
        },
        removeItem: () => {
          stored = null;
        },
      },
      fetch: async (url: string) => {
        order.push(url.includes('/ledgers?') ? 'ledger' : url.includes('/accounts/') ? 'account' : 'hash');
        if (url.includes('/ledgers?'))
          return ok({ _embedded: { records: [{ closed_at: new Date(closed * 1000).toISOString() }] } });
        if (url.includes('/accounts/')) return ok({ sequence: accountSequence });
        return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) };
      },
    });
  };
  let accountSequence: string | undefined;
  for (const [closed, sequence, state] of [
    [maxTime + 5, '10', 'expired'],
    [maxTime - 5, '10', 'unknown'],
    [maxTime + 5, '11', 'unknown'],
  ] as const) {
    accountSequence = sequence;
    const f = make(closed);
    f.run(app());
    f.run("pending={kind:'note', state:'unknown', hash:'original', xdr:'mock', address:'GSOURCE'}; save()");
    await f.click('check');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.run('pending.state'), state);
  }
  assert.deepEqual(order.slice(0, 3), ['ledger', 'hash', 'account']);
});

test('a storage failure before signing leaves the demo usable', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      Account: class {},
      Operation: { manageData: () => ({}) },
      TransactionBuilder: class {
        addOperation() {
          return this;
        }
        setTimeout() {
          return this;
        }
        build() {
          return { toXDR: () => 'mock', hash: () => [1] };
        }
        static fromXDR() {
          return {
            source: 'GSOURCE',
            fee: '100',
            sequence: '2',
            memo: { value: null },
            timeBounds: { minTime: '0', maxTime: '1' },
            operations: [{ type: 'manageData', name: 'walleterm-demo' }],
          };
        }
      },
    },
    WalletermClient: class {},
    crypto: { randomUUID: () => 'id-0000000000000000' },
    localStorage: {
      getItem: () => null,
      setItem() {
        throw Error('Quota');
      },
      removeItem() {},
    },
    fetch: async () => ok({ account_id: 'GSOURCE', sequence: '1' }),
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}; wallet={}");
  await assert.rejects(f.promise("build('note')"), /could not store/);
  assert.equal(f.run('pending'), null);
});

test('cancel removes the newest open offer from Horizon', async () => {
  interface OfferOptions {
    offerId?: string;
    amount?: string;
    buying?: { code?: string };
    selling?: unknown;
  }
  let built: OfferOptions | undefined;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      Account: class {},
      Asset: class {
        code: string;
        issuer: string;
        constructor(code: string, issuer: string) {
          this.code = code;
          this.issuer = issuer;
        }
        static native() {
          return 'XLM';
        }
      },
      Operation: {
        manageSellOffer: (options: OfferOptions) => {
          built = options;
          return {};
        },
      },
      TransactionBuilder: class {
        addOperation() {
          return this;
        }
        setTimeout() {
          return this;
        }
        build() {
          return { toXDR: () => 'mock', hash: () => [1] };
        }
        static fromXDR() {
          return {
            source: 'GSOURCE',
            fee: '100',
            sequence: '2',
            memo: { value: null },
            timeBounds: { minTime: '0', maxTime: '1' },
            operations: [{ type: 'manageData', name: 'walleterm-demo' }],
          };
        }
      },
    },
    WalletermClient: class {},
    crypto: { randomUUID: () => 'id-0000000000000000' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url: string) =>
      url.includes('/offers?')
        ? ok({
            _embedded: {
              records: [
                {
                  id: '77',
                  selling: { asset_type: 'native' },
                  buying: { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GISSUER' },
                  price_r: { n: 10, d: 1 },
                },
              ],
            },
          })
        : ok({ account_id: 'GSOURCE', sequence: '1' }),
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}; wallet={signTransaction: () => new Promise(() => {})}");
  f.run("build('cancel_offer')");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(built);
  assert.equal(built.offerId, '77');
  assert.equal(built.amount, '0');
  assert.equal(built.buying?.code, 'USDC');
  assert.equal(built.selling, 'XLM');
});

test('a built transaction waits for Sign before it is signed', async () => {
  const storage: {
    value: string | null;
    getItem(): string | null;
    setItem(_key: string, value: string): void;
    removeItem(): void;
  } = {
    value: null,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
    removeItem() {
      this.value = null;
    },
  };
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      Account: class {},
      Asset: class {},
      Operation: { manageData: () => ({}) },
      TransactionBuilder: class {
        addOperation() {
          return this;
        }
        setTimeout() {
          return this;
        }
        build() {
          return { toXDR: () => 'mock', hash: () => [1] };
        }
        static fromXDR() {
          return {
            source: 'GSOURCE',
            fee: '100',
            sequence: '2',
            memo: { value: null },
            timeBounds: { minTime: '0', maxTime: '1' },
            operations: [{ type: 'manageData', name: 'walleterm-demo' }],
          };
        }
      },
    },
    WalletermClient: class {},
    crypto: { randomUUID: () => 'id-0000000000000000' },
    navigator: { locks: { request: async (_name: string, fn: () => unknown) => fn() } },
    localStorage: storage,
    fetch: async () => ok({ account_id: 'GSOURCE', sequence: '1' }),
  });
  f.run(app());
  f.run(
    "account={address:'GSOURCE'}; signs=0; wallet={token:'mock', signTransaction: async () => { signs++; return new Promise(() => {}); }}",
  );
  await f.click('note');
  f.run('render()');
  assert.equal(f.el('review').open, true);
  const record = f.run('JSON.stringify(pending)');
  f.click('close-review');
  assert.equal(f.el('review').open, false);
  assert.equal(f.run('JSON.stringify(pending)'), record);
  assert.equal(f.el('transaction-record').hidden, false);
  f.click('open-review');
  assert.equal(f.el('review').open, true);
  assert.equal(f.run('pending.state'), 'review');
  assert.equal(f.run('signs'), 0);
  assert.equal(f.el('sign').hidden, false);
  assert.equal(f.el('sign').disabled, false);
  assert.equal(f.el('clear').textContent, 'Discard');
  assert.match(f.el('details').textContent, /"name": "walleterm-demo"/);
  f.run('wallet.token=null; render()');
  assert.equal(f.el('sign').disabled, true);
  f.run("wallet.token='mock'; render()");
  f.click('sign');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.run('signs'), 1);
  assert.equal(f.run('pending.state'), 'waiting');
});

test('a saved review with invalid XDR blocks actions without breaking the page', () => {
  const stored = JSON.stringify({
    state: 'review',
    kind: 'note',
    address: 'GSOURCE',
    hash: 'h',
    xdr: 'broken',
  });
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      TransactionBuilder: {
        fromXDR: () => {
          throw Error('bad XDR');
        },
      },
    },
    WalletermClient: class {},
    localStorage: { getItem: () => stored, setItem() {}, removeItem() {} },
  });
  f.run(app());
  assert.equal(f.run('journalBlocked'), true);
  assert.equal(f.run('busy'), false);
  assert.match(f.el('status').textContent, /could not be read/);
});

test('the action modal opens before account lookup and keeps preparation errors visible', async () => {
  let fail: ((error: unknown) => void) | undefined;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {},
    localStorage: { getItem: () => null },
    fetch: () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}; wallet={token:'mock'}");
  const creating = f.click('payment');
  assert.equal(f.el('review').open, true);
  assert.equal(f.el('review-title').textContent, 'Pay 0.01 test XLM');
  assert.match(f.el('review-status').textContent, /Preparing/);
  assert.equal(f.el('sign').hidden, true);
  // A page fetch rejects with a page-realm error.
  assert.ok(fail);
  fail(f.run("Error('Horizon unavailable')"));
  await creating;
  assert.equal(f.el('review').open, true);
  assert.equal(f.el('review-status').textContent, 'Horizon unavailable');
  assert.equal(f.run('pending'), null);
  assert.equal(f.el('transaction-details').hidden, true);
  assert.equal(f.el('sign').hidden, true);
});

test('connection work disables demo actions and signing without changing the journal', () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: reviewSdk,
    localStorage: { getItem: () => null },
  });
  f.run(app());
  f.run("wallet={token:'mock'}; account={address:'GTEST'}; connection.working=true; render()");
  for (const name of ['note', 'payment', 'offer', 'cancel-offer']) assert.equal(f.el(name).disabled, true);
  f.run("pending={state:'signed',kind:'note',address:'GTEST',xdr:'unsigned',signed_xdr:'signed'}; render()");
  assert.equal(f.el('submit').disabled, true);
  assert.equal(f.el('clear').disabled, true);
  f.run('connection.working=false; render()');
  assert.equal(f.el('submit').disabled, false);
  assert.equal(f.run('pending.state'), 'signed');
});

test('only an active request shows progress; stopped signing cannot be canceled again', () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {},
    localStorage: { getItem: () => null },
  });
  f.run(app());
  f.run("pending={kind:'note',state:'waiting',address:'GTEST'}; render()");
  assert.equal(f.el('cancel-request').hidden, true);
  assert.equal(f.el('review-progress').hidden, true);
  f.run("busy=true; actionPhase='signing'; signingController=new AbortController(); render()");
  assert.equal(f.el('cancel-request').disabled, false);
  assert.equal(f.el('review-progress').hidden, false);
  f.click('cancel-request');
  assert.equal(f.el('cancel-request').disabled, true);
  assert.match(f.el('review-progress-state').textContent, /Canceling/);
  f.run("busy=false; pending.state='signing_unknown'; signingController=null; render()");
  assert.equal(f.el('review-progress').hidden, true);
  f.run("busy=true; pending.state='submitting'; actionPhase='submitting'; render()");
  assert.equal(f.el('check').hidden, true);
  f.run("pending.state='unknown'; actionPhase='checking'; render()");
  assert.equal(f.el('check').hidden, false);
  assert.equal(f.el('check').disabled, true);
  assert.equal(f.el('check').textContent, 'Checking…');
});

async function completedFixture(state = 'submitted') {
  const sdk = await import('@stellar/stellar-sdk');
  const original = sdk.Keypair.random().publicKey(),
    next = sdk.Keypair.random().publicKey();
  const tx = new sdk.TransactionBuilder(new sdk.Account(original, '1'), {
    fee: '100',
    networkPassphrase: sdk.Networks.TESTNET,
  })
    .addOperation(sdk.Operation.manageData({ name: 'previous', value: 'done' }))
    .setTimeout(180)
    .build();
  const previous = {
    kind: 'note',
    state,
    address: original,
    hash: Buffer.from(tx.hash()).toString('hex'),
    xdr: tx.toXDR(),
    result: { successful: true },
  };
  const store = {
    value: JSON.stringify(previous) as string | null,
    getItem() {
      return this.value;
    },
    setItem(_key: string, value: string) {
      this.value = value;
    },
    removeItem() {
      this.value = null;
    },
  };
  const events: { hash: string; state: string }[] = [];
  let reads = 0,
    signs = 0;
  const client = {
    token: 'mock-session',
    signTransaction() {
      signs++;
    },
  };
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: sdk,
    crypto: globalThis.crypto,
    localStorage: store,
    client,
    next,
    fetch: async () => {
      reads++;
      return ok({ sequence: '10' });
    },
    createActivityLog: () => ({
      record() {},
      transaction(value: { hash: string; state: string } | null) {
        if (value) events.push(JSON.parse(JSON.stringify(value)));
      },
      wrapFetch: (fetcher: unknown) => fetcher,
    }),
  });
  f.run(app());
  f.run('connection.onChange({client, account:{address:next}})');
  return { ...f, store, events, previous, next, reads: () => reads, signs: () => signs };
}

test('completed transactions permit another action after wallet switching without a separate clear step', async () => {
  for (const state of ['submitted', 'canceled', 'denied', 'expired', 'failed']) {
    const f = await completedFixture(state);
    for (const name of ['note', 'payment', 'offer', 'cancel-offer'])
      assert.equal(f.el(name).disabled, false, state);
    assert.equal(f.el('clear').hidden, true);
    assert.equal(f.el('check').hidden, true, state);
    assert.equal(f.el('review').open, false);
    assert.equal(f.el('transaction-record').hidden, false);
    f.click('open-review');
    assert.equal(f.el('review').open, true);
    f.click('close-review');
    await f.click('note');
    assert.equal(f.run('pending.state'), 'review');
    assert.equal(f.run('pending.address'), f.next);
    assert.notEqual(f.run('pending.hash'), f.previous.hash);
    assert.equal(JSON.parse(f.store.value ?? 'null').address, f.next);
    assert.ok(f.events.some((event) => event.hash === f.previous.hash && event.state === state));
    assert.equal(f.signs(), 0);
    assert.equal(f.reads(), 1);
  }
});

test('unfinished transactions still prevent replacement after wallet switching', async () => {
  for (const state of ['review', 'signed', 'waiting', 'signing_unknown', 'submitting', 'unknown']) {
    const f = await completedFixture(state),
      before = f.store.value;
    const needsStatusCheck = ['submitting', 'unknown'].includes(state);
    assert.equal(f.el('check').hidden, !needsStatusCheck, state);
    if (needsStatusCheck) {
      assert.equal(f.el('check').textContent, 'Check transaction status');
      assert.equal(
        f.el('review-note').textContent,
        'We could not confirm the result. Check before trying another transaction.',
      );
    }
    for (const name of ['note', 'payment', 'offer', 'cancel-offer'])
      assert.equal(f.el(name).disabled, true, state);
    await f.click('note');
    assert.equal(f.store.value, before);
    assert.equal(f.run('pending.hash'), f.previous.hash);
    assert.equal(f.reads(), 0);
    assert.equal(f.signs(), 0);
  }
});

test('another tab changing a completed record prevents its automatic replacement', async () => {
  const f = await completedFixture();
  const changed = JSON.stringify({ ...f.previous, state: 'unknown' });
  f.context.navigator.locks.request = async (_name: string, fn: () => unknown) => {
    f.store.value = changed;
    return fn();
  };
  await f.click('note');
  assert.equal(f.store.value, changed);
  assert.equal(f.run('pending.state'), 'unknown');
  assert.equal(f.reads(), 0);
  assert.equal(f.signs(), 0);
  assert.match(f.el('status').textContent, /Another tab changed/);
});

test('a storage failure preserves the completed record and prevents a new build', async () => {
  const f = await completedFixture(),
    before = f.store.value;
  f.store.removeItem = () => {
    throw Error('Storage unavailable');
  };
  await f.click('note');
  assert.equal(f.store.value, before);
  assert.equal(f.run('pending.hash'), f.previous.hash);
  assert.equal(f.reads(), 0);
  assert.equal(f.signs(), 0);
  assert.match(f.el('status').textContent, /Storage unavailable/);
});

async function confirmationFixture(
  state: 'signed' | 'unknown' | 'submitting',
  response: (hash: string) => unknown,
  kind: 'note' | 'offer' = 'note',
) {
  const sdk = await import('@stellar/stellar-sdk');
  const signer = sdk.Keypair.random(),
    address = signer.publicKey();
  const tx = new sdk.TransactionBuilder(new sdk.Account(address, '1'), {
    fee: '100',
    networkPassphrase: sdk.Networks.TESTNET,
  })
    .addOperation(
      kind === 'note'
        ? sdk.Operation.manageData({ name: 'confirmation', value: 'test' })
        : sdk.Operation.manageSellOffer({
            selling: sdk.Asset.native(),
            buying: new sdk.Asset('USDC', address),
            amount: '0.1',
            price: '2',
            offerId: '0',
          }),
    )
    .setTimeout(180)
    .build();
  const hash = Buffer.from(tx.hash()).toString('hex'),
    xdr = tx.toXDR();
  tx.sign(signer);
  const original = { kind, state, address, hash, xdr, signed_xdr: tx.toXDR() };
  const writes: { state: string; result?: unknown }[] = [];
  const store = {
    value: JSON.stringify(original) as string | null,
    getItem() {
      return this.value;
    },
    setItem(_key: string, value: string) {
      this.value = value;
      writes.push(JSON.parse(value));
    },
  };
  const requests: { url: string; method: string; body?: BodyInit | null }[] = [];
  let signs = 0;
  const extras = {
    StellarSdk: sdk,
    Uint8Array,
    localStorage: store,
    client: {
      token: 'mock-session',
      signTransaction() {
        signs++;
        throw Error('Confirmation must not sign.');
      },
    },
    address,
    fetch: async (url: string, options?: RequestInit) => {
      requests.push({ url, method: options?.method || 'GET', body: options?.body });
      if (url === 'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1')
        return ok({ _embedded: { records: [{ closed_at: new Date().toISOString() }] } });
      assert.equal(
        url,
        `https://horizon-testnet.stellar.org/transactions${options?.method === 'POST' ? '' : `/${hash}`}`,
      );
      return ok(response(hash));
    },
  };
  const html = readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'),
    source = app();
  const load = () => {
    const f = contextFor(html, extras);
    f.run(source);
    f.run('connection.onChange({client, account:{address}})');
    return f;
  };
  return { ...load(), load, store, writes, requests, original, signs: () => signs };
}

const invalidConfirmations: [string, (hash: string) => unknown][] = [
  ['empty object', () => ({})],
  ['null', () => null],
  ['primitive', () => 'invalid'],
  ['array', (hash) => Object.assign([], { hash, ledger: 1, successful: true })],
];
for (const [field, values] of [
  ['hash', [undefined, null, 1, '', 'another-hash']],
  ['ledger', [undefined, null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]],
  ['successful', [undefined, null, 'true', 'false', 0, 1]],
] as const) {
  for (const value of values)
    invalidConfirmations.push([
      `${field}=${String(value)}`,
      (hash) => ({ hash, ledger: 1, successful: true, [field]: value }),
    ]);
}

for (const state of ['signed', 'unknown', 'submitting'] as const) {
  const button = state === 'signed' ? 'submit' : 'check';
  for (const [label, response] of invalidConfirmations) {
    test(`${button} from ${state} preserves the original transaction for ${label}`, async () => {
      const f = await confirmationFixture(state, response),
        before = f.store.value;
      await f.click(button);
      const unresolved = state === 'signed' ? 'unknown' : state;
      const record = JSON.parse(f.store.value!);
      assert.deepEqual(record, { ...f.original, state: unresolved });
      assert.equal(f.run('pending.state'), unresolved);
      assert.equal(f.run('pending.result'), undefined);
      assert.deepEqual(
        f.writes.map((write) => write.state),
        state === 'signed' ? ['submitting', 'unknown'] : [],
      );
      if (state !== 'signed') assert.equal(f.store.value, before);
      assert.equal(f.signs(), 0);
      assert.equal(
        f.requests.filter((request) => request.method === 'POST').length,
        state === 'signed' ? 1 : 0,
      );
      if (state === 'signed')
        assert.equal(new URLSearchParams(String(f.requests[0]!.body)).get('tx'), f.original.signed_xdr);
      const restored = f.load();
      assert.equal(restored.run('pending.hash'), f.original.hash);
      assert.equal(restored.run('pending.state'), unresolved);
      assert.equal(restored.el('check').hidden, false);
      assert.equal(restored.el('clear').hidden, true);
      for (const name of ['note', 'payment', 'offer', 'cancel-offer'])
        assert.equal(restored.el(name).disabled, true);
      const saved = f.store.value,
        requestCount = f.requests.length;
      await restored.click('note');
      assert.equal(f.store.value, saved);
      assert.equal(f.requests.length, requestCount);
      assert.equal(f.signs(), 0);
    });
  }
  for (const successful of [true, false]) {
    test(`${button} from ${state} accepts the original on-ledger ${successful ? 'success' : 'failure'}`, async () => {
      const f = await confirmationFixture(state, (hash) => ({ hash, ledger: 1, successful }));
      await f.click(button);
      assert.deepEqual(JSON.parse(f.store.value!), {
        ...f.original,
        state: successful ? 'submitted' : 'failed',
        result: { hash: f.original.hash, ledger: 1, successful },
      });
      assert.equal(f.el('check').hidden, true);
      assert.equal(f.el('note').disabled, false);
      assert.equal(f.signs(), 0);
    });
  }
}

test('an invalid submission response recovers only through the original hash', async () => {
  let valid = false;
  const f = await confirmationFixture('signed', (hash) => ({
    hash: valid ? hash : 'another-hash',
    ledger: 1,
    successful: true,
  }));
  await f.click('submit');
  assert.equal(f.run('pending.state'), 'unknown');
  valid = true;
  const restored = f.load();
  await restored.click('check');
  assert.equal(restored.run('pending.state'), 'submitted');
  assert.equal(restored.run('pending.hash'), f.original.hash);
  assert.deepEqual(
    f.requests.map(({ method, url }) => [method, url]),
    [
      ['POST', 'https://horizon-testnet.stellar.org/transactions'],
      ['GET', 'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1'],
      ['GET', `https://horizon-testnet.stellar.org/transactions/${f.original.hash}`],
    ],
  );
  assert.equal(f.signs(), 0);
});

for (const state of ['signed', 'unknown'] as const) {
  const button = state === 'signed' ? 'submit' : 'check';
  test(`${button} keeps an offer confirmed when optional offer decoding fails`, async () => {
    for (const result_xdr of [undefined, null, 1, '', 'invalid-xdr']) {
      const f = await confirmationFixture(
        state,
        (hash) => ({ hash, ledger: 1, successful: true, result_xdr }),
        'offer',
      );
      await f.click(button);
      assert.equal(f.run('pending.state'), 'submitted');
      assert.deepEqual(JSON.parse(f.store.value!).result, {
        hash: f.original.hash,
        ledger: 1,
        successful: true,
      });
      assert.match(f.el('status').textContent, /succeeded.*Offer details are unavailable/);
      assert.equal(f.el('note').disabled, false);
      assert.equal(f.signs(), 0);
    }
  });
  test(`${button} still decodes a valid offer result without a resting offer`, async () => {
    const { xdr } = await import('@stellar/stellar-sdk');
    const result_xdr = new xdr.TransactionResult({
      feeCharged: 100n,
      result: xdr.TransactionResultResult.txSuccess([
        xdr.OperationResult.opInner(
          xdr.OperationResultTr.manageSellOffer(
            xdr.ManageSellOfferResult.manageSellOfferSuccess(
              new xdr.ManageOfferSuccessResult({
                offersClaimed: [],
                offer: xdr.ManageOfferSuccessResultOffer.manageOfferDeleted(),
              }),
            ),
          ),
        ),
      ]),
      ext: xdr.TransactionResultExt.v0(),
    }).toXDR('base64');
    const f = await confirmationFixture(
      state,
      (hash) => ({ hash, ledger: 1, successful: true, result_xdr }),
      'offer',
    );
    await f.click(button);
    assert.equal(f.run('pending.state'), 'submitted');
    assert.equal(JSON.parse(f.store.value!).result.hash, f.original.hash);
    assert.match(f.el('status').textContent, /succeeded without a resting offer/);
    assert.equal(f.signs(), 0);
  });
}

test('submission transport errors and tx_bad_seq still preserve uncertainty without retrying', async () => {
  for (const error of ['invalid JSON', 'HTTP 504', 'tx_bad_seq']) {
    const f = await confirmationFixture('signed', () => ({}));
    let calls = 0;
    f.context.fetch = async (_url: string, options: RequestInit) => {
      calls++;
      assert.equal(options.method, 'POST');
      assert.equal(new URLSearchParams(String(options.body)).get('tx'), f.original.signed_xdr);
      if (error === 'invalid JSON')
        return {
          ok: true,
          json: async () => {
            throw SyntaxError('Invalid JSON');
          },
        };
      return {
        ok: false,
        status: error === 'HTTP 504' ? 504 : 400,
        json: async () => ({
          detail: error,
          extras: { result_codes: { transaction: 'tx_bad_seq' }, result_xdr: 'mock' },
        }),
      };
    };
    await f.click('submit');
    assert.deepEqual(JSON.parse(f.store.value!), { ...f.original, state: 'unknown' });
    assert.equal(f.el('check').hidden, false);
    assert.equal(f.el('note').disabled, true);
    assert.equal(calls, 1);
    assert.equal(f.signs(), 0);
  }
});
