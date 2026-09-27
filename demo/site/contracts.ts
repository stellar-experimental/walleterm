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

export function deployment(signer: string, kind: 'account' | 'target') {
  if (!StrKey.isValidEd25519PublicKey(signer)) throw Error('The demo signer is invalid.');
  const salt = hash(new TextEncoder().encode(`walleterm-contract-demo-v1:${kind}:${signer}`));
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

async function instance(server: DemoRpc, id: string, expectedHash: string) {
  const result = await server.getLedgerEntries(new Contract(id).getFootprint());
  if (!result.entries.length) return null;
  const entry = result.entries[0].val;
  if (entry.type !== 'contractData' || entry.contractData.val.type !== 'scvContractInstance')
    throw Error('The demo contract instance is invalid.');
  const executable = entry.contractData.val.instance.executable;
  if (executable.type !== 'contractExecutableWasm' || hex(executable.wasmHash.toBytes()) !== expectedHash)
    throw Error('The demo contract code does not match its recorded version.');
  return entry.contractData.val.instance;
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
async function verifiedSetup(
  server: DemoRpc,
  signer: string,
  review: Pick<ContractReview, 'accountId' | 'targetId'>,
) {
  const account = await instance(server, review.accountId, DEMO_WASM.account.hash);
  const target = await instance(server, review.targetId, DEMO_WASM.target.hash);
  if (account) {
    const owner = await read(server, signer, review.accountId, 'owner');
    if (!(owner instanceof Uint8Array) || hex(owner) !== hex(StrKey.decodeEd25519PublicKey(signer)))
      throw Error('The smart account belongs to a different signer.');
  }
  return { account, target };
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

export async function prepareContract(
  server: DemoRpc,
  signer: string,
  increment: boolean,
  loadWasm: (file: string) => Promise<Uint8Array>,
): Promise<ContractPreparation> {
  const accountDeployment = deployment(signer, 'account'),
    targetDeployment = deployment(signer, 'target');
  const review: ContractReview = {
    stage: 'increment',
    accountId: accountDeployment.id,
    targetId: targetDeployment.id,
    authorizations: [],
    authorizationReady: false,
  };
  const setup = await verifiedSetup(server, signer, review);
  let operation: xdr.Operation | undefined;
  if (increment) {
    if (!setup.account || !setup.target)
      throw Error('Set up the contract demo before incrementing the counter.');
    review.before = await readCounter(server, signer, review);
    operation = new Contract(review.targetId).call(
      'ping',
      nativeToScVal(review.accountId, { type: 'address' }),
      xdr.ScVal.scvU32(1),
    );
  } else {
    for (const kind of ['account', 'target'] as const) {
      if (setup[kind]) continue;
      const code = await server.getLedgerEntries(
        xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: bytes(DEMO_WASM[kind].hash) })),
      );
      if (!code.entries.length) {
        const wasm = await loadWasm(DEMO_WASM[kind].file);
        if (hex(hash(wasm)) !== DEMO_WASM[kind].hash)
          throw Error('The demo contract file failed verification.');
        review.stage = kind === 'account' ? 'upload-account' : 'upload-target';
        operation = Operation.uploadContractWasm({ wasm });
      } else {
        review.stage = kind === 'account' ? 'deploy-account' : 'deploy-target';
        operation = kind === 'account' ? accountDeployment.operation : targetDeployment.operation;
      }
      break;
    }
    if (!operation) throw Error('The contract demo is ready. Select Increment counter.');
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
      if (
        credentials.type !== 'sorobanCredentialsAddress' &&
        credentials.type !== 'sorobanCredentialsAddressV2'
      )
        throw Error('The contract returned unsupported authorization credentials.');
      if (
        Address.fromScAddress(credentials.value.address).toString() !== authorizer ||
        credentials.value.signature.type !== 'scvVoid'
      )
        throw Error('The contract returned a different authorizer or an existing signature.');
      prepared = new xdr.SorobanAuthorizationEntry({
        credentials:
          credentials.type === 'sorobanCredentialsAddress'
            ? xdr.SorobanCredentials.sorobanCredentialsAddress(
                new xdr.SorobanAddressCredentials({
                  ...credentials.value,
                  signatureExpirationLedger: recorded.latestLedger + 60,
                }),
              )
            : xdr.SorobanCredentials.sorobanCredentialsAddressV2(
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
  if (
    review.accountId !== deployment(signer, 'account').id ||
    review.targetId !== deployment(signer, 'target').id
  )
    throw Error('The contract review belongs to a different signer.');
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
    const body = deployment(signer, kind).operation.body;
    if (
      body.type !== 'invokeHostFunction' ||
      host.hostFunction.toXdr('base64') !== body.value.hostFunction.toXdr('base64')
    )
      throw Error('The saved deployment differs from the reviewed smart account.');
  }
  const envelopeEntry = host.auth[0];
  const unsignedIdentity = (value: xdr.SorobanAuthorizationEntry) => {
    const credentials = new xdr.SorobanAddressCredentials({
      ...addressCredentials(value),
      signature: xdr.ScVal.scvVoid(),
    });
    return new xdr.SorobanAuthorizationEntry({
      rootInvocation: value.rootInvocation,
      credentials:
        value.credentials.type === 'sorobanCredentialsAddressV2'
          ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials)
          : xdr.SorobanCredentials.sorobanCredentialsAddress(credentials),
    }).toXdr('base64');
  };
  if (unsignedIdentity(envelopeEntry) !== unsignedIdentity(entry))
    throw Error('The saved authorization identity differs from the transaction.');
  if (review.authorizationReady && envelopeEntry.toXdr('base64') !== authorization.xdr)
    throw Error('The transaction contains a different signed authorization.');
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
