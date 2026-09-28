// Shared shapes for the live runners and their offline tests. Types only; no runtime code.
import type * as StellarSdk from '@stellar/stellar-sdk';
import type { FeeBumpTransaction, Horizon, Transaction, rpc, xdr } from '@stellar/stellar-sdk';
import type { AuthAdapter } from '../sdk/authorization.ts';
import type { SubmissionOutcome, SubmitOptions } from './submission.ts';

export type Sdk = typeof StellarSdk;
export type KeyName = 'a' | 'b' | 'c';
/** A dedicated public test key. It holds no private material. */
export interface TestKey {
  name: string;
  publicKey: string;
  rawPublicKey: Uint8Array;
}
export type TestKeys = Record<KeyName, TestKey>;
/** Evidence fields of one result row. */
export type Details = Record<string, unknown>;
export type RecordRow = (id: string, status: string, details?: Details) => unknown;
/** `walleterm sign` with the preimage shape. Walleterm signs SHA-256 of the preimage. Returns the raw signature. */
export type SignPreimage = (key: TestKey, preimage: xdr.HashIdPreimage) => Promise<Uint8Array>;
/**
 * `walleterm sign` with the entry shape, for the unsigned AddressV2 entry that the preimage describes.
 * Returns the adapter digest and the raw signature, so the caller can merge several signers.
 */
export type SignEntry = (
  key: TestKey,
  preimage: xdr.HashIdPreimage,
  adapter: AuthAdapter,
) => Promise<{ digest: Uint8Array; signature: Uint8Array }>;
export type AnyTransaction = Transaction | FeeBumpTransaction;
/** A live submission: the send response, then the lookup result when the send was not terminal. */
export type LiveOutcome = SubmissionOutcome<
  rpc.Api.SendTransactionResponse | rpc.Api.GetTransactionResponse,
  rpc.Api.SendTransactionResponse
>;
/** A reconciled submission. The send response comes from the JSON archive when it exists. */
export type ReconciledOutcome = SubmissionOutcome<rpc.Api.GetTransactionResponse, unknown>;

/** The context that tests/live-utils.ts builds for every live runner. */
export interface LiveContext {
  sdk: Sdk;
  networkPassphrase: string;
  rpc: rpc.Server;
  horizon: Horizon.Server;
  keys: TestKeys;
  signPreimage: SignPreimage;
  signEntry: SignEntry;
  /** `walleterm sign` with the transaction shape. It appends one verified signature to `tx`. */
  sign<T extends AnyTransaction>(tx: T, key: TestKey): Promise<T>;
  send(tx: AnyTransaction, label: string, options?: SubmitOptions): Promise<LiveOutcome>;
  record: RecordRow;
  fund(key: TestKey): Promise<void>;
  assertClear(): void;
  reconcile(): Promise<ReconciledOutcome | null>;
  /** Row selection. WALLETERM_ROWS applies when this is absent. */
  rows?: string[];
  stopOnFailure?: boolean;
}

/** The part of a context that signs authorization preimages and entries. */
export type SigningContext = Pick<LiveContext, 'sdk' | 'signPreimage' | 'signEntry'>;
