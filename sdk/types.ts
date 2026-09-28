import type { AuthEntryInput } from './authorization.js';
/** Public bridge values. Connection credentials stay in memory. */
export interface Signer {
  public_key: string;
  comment?: string;
  fingerprint?: string;
}
export interface Account {
  address: string | null;
  networkPassphrase: string;
}
export type WalletScope = 'selected' | 'available';
export type RequestState = 'pending' | 'approved' | 'signing' | 'signed' | 'denied' | 'expired' | 'unknown';
export interface SignalOptions {
  signal?: AbortSignal;
}
export interface SigningInput {
  transaction_xdr: string;
  public_key: string;
  network_passphrase: string;
  selection_revision?: number;
}
export interface RequestResult {
  id: string;
  state: RequestState;
  signed_xdr?: string;
  message?: string;
  expires_at?: string;
}
export interface AccountResult {
  public_key: string | null;
  network_passphrase: string;
  selection_revision: number;
  wallet_scope?: WalletScope;
}
export interface BridgeResponses {
  '/v1/connect': { token: string; wallet_scope?: WalletScope };
  '/v1/signers': { signers: Signer[]; grant_id?: string };
  '/v1/select': AccountResult;
  '/v1/account': AccountResult;
  '/v1/requests': RequestResult;
  '/v1/disconnect': { disconnected: true };
}
export type RequestPath = keyof BridgeResponses | `/v1/requests/${string}`;
export type BridgeResponse<P extends RequestPath> = P extends keyof BridgeResponses
  ? BridgeResponses[P]
  : RequestResult;
export type Fetch = (input: string | URL | Request, options?: RequestInit) => Promise<Response>;
export type WalletPicker = (signers: Signer[], options: { signal: AbortSignal }) => Promise<string>;
export interface ConnectOptions {
  code?: string;
  selectWallet: WalletPicker;
  walletScope?: WalletScope;
  signal?: AbortSignal;
}
export interface SignOptions extends SignalOptions {
  networkPassphrase?: string;
  address?: string | null;
  onProgress?: (progress: { state: RequestState | 'retrying'; expiresAt?: string }) => void;
}
export interface Connection {
  url: string;
  code: string;
}

export interface AuthSigningInput extends AuthEntryInput {
  kind: 'authorization';
  selection_revision?: number;
}
export type ArtifactSigningInput = SigningInput | AuthSigningInput;
