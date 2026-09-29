// Demo-only contract discovery, setup, simulation, and state verification.
// The signing SDK owns authorization digests and signatures. This module owns no keys.
import {
  Account,
  Address,
  Contract,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  buildAuthorizationEntryPreimage,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';
import { addressCredentials, parseAuthEntry } from '../../sdk/authorization.ts';

export const CONTRACT_RPC = 'https://soroban-testnet.stellar.org';
export const DEMO_WASM = {
  account: {
    file: 'walleterm_simple_account.wasm',
    hash: '87248e34b98c4acc825f68ea8b4666c9e8b89b43ef7cdf86ef9f284ad08a823d',
  },
  target: {
    file: 'walleterm_auth_target.wasm',
    hash: '04a9a33cd3f56a0f16aca0db6b18e4b624416f3393cfeb1e0ce8bcc0d47fcdf5',
  },
};
export type ContractStage =
  'upload-account' | 'upload-target' | 'deploy-account' | 'deploy-target' | 'increment';
export interface DemoAuthorization {
  xdr: string;
  address: string;
  adapter: 'account' | 'contract-ed25519';
  signed?: boolean;
}
export interface ContractReview {
  stage: ContractStage;
  accountId: string;
  targetId: string;
  before?: number;
  authorizations: DemoAuthorization[];
  authorizationReady: boolean;
}
export interface ContractPreparation {
  transaction: Transaction;
  review: ContractReview;
}
export type DemoRpc = Pick<
  rpc.Server,
  | 'getAccount'
  | 'getLedgerEntries'
  | 'simulateTransaction'
  | 'getLatestLedger'
  | 'sendTransaction'
  | 'getTransaction'
>;
export const demoRpc = () => new rpc.Server(CONTRACT_RPC);
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) || [], (pair) => parseInt(pair, 16));
export const hex = (value: Uint8Array) =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

// Each set is one smart account and one counter. A new set repeats the deploy steps with new contract IDs.
export const MAX_SETS = 50;
export type ContractKind = 'account' | 'target';
function checkSet(set: number) {
  if (!Number.isSafeInteger(set) || set < 1 || set > MAX_SETS) throw Error('The contract set is invalid.');
}

export function deployment(signer: string, kind: ContractKind, set = 1) {
  if (!StrKey.isValidEd25519PublicKey(signer)) throw Error('The demo signer is invalid.');
  checkSet(set);
  // Set 1 keeps the first demo salt, so saved reviews and deployed contracts keep their IDs.
  const salt = hash(
    new TextEncoder().encode(`walleterm-contract-demo-v1:${kind}:${signer}${set === 1 ? '' : `:${set}`}`),
  );
  const operation = Operation.createCustomContract({
    address: new Address(signer),
    wasmHash: bytes(DEMO_WASM[kind].hash),
    salt,
    constructorArgs: kind === 'account' ? [xdr.ScVal.scvBytes(StrKey.decodeEd25519PublicKey(signer))] : [],
  });
  const body = operation.body;
  if (
    body.type !== 'invokeHostFunction' ||
    body.value.hostFunction.type !== 'hostFunctionTypeCreateContractV2'
  )
    throw Error('The deployment operation is invalid.');
  const preimage = body.value.hostFunction.createContractV2.contractIdPreimage;
  const id = StrKey.encodeContract(
    hash(
      xdr.HashIdPreimage.envelopeTypeContractId(
        new xdr.HashIdPreimageContractId({
          networkId: hash(new TextEncoder().encode(Networks.TESTNET)),
          contractIdPreimage: preimage,
        }),
      ).toXdr(),
    ),
  );
  return { id, operation };
}
const ids = new Map<string, string>();
export function contractId(signer: string, kind: ContractKind, set: number) {
  const key = `${signer}:${kind}:${set}`;
  let id = ids.get(key);
  if (!id) ids.set(key, (id = deployment(signer, kind, set).id));
  return id;
}
/** The set of a saved review, found from its contract IDs. */
export function contractSet(signer: string, review: Pick<ContractReview, 'accountId' | 'targetId'>) {
  for (let set = 1; set <= MAX_SETS; set++)
    if (
      contractId(signer, 'account', set) === review.accountId &&
      contractId(signer, 'target', set) === review.targetId
    )
      return set;
  throw Error('The contract review belongs to a different signer.');
}

function instanceData(entry: xdr.LedgerEntryData, expectedHash: string) {
  if (entry.type !== 'contractData' || entry.contractData.val.type !== 'scvContractInstance')
    throw Error('The demo contract instance is invalid.');
  const executable = entry.contractData.val.instance.executable;
  if (executable.type !== 'contractExecutableWasm' || hex(executable.wasmHash.toBytes()) !== expectedHash)
    throw Error('The demo contract code does not match its recorded version.');
  return entry.contractData.val.instance;
}
const codeKey = (kind: ContractKind) =>
  xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: bytes(DEMO_WASM[kind].hash) }));
async function codeOnLedger(server: DemoRpc, kind: ContractKind) {
  return (await server.getLedgerEntries(codeKey(kind))).entries.length > 0;
}
function build(signer: string, sequence: string, operation: xdr.Operation) {
  return new TransactionBuilder(new Account(signer, sequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(180)
    .build();
}
async function read(server: DemoRpc, signer: string, id: string, method: string, args: xdr.ScVal[] = []) {
  const source = await server.getAccount(signer);
  const result = await server.simulateTransaction(
    build(signer, source.sequenceNumber(), new Contract(id).call(method, ...args)),
    undefined,
    'enforce',
  );
  if (rpc.Api.isSimulationError(result) || !result.result) throw Error(`The contract ${method} read failed.`);
  return scValToNative(result.result.retval);
}
export async function readCounter(
  server: DemoRpc,
  signer: string,
  review: Pick<ContractReview, 'accountId' | 'targetId'>,
) {
  const value = await read(server, signer, review.targetId, 'count', [
    nativeToScVal(review.accountId, { type: 'address' }),
  ]);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw Error('The contract counter is invalid.');
  return value;
}
async function checkOwner(server: DemoRpc, signer: string, accountId: string) {
  const owner = await read(server, signer, accountId, 'owner');
  if (!(owner instanceof Uint8Array) || hex(owner) !== hex(StrKey.decodeEd25519PublicKey(signer)))
    throw Error('The smart account belongs to a different signer.');
}
async function verifiedSetup(
  server: DemoRpc,
  signer: string,
  review: Pick<ContractReview, 'accountId' | 'targetId'>,
) {
  // One ledger request for both instances, matched by key.
  const keys = [review.accountId, review.targetId].map((id) => new Contract(id).getFootprint());
  const result = await server.getLedgerEntries(...keys);
  const found = new Map(result.entries.map((entry) => [entry.key.toXDR('base64'), entry.val]));
  const read = (index: number, expected: string) => {
    const entry = found.get(keys[index].toXDR('base64'));
    return entry ? instanceData(entry, expected) : null;
  };
  const account = read(0, DEMO_WASM.account.hash),
    target = read(1, DEMO_WASM.target.hash);
  if (account) await checkOwner(server, signer, review.accountId);
  return { account, target };
}

export interface WalkthroughLedger {
  signer: string;
  set: number;
  /** The highest set with a deployed contract, or 0. */
  latest: number;
  code: Record<ContractKind, boolean>;
  account: { id: string; exists: boolean };
  target: { id: string; exists: boolean };
  /** Present when both contracts of the set exist. */
  count?: number;
}
/**
 * Read the walkthrough state in one ledger request: both code entries and every set's two instances.
 * Entries are matched by key, so missing sets never hide later ones. `pickSet` chooses the set to show.
 */
export async function readWalkthrough(
  server: DemoRpc,
  signer: string,
  pickSet: (latest: number) => number,
): Promise<WalkthroughLedger> {
  const kinds = ['account', 'target'] as const;
  const instances = Array.from({ length: MAX_SETS }, (_, index) =>
    kinds.map((kind) => ({
      kind,
      set: index + 1,
      key: new Contract(contractId(signer, kind, index + 1)).getFootprint(),
    })),
  ).flat();
  const result = await server.getLedgerEntries(...kinds.map(codeKey), ...instances.map((item) => item.key));
  const found = new Map(result.entries.map((entry) => [entry.key.toXDR('base64'), entry.val]));
  const deployed = new Set<string>();
  let latest = 0;
  for (const item of instances) {
    const entry = found.get(item.key.toXDR('base64'));
    if (!entry) continue;
    instanceData(entry, DEMO_WASM[item.kind].hash);
    deployed.add(`${item.kind}:${item.set}`);
    latest = Math.max(latest, item.set);
  }
  const set = pickSet(latest);
  checkSet(set);
  const state: WalkthroughLedger = {
    signer,
    set,
    latest,
    code: {
      account: found.has(codeKey('account').toXDR('base64')),
      target: found.has(codeKey('target').toXDR('base64')),
    },
    account: { id: contractId(signer, 'account', set), exists: deployed.has(`account:${set}`) },
    target: { id: contractId(signer, 'target', set), exists: deployed.has(`target:${set}`) },
  };
  if (state.account.exists) await checkOwner(server, signer, state.account.id);
  if (state.account.exists && state.target.exists)
    state.count = await readCounter(server, signer, {
      accountId: state.account.id,
      targetId: state.target.id,
    });
  return state;
}
function expectedInvocation(operation: xdr.Operation) {
  const body = operation.body;
  if (body.type !== 'invokeHostFunction') throw Error('The contract operation is invalid.');
  const fn = body.value.hostFunction;
  const authorized =
    fn.type === 'hostFunctionTypeInvokeContract'
      ? xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn.invokeContract)
      : fn.type === 'hostFunctionTypeCreateContractV2'
        ? xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
            fn.createContractV2,
          )
        : null;
  if (!authorized) return null;
  return new xdr.SorobanAuthorizedInvocation({ function: authorized, subInvocations: [] });
}
function freshNonce() {
  const random = crypto.getRandomValues(new Uint8Array(8));
  return BigInt('0x' + hex(random)) & 0x7fffffffffffffffn;
}

/** The requested step is already on the ledger. The page refreshes instead of reporting a failure. */
export const stepDone = (message: string) => Object.assign(Error(message), { walkthrough: 'done' as const });

/**
 * Build the requested walkthrough step for one set. The ledger decides: a completed step and a missing earlier
 * step both stop here, before any signature request.
 */
export async function prepareContract(
  server: DemoRpc,
  signer: string,
  stage: ContractStage,
  set: number,
  loadWasm: (file: string) => Promise<Uint8Array>,
): Promise<ContractPreparation> {
  const accountDeployment = deployment(signer, 'account', set),
    targetDeployment = deployment(signer, 'target', set);
  const review: ContractReview = {
    stage,
    accountId: accountDeployment.id,
    targetId: targetDeployment.id,
    authorizations: [],
    authorizationReady: false,
  };
  const increment = stage === 'increment';
  const setup = await verifiedSetup(server, signer, review);
  let operation: xdr.Operation;
  if (stage === 'upload-account' || stage === 'upload-target') {
    const kind = stage === 'upload-account' ? 'account' : 'target';
    if (await codeOnLedger(server, kind)) throw stepDone('This contract code is already on testnet.');
    const wasm = await loadWasm(DEMO_WASM[kind].file);
    if (hex(hash(wasm)) !== DEMO_WASM[kind].hash) throw Error('The demo contract file failed verification.');
    operation = Operation.uploadContractWasm({ wasm });
  } else if (stage === 'deploy-account') {
    if (setup.account) throw stepDone('Your smart account is already deployed.');
    if (!(await codeOnLedger(server, 'account'))) throw Error('Upload the smart account code first.');
    operation = accountDeployment.operation;
  } else if (stage === 'deploy-target') {
    if (setup.target) throw stepDone('The counter is already deployed.');
    if (!setup.account) throw Error('Deploy your smart account first.');
    if (!(await codeOnLedger(server, 'target'))) throw Error('Upload the counter code first.');
    operation = targetDeployment.operation;
  } else {
    if (!setup.account || !setup.target) throw Error('Deploy your smart account and the counter first.');
    review.before = await readCounter(server, signer, review);
    operation = new Contract(review.targetId).call(
      'ping',
      nativeToScVal(review.accountId, { type: 'address' }),
      xdr.ScVal.scvU32(1),
    );
  }
  const source = await server.getAccount(signer);
  const template = build(signer, source.sequenceNumber(), operation);
  const recorded = await server.simulateTransaction(template, undefined, 'record');
  if (rpc.Api.isSimulationError(recorded) || !recorded.result)
    throw Error('The contract preparation failed.');
  const expected = expectedInvocation(operation);
  const authorizer = increment ? review.accountId : signer;
  const entries = recorded.result.auth || [];
  if (expected && entries.length !== 1)
    throw Error('The contract returned unexpected authorization entries.');
  if (!expected && entries.length) throw Error('The upload returned unexpected authorization entries.');
  const auth = entries.map((entry) => {
    if (!expected || entry.rootInvocation.toXdr('base64') !== expected.toXdr('base64'))
      throw Error('The contract authorization differs from the reviewed action.');
    const credentials = entry.credentials;
    let prepared: xdr.SorobanAuthorizationEntry;
    if (credentials.type === 'sorobanCredentialsSourceAccount') {
      // Setup explicitly replaces the recorded source optimization with signed address credentials.
      // SourceAccount is never sent to any signing API or included in the final transaction.
      if (increment) throw Error('The counter must require a custom account authorization.');
      prepared = new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
          new xdr.SorobanAddressCredentials({
            address: new Address(signer).toScAddress(),
            nonce: freshNonce(),
            signatureExpirationLedger: recorded.latestLedger + 60,
            signature: xdr.ScVal.scvVoid(),
          }),
        ),
        rootInvocation: entry.rootInvocation,
      });
    } else {
      // Address-bound V2 credentials only. V1 permits cross-address signature replay.
      if (credentials.type !== 'sorobanCredentialsAddressV2')
        throw Error('The contract returned authorization credentials other than AddressV2.');
      if (
        Address.fromScAddress(credentials.value.address).toString() !== authorizer ||
        credentials.value.signature.type !== 'scvVoid'
      )
        throw Error('The contract returned a different authorizer or an existing signature.');
      prepared = new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
          new xdr.SorobanAddressCredentials({
            ...credentials.value,
            signatureExpirationLedger: recorded.latestLedger + 60,
          }),
        ),
        rootInvocation: entry.rootInvocation,
      });
    }
    review.authorizations.push({
      xdr: prepared.toXdr('base64'),
      address: authorizer,
      adapter: increment ? 'contract-ed25519' : 'account',
    });
    return prepared;
  });
  const body = operation.body;
  if (body.type !== 'invokeHostFunction') throw Error('The contract operation is invalid.');
  const explicit = build(
    signer,
    source.sequenceNumber(),
    Operation.invokeHostFunction({ func: body.value.hostFunction, auth }),
  );
  // Recording estimates are provisional. Enforcing simulation follows explicit auth signing.
  if (!auth.length) {
    const enforced = await server.simulateTransaction(explicit, undefined, 'enforce');
    if (rpc.Api.isSimulationError(enforced)) throw Error('The upload simulation failed.');
    review.authorizationReady = true;
    return { review, transaction: rpc.assembleTransaction(explicit, enforced).build() };
  }
  return {
    review,
    transaction: rpc
      .assembleTransaction(explicit, { ...recorded, result: { ...recorded.result, auth } })
      .build(),
  };
}

export async function assembleAuthorizedContract(
  server: DemoRpc,
  transactionXdr: string,
  review: ContractReview,
) {
  if (!review.authorizations.length || review.authorizations.some((entry) => !entry.signed))
    throw Error('Sign each contract authorization before signing the transaction.');
  const transaction = TransactionBuilder.fromXDR(transactionXdr, Networks.TESTNET);
  if ('innerTransaction' in transaction || transaction.signatures.length)
    throw Error('Use an unsigned contract transaction.');
  const operation = transaction.operations[0];
  if (operation?.type !== 'invokeHostFunction') throw Error('The contract transaction is invalid.');
  const auth = review.authorizations.map((entry) =>
    xdr.SorobanAuthorizationEntry.fromXDR(entry.xdr, 'base64'),
  );
  if (auth.some((entry) => entry.credentials.type === 'sorobanCredentialsSourceAccount'))
    throw Error('Source account authorization is not permitted.');
  const source = await server.getAccount(transaction.source);
  if (BigInt(source.sequenceNumber()) + 1n !== BigInt(transaction.sequence))
    throw Error('The account sequence changed. Discard this transaction.');
  const fresh = build(
    transaction.source,
    source.sequenceNumber(),
    Operation.invokeHostFunction({ func: operation.func, auth }),
  );
  const enforced = await server.simulateTransaction(fresh, undefined, 'enforce');
  if (rpc.Api.isSimulationError(enforced))
    throw Error(`The authorization simulation failed: ${enforced.error}`);
  return rpc.assembleTransaction(fresh, enforced).build();
}

export function authorizationExpiry(review: ContractReview) {
  return Math.max(
    0,
    ...review.authorizations.map(
      (authorization) => addressCredentials(parseAuthEntry(authorization.xdr)).signatureExpirationLedger,
    ),
  );
}

export function validateContractReview(transactionXdr: string, signer: string, review: ContractReview) {
  if (
    !review ||
    !['upload-account', 'upload-target', 'deploy-account', 'deploy-target', 'increment'].includes(
      review.stage,
    ) ||
    !Array.isArray(review.authorizations) ||
    typeof review.authorizationReady !== 'boolean'
  )
    throw Error('The contract review is invalid.');
  // Both IDs must belong to one set of this signer.
  const set = contractSet(signer, review);
  const transaction = TransactionBuilder.fromXDR(transactionXdr, Networks.TESTNET);
  if (
    'innerTransaction' in transaction ||
    transaction.source !== signer ||
    transaction.operations.length !== 1
  )
    throw Error('The saved contract transaction is invalid.');
  const envelope = transaction.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx') throw Error('The saved contract envelope is invalid.');
  const raw = envelope.value.tx.operations[0];
  if (raw.body.type !== 'invokeHostFunction') throw Error('The saved contract operation is invalid.');
  const host = raw.body.value;
  const expected = expectedInvocation(raw);
  if (review.stage.startsWith('upload')) {
    const kind = review.stage === 'upload-account' ? 'account' : 'target';
    if (
      host.hostFunction.type !== 'hostFunctionTypeUploadContractWasm' ||
      hex(hash(host.hostFunction.wasm)) !== DEMO_WASM[kind].hash ||
      review.authorizations.length ||
      host.auth.length ||
      !review.authorizationReady
    )
      throw Error('The saved upload differs from the reviewed contract file.');
    return;
  }
  if (!expected || review.authorizations.length !== 1 || host.auth.length !== 1)
    throw Error('The saved contract authorization is invalid.');
  const authorization = review.authorizations[0];
  const authorizer = review.stage === 'increment' ? review.accountId : signer;
  const entry = parseAuthEntry(authorization.xdr),
    credentials = addressCredentials(entry);
  if (
    entry.credentials.type !== 'sorobanCredentialsAddressV2' ||
    authorization.address !== authorizer ||
    Address.fromScAddress(credentials.address).toString() !== authorizer ||
    authorization.adapter !== (review.stage === 'increment' ? 'contract-ed25519' : 'account') ||
    entry.rootInvocation.toXdr('base64') !== expected.toXdr('base64') ||
    (authorization.signed === true) !== (credentials.signature.type !== 'scvVoid') ||
    (review.authorizationReady && !authorization.signed)
  )
    throw Error('The saved authorization differs from the reviewed contract action.');
  if (review.stage === 'increment') {
    if (
      !Number.isSafeInteger(review.before) ||
      review.before! < 0 ||
      host.hostFunction.type !== 'hostFunctionTypeInvokeContract' ||
      host.hostFunction.invokeContract.toXdr('base64') !==
        new xdr.InvokeContractArgs({
          contractAddress: new Address(review.targetId).toScAddress(),
          functionName: 'ping',
          args: [nativeToScVal(review.accountId, { type: 'address' }), xdr.ScVal.scvU32(1)],
        }).toXdr('base64')
    )
      throw Error('The saved counter action is invalid.');
  } else {
    const kind = review.stage === 'deploy-account' ? 'account' : 'target';
    const body = deployment(signer, kind, set).operation.body;
    if (
      body.type !== 'invokeHostFunction' ||
      host.hostFunction.toXdr('base64') !== body.value.hostFunction.toXdr('base64')
    )
      throw Error('The saved deployment differs from the reviewed smart account.');
  }
  const envelopeEntry = host.auth[0];
  const unsignedIdentity = (value: xdr.SorobanAuthorizationEntry) => {
    if (value.credentials.type !== 'sorobanCredentialsAddressV2')
      throw Error('The transaction contains authorization credentials other than AddressV2.');
    const credentials = new xdr.SorobanAddressCredentials({
      ...addressCredentials(value),
      signature: xdr.ScVal.scvVoid(),
    });
    return new xdr.SorobanAuthorizationEntry({
      rootInvocation: value.rootInvocation,
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials),
    }).toXdr('base64');
  };
  if (unsignedIdentity(envelopeEntry) !== unsignedIdentity(entry))
    throw Error('The saved authorization identity differs from the transaction.');
  if (review.authorizationReady && envelopeEntry.toXdr('base64') !== authorization.xdr)
    throw Error('The transaction contains a different signed authorization.');
}

/**
 * Sign one reviewed entry through SEP-43 `signAuthEntry`, then attach this demo account's signature format.
 * The website owns the format: a native account uses the signature vector, the demo C-account uses raw bytes.
 */
export async function signDemoAuthorization(
  authorization: DemoAuthorization,
  signAuthEntry: (preimageXdr: string) => Promise<{ signedAuthEntry: string; signerAddress: string }>,
) {
  const entry = parseAuthEntry(authorization.xdr);
  if (entry.credentials.type !== 'sorobanCredentialsAddressV2')
    throw Error('The demo signs only AddressV2 authorization.');
  const expiration = addressCredentials(entry).signatureExpirationLedger;
  const preimage = buildAuthorizationEntryPreimage(entry, expiration, Networks.TESTNET);
  const { signedAuthEntry, signerAddress } = await signAuthEntry(preimage.toXdr('base64'));
  const signature = Uint8Array.from(atob(signedAuthEntry), (c) => c.charCodeAt(0));
  const signed = await authorizeEntry(
    entry,
    async () =>
      authorization.adapter === 'account'
        ? { signature, publicKey: signerAddress }
        : { signatureScVal: xdr.ScVal.scvBytes(signature) },
    expiration,
    Networks.TESTNET,
  );
  return signed.toXdr('base64');
}

export async function verifyContractResult(server: DemoRpc, signer: string, review: ContractReview) {
  if (review.stage === 'increment') {
    const count = await readCounter(server, signer, review);
    if (count !== review.before! + 1)
      throw Error('The confirmed counter differs from the reviewed increment.');
    return {
      count_before: review.before,
      count_after: count,
      account: review.accountId,
      contract: review.targetId,
    };
  }
  if (review.stage.startsWith('deploy')) {
    const setup = await verifiedSetup(server, signer, review);
    if (review.stage === 'deploy-account' ? !setup.account : !setup.target)
      throw Error('The confirmed deployment is not visible in the ledger.');
  }
  return { account: review.accountId, contract: review.targetId, stage: review.stage };
}
