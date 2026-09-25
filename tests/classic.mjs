import assert from 'node:assert/strict';

// Live entry point only. Importing this module never opens a socket or submits a transaction.
export async function runClassic(ctx) {
  const { sdk, networkPassphrase, rpc, horizon, keys, record } = ctx;
  assert.equal(networkPassphrase, sdk.Networks.TESTNET, 'Classic acceptance requires testnet');
  const names = ['a', 'b', 'c'];
  assert.equal(new Set(names.map(name => keys[name].publicKey)).size, 3);
  const hex = bytes => Buffer.from(bytes).toString('hex');
  const stroops = value => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 10000000n + BigInt(fraction.padEnd(7, '0'));
  };
  const native = account => account.balances.find(balance => balance.asset_type === 'native').balance;
  const floors = new Map();
  const pause = () => new Promise(resolve => setTimeout(resolve, 1000));
  let active;

  async function state(name) {
    const deadline = Date.now() + 45000;
    do {
      const account = await horizon.loadAccount(keys[name].publicKey);
      if (Number(account.last_modified_ledger) >= (floors.get(name) ?? 0)) {
        return {
          address: keys[name].publicKey, sequence: account.sequence,
          ledger: account.last_modified_ledger, native: native(account),
          thresholds: account.thresholds,
          signers: account.signers.map(({ key, weight, type }) => ({ key, weight, type }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        };
      }
      await pause();
    } while (Date.now() < deadline);
    throw new Error(`Horizon did not reach the required ledger for account ${name}`);
  }
  async function snapshot() {
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await state(name)])));
  }
  function check(description, actual, expected) {
    active.assertions.push({ description, actual, expected });
    assert.deepEqual(actual, expected, description);
  }
  async function scenario(id, action) {
    active = { assertions: [], transactions: [], before: await snapshot() };
    try {
      await action();
      active.after = await snapshot();
      record(id, 'passed', active);
    } catch (error) {
      record(id, error.code === 'unknown_submission' ? 'blocked' : 'failed', { ...active, error: String(error), hash: error.hash });
      throw error;
    }
  }
  const payment = (destination, amount = '0.0000100', source) => sdk.Operation.payment({
    destination: keys[destination].publicKey, asset: sdk.Asset.native(), amount,
    ...(source ? { source: keys[source].publicKey } : {}),
  });
  async function build(source, operations, { sequence, network = networkPassphrase, expired = false, memo } = {}) {
    const account = await rpc.getAccount(keys[source].publicKey);
    const tx = new sdk.TransactionBuilder(new sdk.Account(account.accountId(), sequence ?? account.sequenceNumber()), {
      fee: '1000', networkPassphrase: network,
      ...(expired ? { timebounds: { minTime: '0', maxTime: '1' } } : {}),
    });
    for (const operation of operations) tx.addOperation(operation);
    if (memo) tx.addMemo(sdk.Memo.text(memo));
    if (!expired) tx.setTimeout(900);
    return tx.build();
  }
  function prepared(label, tx, signerNames, extra = {}) {
    const details = {
      label, networkPassphrase, unsigned_xdr: tx.toXDR(), digest: hex(tx.hash()),
      signers: signerNames.map(name => keys[name].publicKey), simulation: 'not_applicable_classic', ...extra,
    };
    active.transactions.push(details);
    record(`${label}.prepared`, 'prepared', details);
    return details;
  }
  async function authorize(label, tx, signerNames, extra) {
    const details = prepared(label, tx, signerNames, extra);
    for (const name of signerNames) await ctx.sign(tx, keys[name]);
    details.signature_verification = 'ctx.sign verifies each signature';
    return tx;
  }
  function resultDetails(outcome) {
    const result = outcome.result.resultXdr ?? outcome.sent.errorResult;
    assert.ok(result?.result?.type, 'A protocol result is required');
    const union = result.result;
    return {
      code: union.type,
      innerCode: union.type.startsWith('txFeeBumpInner') ? union.value.result.result.type : undefined,
      operationCodes: union.type === 'txFailed' ? union.value.map(op => op.type === 'opInner' ? op.value.value.type : op.type) : undefined,
      feeCharged: result.feeCharged.toString(), result_xdr: result.toXdr('base64'),
    };
  }
  function touched(tx) {
    const inner = tx instanceof sdk.FeeBumpTransaction ? tx.innerTransaction : tx;
    return new Set([
      inner.source, ...(tx instanceof sdk.FeeBumpTransaction ? [tx.feeSource] : []),
      ...inner.operations.flatMap(op => [op.source ?? inner.source, op.destination].filter(Boolean)),
    ]);
  }
  async function submit(label, tx, expectedCode = 'txSuccess', expectedInner) {
    const expectFailure = !['txSuccess', 'txFeeBumpInnerSuccess'].includes(expectedCode);
    const outcome = await ctx.send(tx, label, { expectFailure });
    const details = { label, hash: hex(tx.hash()), status: outcome.status, ledger: outcome.ledger, ...resultDetails(outcome) };
    active.transactions.push(details);
    check(`${label}: transaction result`, details.code, expectedCode);
    if (expectedInner) check(`${label}: inner result`, details.innerCode, expectedInner);
    if (outcome.ledger) {
      // A failed transaction can still charge its source and consume its sequence.
      const changed = expectFailure
        ? new Set([tx instanceof sdk.FeeBumpTransaction ? tx.feeSource : tx.source]) : touched(tx);
      for (const name of names) if (changed.has(keys[name].publicKey)) floors.set(name, outcome.ledger);
    }
    return details;
  }
  async function transfer(label, source, destination, signers, expected = 'txSuccess', operations) {
    const tx = await build(source, operations ?? [payment(destination)]);
    await authorize(label, tx, signers);
    return submit(label, tx, expected);
  }
  function weight(account, name) {
    return account.signers.find(signer => signer.key === keys[name].publicKey)?.weight ?? 0;
  }
  async function configure(label, weights, threshold, signers) {
    const prior = await state('b');
    const operations = [sdk.Operation.setOptions({
      masterWeight: weights.b, lowThreshold: threshold, medThreshold: threshold, highThreshold: threshold,
    }), ...['a', 'c'].filter(name => weights[name] || weight(prior, name)).map(name => sdk.Operation.setOptions({
      signer: { ed25519PublicKey: keys[name].publicKey, weight: weights[name] },
    }))];
    const tx = await build('b', operations);
    await authorize(label, tx, signers);
    await submit(label, tx);
    const current = await state('b');
    for (const name of names) check(`${label}: ${name} weight`, weight(current, name), weights[name]);
    check(`${label}: thresholds`, current.thresholds,
      { low_threshold: threshold, med_threshold: threshold, high_threshold: threshold });
  }

  const initial = await snapshot();
  for (const name of names) {
    assert.deepEqual(initial[name].signers, [{ key: keys[name].publicKey, weight: 1, type: 'ed25519_public_key' }],
      `Account ${name} must begin with its fresh master key only`);
    assert.ok(stroops(initial[name].native) > 100000000n, `Account ${name} needs at least 10 XLM`);
  }
  const originalB = initial.b;
  async function restoreB(label) {
    ctx.assertClear?.();
    const current = await state('b');
    if (JSON.stringify(current.signers) === JSON.stringify(originalB.signers) &&
        JSON.stringify(current.thresholds) === JSON.stringify(originalB.thresholds)) return;
    active = { assertions: [], transactions: [], before: { b: current } };
    try {
      const needed = Math.max(1, current.thresholds.low_threshold, current.thresholds.high_threshold);
      const signers = [];
      let total = 0;
      for (const name of ['b', 'a', 'c']) {
        if (weight(current, name) > 0 && total < needed) { signers.push(name); total += weight(current, name); }
      }
      assert.ok(total >= needed, 'Known keys cannot restore B');
      const tx = await build('b', [sdk.Operation.setOptions({ masterWeight: 1,
        lowThreshold: originalB.thresholds.low_threshold, medThreshold: originalB.thresholds.med_threshold,
        highThreshold: originalB.thresholds.high_threshold,
      }), ...['a', 'c'].filter(name => weight(current, name)).map(name => sdk.Operation.setOptions({
        signer: { ed25519PublicKey: keys[name].publicKey, weight: 0 },
      }))]);
      await authorize(label, tx, signers);
      await submit(label, tx);
      const after = await state('b');
      check('B signers restored', after.signers, originalB.signers);
      check('B thresholds restored', after.thresholds, originalB.thresholds);
      record(label, 'passed', { ...active, after });
    } catch (error) {
      record(label, error.code === 'unknown_submission' ? 'blocked' : 'failed', { ...active, hash: error.hash, error: String(error), recovery: error.code === 'unknown_submission' ? 'Reconcile the original hash before any restoration.' : 'Stop. Restore B with the listed authorized test keys.' });
      throw error;
    }
  }

  await scenario('G01', async () => {
    const before = await state('c');
    await transfer('G01-payment', 'a', 'c', ['a']);
    check('Recipient gained exactly 100 stroops', (stroops((await state('c')).native) - stroops(before.native)).toString(), '100');
  });
  try {
    await scenario('G02', async () => {
      await configure('G02-configure', { a: 1, b: 1, c: 1 }, 2, ['b']);
      const before = await state('c');
      await transfer('G02-one-signature', 'b', 'c', ['b'], 'txBadAuth');
      check('Insufficient signatures moved no recipient funds', (await state('c')).native, before.native);
      await transfer('G02-two-signatures', 'b', 'c', ['b', 'a']);
      check('Two signatures paid 100 stroops', (stroops((await state('c')).native) - stroops(before.native)).toString(), '100');
    });
    await scenario('G03', async () => {
      await configure('G03-configure', { a: 2, b: 1, c: 1 }, 3, ['b', 'a']);
      await transfer('G03-weight-two', 'b', 'c', ['a'], 'txBadAuth');
      await transfer('G03-two-light-signers', 'b', 'c', ['b', 'c'], 'txBadAuth');
      await transfer('G03-weight-three', 'b', 'c', ['a', 'b']);
    });
    await scenario('G04', async () => {
      await configure('G04-disable-master', { a: 2, b: 0, c: 1 }, 3, ['a', 'b']);
      await transfer('G04-master-only', 'b', 'c', ['b'], 'txBadAuth');
      await transfer('G04-added-signers', 'b', 'c', ['a', 'c']);
      check('Master remains disabled during the successful payment', weight(await state('b'), 'b'), 0);
    });
  } finally { await restoreB('G04-restore'); }

  await scenario('G05', async () => {
    const before = await state('c');
    const ops = [payment('c', '0.0000100', 'b')];
    const rejected = await transfer('G05-missing-operation-source', 'a', 'c', ['a'], 'txFailed', ops);
    check('Missing operation source rejected', rejected.operationCodes, ['opBadAuth']);
    check('Rejected operation moved no funds', (await state('c')).native, before.native);
    await transfer('G05-complete-sources', 'a', 'c', ['a', 'b'], 'txSuccess', ops);
    check('Operation recipient gained 100 stroops', (stroops((await state('c')).native) - stroops(before.native)).toString(), '100');
  });
  await scenario('G06', async () => {
    const ops = [payment('b', '0.0000100', 'a'), payment('c', '0.0000200', 'b'), payment('b', '0.0000030', 'c')];
    const tx = await build('a', ops);
    await authorize('G06-all-sources', tx, ['a', 'b', 'c']);
    const before = await snapshot();
    const sent = await submit('G06-all-sources', tx);
    const after = await snapshot();
    check('B net payment change', (stroops(after.b.native) - stroops(before.b.native)).toString(), '-70');
    check('C net payment change', (stroops(after.c.native) - stroops(before.c.native)).toString(), '170');
    check('A paid its transfer and transaction fee', (stroops(after.a.native) - stroops(before.a.native)).toString(), (-100n - BigInt(sent.feeCharged)).toString());
  });
  await scenario('G07', async () => {
    const unsignedInner = await build('b', [payment('c')]);
    const missingInner = sdk.TransactionBuilder.buildFeeBumpTransaction(keys.a.publicKey, '2000', unsignedInner, networkPassphrase);
    await authorize('G07-missing-inner', missingInner, ['a']);
    await submit('G07-missing-inner', missingInner, 'txFeeBumpInnerFailed', 'txBadAuth');
    const inner = await build('b', [payment('c')]);
    await authorize('G07-inner', inner, ['b']);
    const outer = sdk.TransactionBuilder.buildFeeBumpTransaction(keys.a.publicKey, '2000', inner, networkPassphrase);
    prepared('G07-missing-outer', outer, []);
    await submit('G07-missing-outer', outer, 'txBadAuth');
    check('Inner and outer hashes differ', hex(inner.hash()) !== hex(outer.hash()), true);
    await authorize('G07-outer', outer, ['a'], { inner_digest: hex(inner.hash()) });
    const before = await snapshot();
    const sent = await submit('G07-outer', outer, 'txFeeBumpInnerSuccess', 'txSuccess');
    const after = await snapshot();
    check('Inner source paid only the payment', (stroops(after.b.native) - stroops(before.b.native)).toString(), '-100');
    check('Outer source paid the fee', (stroops(after.a.native) - stroops(before.a.native)).toString(), (-BigInt(sent.feeCharged)).toString());
    check('Fee-bump recipient gained 100 stroops', (stroops(after.c.native) - stroops(before.c.native)).toString(), '100');
  });
  await scenario('G08', async () => {
    const before = await state('c');
    const wrongNetwork = await build('a', [payment('c')], { network: 'walleterm-negative-network' });
    await authorize('G08-wrong-network-signature', wrongNetwork, ['a'], { signing_network: 'walleterm-negative-network' });
    const wrongOnTestnet = sdk.TransactionBuilder.fromXDR(wrongNetwork.toXDR(), networkPassphrase);
    await submit('G08-wrong-network', wrongOnTestnet, 'txBadAuth');
    const original = await build('a', [payment('c')]);
    await authorize('G08-original-body', original, ['a']);
    const changed = await build('a', [payment('c', '0.0000101')], { sequence: (BigInt(original.sequence) - 1n).toString() });
    for (const signature of original.signatures) changed.addDecoratedSignature(signature);
    check('Changed body has a different digest', hex(changed.hash()) !== hex(original.hash()), true);
    await submit('G08-altered-body', changed, 'txBadAuth');
    const account = await rpc.getAccount(keys.a.publicKey);
    const stale = await build('a', [payment('c')], { sequence: (BigInt(account.sequenceNumber()) - 1n).toString() });
    await authorize('G08-stale-sequence', stale, ['a']);
    await submit('G08-stale-sequence', stale, 'txBadSeq');
    const expired = await build('a', [payment('c')], { expired: true });
    await authorize('G08-expired', expired, ['a']);
    await submit('G08-expired', expired, 'txTooLate');
    check('All negative cases moved no recipient funds', (await state('c')).native, before.native);
  });
  try {
    await scenario('G09', async () => {
      await configure('G09-configure', { a: 1, b: 1, c: 1 }, 2, ['b']);
      const tx = await build('b', [payment('c')]);
      await authorize('G09-duplicate-insufficient', tx, ['b']);
      tx.addDecoratedSignature(tx.signatures[0]);
      check('Two signature entries contain one distinct signature', new Set(tx.signatures.map(sig => hex(sig.toXdr()))).size, 1);
      await submit('G09-duplicate-insufficient', tx, 'txBadAuth');
      await transfer('G09-unrelated-extra', 'a', 'c', ['a', 'c'], 'txBadAuthExtra');
    });
  } finally { await restoreB('G09-restore'); }
  try {
    await scenario('G10', async () => {
      await configure('G10-old-signer', { a: 1, b: 1, c: 0 }, 2, ['b']);
      await transfer('G10-old-before-rotation', 'b', 'c', ['b', 'a']);
      await configure('G10-rotate', { a: 0, b: 1, c: 1 }, 2, ['b', 'a']);
      await transfer('G10-old-after-rotation', 'b', 'c', ['b', 'a'], 'txBadAuth');
      await transfer('G10-replacement', 'b', 'c', ['b', 'c']);
    });
  } finally { await restoreB('G10-restore'); }
  let final;
  try {
    final = await snapshot();
    for (const name of names) {
      assert.deepEqual(final[name].signers, initial[name].signers, `${name} signers remain available`);
      assert.deepEqual(final[name].thresholds, initial[name].thresholds, `${name} thresholds restored`);
    }
  } catch (error) {
    record('classic-final-state', 'failed', { accounts: final, error: String(error) });
    throw error;
  }
  record('classic-final-state', 'passed', { accounts: final, payer: keys.a.publicKey,
    assertion: 'All original signer configurations remain intact. Account A remains a usable contract payer.' });
}
