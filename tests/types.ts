// Shared shapes for the live runners and their offline tests. Types only; no runtime code.
import type * as StellarSdk from '@stellar/stellar-sdk';
import type { FeeBumpTransaction, Horizon, Transaction, rpc } from '@stellar/stellar-sdk';
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
export type SignDigest = (key: TestKey, digest: Uint8Array) => Promise<Uint8Array>;
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
  signDigest: SignDigest;
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

/** The part of a context that signs authorization payloads. */
export type SigningContext = Pick<LiveContext, 'sdk' | 'signDigest'>;
