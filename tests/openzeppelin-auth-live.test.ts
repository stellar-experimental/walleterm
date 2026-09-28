import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  Account,
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  buildAuthorizationEntryPreimage,
  hash,
  xdr,
} from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';
import {
  OPENZEPPELIN_AUTH_COMMIT,
  addressCredentials,
  attachAuthSignature,
  inspectAuthEntry,
} from '../sdk/authorization.ts';
import { ozAuthPayload, ozSigner } from './contracts.ts';
import { simulationError, simulationSuccess } from './simulations.ts';
import {
  assembleIncrement,
  authorizeIncrement,
  expectedRule,
  loadDeployment,
  negativeControls,
  pingInvocation,
  prepareIncrement,
  rejectControl,
  runControls,
  verifyDeployment,
  verifyIncrement,
} from './openzeppelin-auth-live.ts';
import type { AuthSigner, OzDeployment, OzPrepared, OzRpc, Usage } from './openzeppelin-auth-live.ts';
import type { ContractsState, Manifest } from './contracts.ts';

// Isolated mock keys and a mocked RPC. This suite makes no network calls and requests no 1Password signatures.
const manifest: Manifest = JSON.parse(
  readFileSync(new URL('../fixtures/wasm/manifest.json', import.meta.url), 'utf8'),
);
const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const ids = { account: contract(1), verifier: contract(2), target: contract(3) };
function state(): ContractsState {
  return {
    oz_commit: OPENZEPPELIN_AUTH_COMMIT,
    wasm: {},
    done: {},
    contracts: {
      oz_basic_a: { id: ids.account, wasm: 'multisig_account_example.wasm' },
      ed25519_verifier: { id: ids.verifier, wasm: 'multisig_ed25519_verifier_example.wasm' },
      auth_target_1: { id: ids.target, wasm: 'walleterm_auth_target.wasm' },
    },
  };
}
// The fixed XDR of ScVal::Vec[U32 0] from docs/OPENZEPPELIN.md section 2.3.
const RULE_0_XDR = Buffer.from('0000001000000001000000010000000300000000', 'hex');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();

type Op = { type: string; func: xdr.HostFunction; auth?: xdr.SorobanAuthorizationEntry[] };
function field(value: xdr.ScVal, name: string) {
  if (value.type !== 'scvMap' || !value.map) throw Error('Expected an AuthPayload map.');
  const entry = value.map.find((item) => item.key.type === 'scvSymbol' && item.key.sym.toString() === name);
  if (!entry) throw Error(`Missing ${name}.`);
  return entry.val;
}

interface Options {
  wasm?: Partial<Record<'account' | 'verifier' | 'target', string>>;
  missing?: string;
  ruleCount?: number;
  rule?: (d: OzDeployment) => xdr.ScVal;
  record?: (entry: xdr.SorobanAuthorizationEntry) => xdr.SorobanAuthorizationEntry[];
  recordError?: string;
  retvalDelta?: number;
  enforce?: () => StellarSdk.rpc.Api.SimulateTransactionResponse;
  fee?: string;
}
function fixture(options: Options = {}) {
  const key = Keypair.random();
  const d = loadDeployment(state(), manifest, key.publicKey());
  let count = 7,
    sequence = '41';
  const calls: { method: string; mode?: string }[] = [];
  const signed: string[] = [];
  const success = (retval: xdr.ScVal, auth: xdr.SorobanAuthorizationEntry[] = []) =>
    simulationSuccess({
      latestLedger: 100,
      transactionData: new SorobanDataBuilder()
        .setResources(100000, 0, 1000)
        .setResourceFee(options.fee ?? '500'),
      minResourceFee: options.fee ?? '500',
      result: { retval, auth },
    });
  // A small host model: tree match, rule lookup, then the Ed25519 verifier over the OpenZeppelin digest.
  function host(op: Op) {
    if (op.func.type !== 'hostFunctionTypeInvokeContract') throw Error('Unexpected host function.');
    const call = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(op.func.invokeContract),
      subInvocations: [],
    });
    const entry = (op.auth ?? []).find((e) => e.rootInvocation.toXDR('base64') === call.toXDR('base64'));
    if (!entry) return simulationError('HostError: Error(Auth, InvalidAction) Unauthorized function call');
    const credentials = addressCredentials(entry);
    const rules = field(credentials.signature, 'context_rule_ids');
    if (rules.type !== 'scvVec' || rules.vec?.length !== 1) return simulationError('Error(Contract, #3014)');
    if (rules.vec[0].type !== 'scvU32' || rules.vec[0].u32 !== 0)
      return simulationError('HostError: Error(Auth, InvalidAction) Error(Contract, #3000)');
    const signers = field(credentials.signature, 'signers');
    if (signers.type !== 'scvMap' || signers.map?.length !== 1)
      return simulationError('Error(Contract, #3016)');
    const expectedKey = ozSigner(StellarSdk, d.verifier, key.rawPublicKey());
    if (signers.map[0].key.toXDR('base64') !== expectedKey.toXDR('base64'))
      return simulationError('Error(Contract, #3016)');
    const signature = signers.map[0].val;
    const preimage = buildAuthorizationEntryPreimage(
      entry,
      credentials.signatureExpirationLedger,
      Networks.TESTNET,
    );
    const digest = sha256(Buffer.concat([hash(preimage.toXDR()), RULE_0_XDR]));
    if (signature.type !== 'scvBytes' || !key.verify(digest, signature.bytes.toBytes()))
      return simulationError('HostError: Error(Auth, InvalidAction) Error(Crypto, InvalidInput)');
    return success(xdr.ScVal.scvU32(count + 1));
  }
  const server: OzRpc = {
    getAccount: async (address) => {
      assert.equal(address, d.signer);
      return new Account(d.signer, sequence);
    },
    getLedgerEntries: async (...keys) => {
      const ledgerKey = keys[0];
      if (ledgerKey.type !== 'contractData') throw Error('Unexpected ledger key.');
      const id = Address.fromScAddress(ledgerKey.contractData.contract).toString();
      const role = (['account', 'verifier', 'target'] as const).find((name) => d[name] === id)!;
      if (id === options.missing) return { latestLedger: 100, entries: [] };
      const wasm = options.wasm?.[role] ?? d.wasm[role];
      const val = xdr.LedgerEntryData.contractData(
        new xdr.ContractDataEntry({
          ext: xdr.ExtensionPoint.v0(),
          contract: ledgerKey.contractData.contract,
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent,
          val: xdr.ScVal.scvContractInstance(
            new xdr.ScContractInstance({
              storage: null,
              executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasm, 'hex')),
            }),
          ),
        }),
      );
      return { latestLedger: 100, entries: [{ key: ledgerKey, val }] };
    },
    simulateTransaction: async (transaction, _resources, mode) => {
      if ('innerTransaction' in transaction) throw Error('Unexpected fee bump.');
      const op = transaction.operations[0] as Op;
      if (op.type !== 'invokeHostFunction' || op.func.type !== 'hostFunctionTypeInvokeContract')
        throw Error('Unexpected operation.');
      const method = op.func.invokeContract.functionName.toString();
      calls.push({ method, mode });
      if (method === 'get_context_rules_count') return success(xdr.ScVal.scvU32(options.ruleCount ?? 1));
      if (method === 'get_context_rule') return success((options.rule ?? expectedRule)(d));
      if (method === 'count') return success(xdr.ScVal.scvU32(count));
      assert.equal(method, 'ping');
      if (mode === 'record') {
        if (options.recordError) return simulationError(options.recordError);
        const entry = new xdr.SorobanAuthorizationEntry({
          rootInvocation: new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
              op.func.invokeContract,
            ),
            subInvocations: [],
          }),
          credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
            new xdr.SorobanAddressCredentials({
              address: new Address(d.account).toScAddress(),
              nonce: 17n,
              signatureExpirationLedger: 0,
              signature: xdr.ScVal.scvVoid(),
            }),
          ),
        });
        return success(
          xdr.ScVal.scvU32(count + 1 + (options.retvalDelta ?? 0)),
          options.record ? options.record(entry) : [entry],
        );
      }
      return options.enforce?.() ?? host(op);
    },
  };
  // Mock signer: the same artifact the CLI and bridge return, from the isolated mock key.
  const sign: AuthSigner = async (input) => {
    const checked = inspectAuthEntry(input, input.public_key);
    const result = attachAuthSignature(input, input.public_key, hex(key.sign(checked.digest)));
    signed.push(result);
    return result;
  };
  return {
    key,
    d,
    server,
    calls,
    signed,
    sign,
    setCount: (value: number) => (count = value),
    setSequence: (value: string) => (sequence = value),
  };
}
const withSignature = (unsignedXdr: string, signature: xdr.ScVal) => {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(unsignedXdr, 'base64');
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: entry.rootInvocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({ ...addressCredentials(entry), signature }),
    ),
  }).toXDR('base64');
};
const withNonce = (entryXdr: string, nonce: bigint) => {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, 'base64');
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: entry.rootInvocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({ ...addressCredentials(entry), nonce }),
    ),
  }).toXDR('base64');
};
// Only the account and target select the invocation.
const at: OzDeployment = { ...ids, signer: '', wasm: { account: '', verifier: '', target: '' } };
const hostPayload = (prepared: OzPrepared) =>
  hash(
    buildAuthorizationEntryPreimage(
      xdr.SorobanAuthorizationEntry.fromXDR(prepared.unsignedXdr, 'base64'),
      prepared.expiration,
      Networks.TESTNET,
    ).toXDR(),
  );

test('expected rule matches the rule of the recorded account observed live on 2026-09-28', () => {
  // Public testnet ids from evidence/live/contracts-state.json and the public test-a key. No signing.
  const recorded = {
    account: 'CCTHYTKMKC3TV2ZT2ZGGGXMUKE4VROVXLKQQRCU5FRYUCRBIYX5NYYMF',
    verifier: 'CBW4YZ2CA7LBE7QYXCK7WEWLIJOQAZCHOVCFHPEMOYWJ2SI67UFHVMLR',
    target: 'CD2AHFORL2QCB5DPZK7GEV32YJNVADNLBJQ6QZG6HMBFUAZ725IUEWRD',
    signer: 'GBSW6N4WGTIOH3ZJMFSEW4KU5RYLUP5YIK3ISNYFR4644WTSWXGMGZAA',
    wasm: { account: '', verifier: '', target: '' },
  };
  assert.equal(
    expectedRule(recorded).toXDR('base64'),
    'AAAAEQAAAAEAAAAIAAAADwAAAAxjb250ZXh0X3R5cGUAAAAQAAAAAQAAAAEAAAAPAAAAB0RlZmF1bHQAAAAADwAAAAJpZAAAAAAAAwAAAAAAAAAPAAAABG5hbWUAAAAOAAAACG11bHRpc2lnAAAADwAAAAhwb2xpY2llcwAAABAAAAABAAAAAAAAAA8AAAAKcG9saWN5X2lkcwAAAAAAEAAAAAEAAAAAAAAADwAAAApzaWduZXJfaWRzAAAAAAAQAAAAAQAAAAEAAAADAAAAAAAAAA8AAAAHc2lnbmVycwAAAAAQAAAAAQAAAAEAAAAQAAAAAQAAAAMAAAAPAAAACEV4dGVybmFsAAAAEgAAAAFtzGdCB9YSfhi4lfsSy0JdAGRHdURTvIx2LJ1JHv0KegAAAA0AAAAgZW83ljTQ4+8pYWRLcVTscLo/uEK2iTcFjz3OWnK1zMMAAAAPAAAAC3ZhbGlkX3VudGlsAAAAAAE=',
  );
});

test('recorded deployments load with pinned code hashes and fail closed', () => {
  const signer = Keypair.random().publicKey();
  const d = loadDeployment(state(), manifest, signer);
  assert.deepEqual(
    { account: d.account, verifier: d.verifier, target: d.target, signer: d.signer },
    { ...ids, signer },
  );
  assert.deepEqual(d.wasm, {
    account: '0c20d69644a16562f98a6be92101d8d95475dd3cbc45923c2a2b5f6a5126f0d0',
    verifier: '875b095d57291172d2f103b02240cdb72bc4157fc0d5ce7dfbc934b1d84209b4',
    target: '04a9a33cd3f56a0f16aca0db6b18e4b624416f3393cfeb1e0ce8bcc0d47fcdf5',
  });
  const changed = (edit: (value: ContractsState) => void) => {
    const value = state();
    edit(value);
    return value;
  };
  for (const bad of [
    changed((s) => (s.oz_commit = 'a9c42169000638da937577f592ebf61a7a3c94ca')),
    changed((s) => delete s.contracts.oz_basic_a),
    changed((s) => (s.contracts.ed25519_verifier.wasm = 'walleterm_simple_account.wasm')),
    changed((s) => (s.contracts.auth_target_1.id = signer)),
  ])
    assert.throws(() => loadDeployment(bad, manifest, signer));
  assert.throws(() => loadDeployment(state(), { ...manifest, oz_commit: 'other' }, signer), /commit/);
  assert.throws(() => loadDeployment(state(), manifest, contract(9)), /signer/);
});

test('live deployment checks cover code, rule count, and the complete rule', async () => {
  const ok = fixture();
  const verified = await verifyDeployment(ok.server, ok.d);
  assert.equal(verified.rule_count, 1);
  assert.equal(verified.rule_xdr, expectedRule(ok.d).toXDR('base64'));
  assert.ok(ok.calls.every((call) => call.mode === 'enforce'));
  const other = Keypair.random().rawPublicKey();
  // Replace one field of the expected rule.
  const ruleWith = (name: string, value: (d: OzDeployment) => xdr.ScVal) => (d: OzDeployment) => {
    const rule = expectedRule(d);
    if (rule.type !== 'scvMap' || !rule.map) throw Error('Expected a rule map.');
    return xdr.ScVal.scvMap(
      rule.map.map((entry) =>
        entry.key.type === 'scvSymbol' && entry.key.sym.toString() === name
          ? new xdr.ScMapEntry({ key: entry.key, val: value(d) })
          : entry,
      ),
    );
  };
  const signers = (verifier: (d: OzDeployment) => string, key: (d: OzDeployment) => Uint8Array) =>
    ruleWith('signers', (d) => xdr.ScVal.scvVec([ozSigner(StellarSdk, verifier(d), key(d))]));
  const cases: [Options, RegExp][] = [
    [{ wasm: { account: '00'.repeat(32) } }, /account contract code/],
    [{ wasm: { verifier: '00'.repeat(32) } }, /verifier contract code/],
    [{ wasm: { target: '00'.repeat(32) } }, /target contract code/],
    [{ ruleCount: 2 }, /rule count/],
    [
      {
        rule: signers(
          (d) => d.verifier,
          () => other,
        ),
      },
      /rule differs/,
    ],
    [
      {
        rule: signers(
          () => contract(8),
          (d) => StrKey.decodeEd25519PublicKey(d.signer),
        ),
      },
      /rule differs/,
    ],
    [{ rule: ruleWith('valid_until', () => xdr.ScVal.scvU32(200)) }, /rule differs/],
    [
      { rule: ruleWith('policies', () => xdr.ScVal.scvVec([new Address(contract(7)).toScVal()])) },
      /rule differs/,
    ],
    [
      { rule: ruleWith('context_type', () => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('CallContract')])) },
      /rule differs/,
    ],
  ];
  for (const [options, message] of cases) {
    const f = fixture(options);
    await assert.rejects(verifyDeployment(f.server, f.d), message);
  }
  const gone = fixture({ missing: ids.verifier });
  await assert.rejects(verifyDeployment(gone.server, gone.d), /verifier contract instance is missing/);
});

test('one signing request follows the complete review and returns an independently verified entry', async () => {
  const f = fixture();
  const prepared = await prepareIncrement(f.server, f.d);
  assert.equal(prepared.before, 7);
  assert.equal(prepared.expiration, 300);
  assert.deepEqual(prepared.input.adapter, {
    type: 'openzeppelin-ed25519',
    verifier: f.d.verifier,
    context_rule_ids: [0],
  });
  assert.equal(
    xdr.SorobanAuthorizationEntry.fromXDR(prepared.unsignedXdr, 'base64').rootInvocation.toXDR('base64'),
    pingInvocation(f.d).toXDR('base64'),
  );
  const result = await authorizeIncrement(f.server, f.d, prepared, f.sign);
  assert.equal(f.signed.length, 1);
  assert.equal(result.signedXdr, f.signed[0]);
  const digest = sha256(Buffer.concat([hostPayload(prepared), RULE_0_XDR]));
  assert.equal(result.digest, hex(digest));
  assert.equal(result.host_payload, hex(hostPayload(prepared)));
  assert.ok(f.key.verify(digest, Buffer.from(result.signature, 'hex')));
  const assembled = await assembleIncrement(f.server, f.d, result.signedXdr);
  const operation = assembled.operations[0] as Op;
  assert.equal(operation.auth?.[0].toXDR('base64'), result.signedXdr);
  assert.equal(assembled.fee, String(100 + 500));
});

test('simulation and request differences stop before any signing request', async () => {
  const mutate = (edit: (entry: xdr.SorobanAuthorizationEntry) => xdr.SorobanAuthorizationEntry[]) => ({
    record: edit,
  });
  const credentials = (
    entry: xdr.SorobanAuthorizationEntry,
    changes: Partial<xdr.SorobanAddressCredentials>,
  ) => new xdr.SorobanAddressCredentials({ ...addressCredentials(entry), ...changes });
  const unexpected = /unexpected authorization entries/,
    tree = /differs from the expected tree/;
  const recorded: [string, Options, RegExp][] = [
    ['no entry', mutate(() => []), unexpected],
    ['two entries', mutate((e) => [e, e]), unexpected],
    [
      'legacy V1',
      mutate((e) => [
        new xdr.SorobanAuthorizationEntry({
          rootInvocation: e.rootInvocation,
          credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(credentials(e, {})),
        }),
      ]),
      /requires explicit AddressV2/,
    ],
    [
      'other address',
      mutate((e) => [
        new xdr.SorobanAuthorizationEntry({
          rootInvocation: e.rootInvocation,
          credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
            credentials(e, { address: new Address(contract(9)).toScAddress() }),
          ),
        }),
      ]),
      tree,
    ],
    [
      'existing signature',
      mutate((e) => [
        new xdr.SorobanAuthorizationEntry({
          rootInvocation: e.rootInvocation,
          credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
            credentials(e, { signature: xdr.ScVal.scvBytes(Buffer.alloc(64)) }),
          ),
        }),
      ]),
      /unsigned authorization entry/,
    ],
    [
      'changed arguments',
      mutate((e) => [
        new xdr.SorobanAuthorizationEntry({
          rootInvocation: pingInvocation(at, 2),
          credentials: e.credentials,
        }),
      ]),
      tree,
    ],
    [
      'extra sub-invocation',
      mutate((e) => [
        new xdr.SorobanAuthorizationEntry({
          credentials: e.credentials,
          rootInvocation: new xdr.SorobanAuthorizedInvocation({
            function: e.rootInvocation.function,
            subInvocations: [e.rootInvocation],
          }),
        }),
      ]),
      tree,
    ],
    [
      'recording error',
      { recordError: 'HostError: Error(Storage, MissingValue)' },
      /recording simulation failed/,
    ],
    ['different counter', { retvalDelta: 1 }, /different counter/],
  ];
  for (const [name, options, message] of recorded) {
    const f = fixture(options);
    await assert.rejects(
      async () => authorizeIncrement(f.server, f.d, await prepareIncrement(f.server, f.d), f.sign),
      message,
      name,
    );
    assert.equal(f.signed.length, 0, name);
  }
  const f = fixture();
  const base = await prepareIncrement(f.server, f.d);
  const rule = /differs from the verified account rule/;
  const edits: [string, (p: OzPrepared) => void, RegExp][] = [
    [
      'wrong context rule id',
      (p) => p.input.adapter.type === 'openzeppelin-ed25519' && (p.input.adapter.context_rule_ids = [1]),
      rule,
    ],
    [
      'two rule ids',
      (p) => p.input.adapter.type === 'openzeppelin-ed25519' && (p.input.adapter.context_rule_ids = [0, 0]),
      rule,
    ],
    [
      'other verifier',
      (p) => p.input.adapter.type === 'openzeppelin-ed25519' && (p.input.adapter.verifier = contract(8)),
      rule,
    ],
    ['other adapter', (p) => (p.input.adapter = { type: 'contract-ed25519' }), rule],
    ['other address', (p) => (p.input.address = contract(9)), rule],
    [
      'changed invocation',
      (p) => {
        const moved = new xdr.SorobanAuthorizationEntry({
          credentials: xdr.SorobanAuthorizationEntry.fromXDR(p.unsignedXdr, 'base64').credentials,
          rootInvocation: pingInvocation(f.d, 2),
        }).toXDR('base64');
        p.unsignedXdr = moved;
        p.input.auth_entry_xdr = moved;
      },
      /invocation differs from the reviewed increment/,
    ],
    ['wrong expiration', (p) => (p.expiration += 1), /independent digest differs/],
  ];
  for (const [name, edit, message] of edits) {
    const prepared = structuredClone(base);
    edit(prepared);
    await assert.rejects(authorizeIncrement(f.server, f.d, prepared, f.sign), message, name);
    assert.equal(f.signed.length, 0, name);
  }
});

test('a live rule or code change after preparation stops the signing request', async () => {
  const changes: [string, (options: Options) => void, RegExp][] = [
    ['second rule', (options) => (options.ruleCount = 2), /rule count/],
    ['account upgrade', (options) => (options.wasm = { account: '00'.repeat(32) }), /account contract code/],
    [
      'rule expiry',
      (options) =>
        (options.rule = (d) => {
          const rule = expectedRule(d);
          if (rule.type !== 'scvMap' || !rule.map) throw Error('Expected a rule map.');
          return xdr.ScVal.scvMap([
            ...rule.map.slice(0, -1),
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('valid_until'), val: xdr.ScVal.scvU32(200) }),
          ]);
        }),
      /rule differs/,
    ],
  ];
  for (const [name, change, message] of changes) {
    const options: Options = {};
    const f = fixture(options);
    const prepared = await prepareIncrement(f.server, f.d);
    change(options);
    await assert.rejects(authorizeIncrement(f.server, f.d, prepared, f.sign), message, name);
    assert.equal(f.signed.length, 0, name);
  }
});

test('returned artifacts must match the reviewed entry and the OpenZeppelin digest', async () => {
  const f = fixture();
  const prepared = await prepareIncrement(f.server, f.d);
  const payload = hostPayload(prepared);
  const digest = sha256(Buffer.concat([payload, RULE_0_XDR]));
  const rawKey = f.key.rawPublicKey();
  const oz = (signature: Uint8Array, rules = [0]) =>
    withSignature(
      prepared.unsignedXdr,
      ozAuthPayload(StellarSdk, [{ verifier: f.d.verifier, rawKey, signature }], rules),
    );
  const idsOne = sha256(
    Buffer.concat([payload, Buffer.from('0000001000000001000000010000000300000001', 'hex')]),
  );
  const delegated = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Delegated'),
    new Address(Keypair.random().publicKey()).toScVal(),
  ]);
  const withDelegate = withSignature(
    prepared.unsignedXdr,
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('context_rule_ids'),
        val: xdr.ScVal.scvVec([xdr.ScVal.scvU32(0)]),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('signers'),
        val: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({ key: delegated, val: xdr.ScVal.scvBytes(Buffer.alloc(0)) }),
          new xdr.ScMapEntry({
            key: ozSigner(StellarSdk, f.d.verifier, rawKey),
            val: xdr.ScVal.scvBytes(f.key.sign(digest)),
          }),
        ]),
      }),
    ]),
  );
  const failed = /failed independent verification/;
  const returned: [string, string, RegExp][] = [
    ['other key', oz(Keypair.random().sign(digest)), failed],
    ['raw host payload', oz(f.key.sign(payload)), failed],
    ['other rule digest', oz(f.key.sign(idsOne), [1]), failed],
    ['extra delegated signer', withDelegate, /invalid signature/],
    [
      'raw contract signature',
      withSignature(prepared.unsignedXdr, xdr.ScVal.scvBytes(f.key.sign(digest))),
      /schema is invalid/,
    ],
    ['other nonce', withNonce(oz(f.key.sign(digest)), 18n), /differs from the reviewed request/],
  ];
  for (const [name, artifact, message] of returned) {
    let calls = 0;
    await assert.rejects(
      authorizeIncrement(f.server, f.d, prepared, async () => {
        calls++;
        return artifact;
      }),
      message,
      name,
    );
    assert.equal(calls, 1, name);
  }
  const good = await authorizeIncrement(f.server, f.d, prepared, async () => oz(f.key.sign(digest)));
  assert.equal(good.signature, hex(f.key.sign(digest)));
});

test('negative controls change one element, request no signature, and require the expected rejection', async () => {
  const f = fixture();
  const prepared = await prepareIncrement(f.server, f.d);
  const { signedXdr } = await authorizeIncrement(f.server, f.d, prepared, f.sign);
  await assembleIncrement(f.server, f.d, signedXdr);
  const controls = negativeControls(f.d, signedXdr);
  assert.deepEqual(
    controls.map((c) => [c.id, c.expect]),
    [
      ['missing-authorization', 'Error(Auth, InvalidAction)'],
      ['wrong-context-rule-id', 'Error(Contract, #3000)'],
      ['changed-invocation', 'Error(Crypto, InvalidInput)'],
    ],
  );
  const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, 'base64');
  const [missing, rule, invocation] = controls;
  assert.equal(missing.auth.length, 0);
  assert.equal(rule.auth[0].rootInvocation.toXDR('base64'), signed.rootInvocation.toXDR('base64'));
  assert.equal(addressCredentials(rule.auth[0]).nonce, addressCredentials(signed).nonce);
  const ruleIds = field(addressCredentials(rule.auth[0]).signature, 'context_rule_ids');
  assert.equal(ruleIds.toXDR('hex'), '0000001000000001000000010000000300000001');
  assert.equal(invocation.auth[0].credentials.toXDR('base64'), signed.credentials.toXDR('base64'));
  assert.equal(invocation.auth[0].rootInvocation.toXDR('base64'), pingInvocation(f.d, 2).toXDR('base64'));
  for (const control of controls) {
    const error = await rejectControl(f.server, f.d, control);
    assert.ok(error.includes(control.expect), control.id);
  }
  assert.equal(f.signed.length, 1);
  assert.ok(!('sendTransaction' in f.server));
  // An accepted or differently rejected control is an uncertain result.
  const accepted = fixture({ enforce: () => simulationSuccess() });
  await assert.rejects(rejectControl(accepted.server, accepted.d, controls[0]), /did not reject/);
  const other = fixture({ enforce: () => simulationError('HostError: Error(Budget, ExceededLimit)') });
  for (const control of controls)
    await assert.rejects(rejectControl(other.server, other.d, control), /did not reject/);
});

test('controls measure zero signature requests and submissions at the boundaries', async () => {
  const f = fixture();
  const usage: Usage = { signatures: 0, submissions: 0 };
  const sign: AuthSigner = async (input) => {
    usage.signatures++;
    return f.sign(input);
  };
  const { signedXdr } = await authorizeIncrement(f.server, f.d, await prepareIncrement(f.server, f.d), sign);
  assert.deepEqual(usage, { signatures: 1, submissions: 0 });
  const results = await runControls(f.server, f.d, signedXdr, usage);
  assert.deepEqual(
    results.map((result) => [result.id, result.signatures_requested, result.submitted]),
    [
      ['missing-authorization', 0, 0],
      ['wrong-context-rule-id', 0, 0],
      ['changed-invocation', 0, 0],
    ],
  );
  assert.ok(results.every((result) => result.error.includes(result.expect)));
  assert.deepEqual(usage, { signatures: 1, submissions: 0 });
  // A control path that reaches a signer or a submission fails, even when simulation rejects the control.
  for (const leak of ['signatures', 'submissions'] as const) {
    const leaking: OzRpc = {
      ...f.server,
      simulateTransaction: async (...args) => {
        usage[leak]++;
        return f.server.simulateTransaction(...args);
      },
    };
    await assert.rejects(
      runControls(leaking, f.d, signedXdr, usage),
      /requested a signature or a submission/,
    );
  }
});

test('assembly keeps the signed entry, enforces resources, and limits the fee', async () => {
  const f = fixture();
  const { signedXdr } = await authorizeIncrement(
    f.server,
    f.d,
    await prepareIncrement(f.server, f.d),
    f.sign,
  );
  const transaction: Transaction = await assembleIncrement(f.server, f.d, signedXdr);
  assert.equal(transaction.source, f.d.signer);
  assert.equal(transaction.sequence, '42');
  const rejected = fixture({ enforce: () => simulationError('HostError: Error(Auth, InvalidAction)') });
  await assert.rejects(
    assembleIncrement(rejected.server, rejected.d, signedXdr),
    /authorization simulation failed/,
  );
  const expensive = fixture({ fee: '2000000' });
  const again = await authorizeIncrement(
    expensive.server,
    expensive.d,
    await prepareIncrement(expensive.server, expensive.d),
    expensive.sign,
  );
  await assert.rejects(assembleIncrement(expensive.server, expensive.d, again.signedXdr), /fee exceeds/);
});

test('state verification requires exactly one increment', async () => {
  const f = fixture();
  f.setCount(8);
  assert.deepEqual(await verifyIncrement(f.server, f.d, 7), {
    count_before: 7,
    count_after: 8,
    account: f.d.account,
    contract: f.d.target,
  });
  await assert.rejects(verifyIncrement(f.server, f.d, 8), /differs/);
  f.setCount(10);
  await assert.rejects(verifyIncrement(f.server, f.d, 8), /differs/);
});
