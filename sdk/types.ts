import type { AuthAdapter } from './authorization.js';
import type { Sep43Error } from './errors.js';
/** Bridge protocol version 4 values. Connection credentials stay in memory or in localStorage. */
export interface Signer {
  public_key: string;
  comment?: string;
  fingerprint?: string;
}
export interface Account {
  address: string | null;
  /** The SEP-43 name of the tunnel network: a Stellar SDK `Networks` key. */
  network: string;
  networkPassphrase: string;
}
/** `selected` fixes one wallet. `available` permits changes among the wallets granted at first selection. */
export type WalletScope = 'selected' | 'available';
export type RequestState = 'pending' | 'approved' | 'signing' | 'signed' | 'denied' | 'expired' | 'unknown';
export type RequestKind = 'transaction' | 'auth_entry' | 'authorization' | 'message';
export interface SignalOptions {
  signal?: AbortSignal;
}
interface RequestBase {
  network_passphrase: string;
  address: string;
  selection_revision?: number;
}
/** A transaction envelope for the selected key. */
export interface TransactionInput extends RequestBase {
  kind: 'transaction';
  xdr: string;
}
/** A SEP-43 authorization preimage. The bridge returns a raw signature. */
export interface AuthPreimageInput extends RequestBase {
  kind: 'auth_entry';
  preimage_xdr: string;
}
/** The Walleterm adapter extension. The bridge returns the signed entry. */
export interface AuthorizationInput extends RequestBase {
  kind: 'authorization';
  auth_entry_xdr: string;
  auth_address: string;
  adapter: AuthAdapter;
}
/** SEP-53 text of 1 to 1024 UTF-8 bytes. The bridge returns a raw signature. */
export interface MessageInput extends RequestBase {
  kind: 'message';
  message: string;
}
export type SigningInput = TransactionInput | AuthPreimageInput | AuthorizationInput | MessageInput;
export interface RequestResult {
  id: string;
  kind: RequestKind;
  state: RequestState;
  hash?: string;
  expires_at?: string;
  error?: Sep43Error;
  signer_address?: string;
  signed_tx_xdr?: string;
  signed_auth_entry?: string;
  signed_auth_entry_xdr?: string;
  signed_message?: string;
}
export interface AccountResult {
  address: string | null;
  network: string;
  network_passphrase: string;
  selection_revision: number;
  wallet_scope: WalletScope;
  expires_at?: string;
  connection_id?: string;
}
export interface BridgeResponses {
  '/v1/connect': { token: string; wallet_scope: WalletScope; selection_revision: number };
  '/v1/signers': { signers: Signer[]; grant_id?: string };
  '/v1/select': Omit<AccountResult, 'wallet_scope'>;
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
export type Progress = { state: RequestState | 'retrying'; expiresAt?: string };
export interface SignOptions extends SignalOptions {
  networkPassphrase?: string;
  address?: string | null;
  onProgress?: (progress: Progress) => void;
}
export interface Connection {
  url: string;
  code: string;
}
