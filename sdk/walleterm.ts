import { Networks } from '@stellar/stellar-sdk';
import { inspectTransactionRequest, verifyTransactionSignature } from './transaction.js';
import {
  addressCredentials,
  parseAuthEntry,
  inspectAuthEntry,
  verifyAuthEntrySignature,
} from './authorization.js';
import { inspectAuthPreimage, verifyPreimageSignature } from './preimage.js';
import type { AuthAdapter, AuthSignOptions } from './authorization.js';
export * from './authorization.js';
export * from './preimage.js';
import { requestError, sep43Error, walletermError, WalletermError } from './errors.js';
export { WalletermError };
export type { Sep43Code, Sep43Error, Sep43Reason } from './errors.js';
// Browser adapter for Walleterm bridge protocol version 3.
import type {
  Account,
  BridgeResponse,
  ConnectOptions,
  Fetch,
  Progress,
  RequestPath,
  RequestResult,
  SignalOptions,
  SignOptions,
  Signer,
  WalletPicker,
  WalletScope,
} from './types.js';
import type { Sep43Error } from './errors.js';
export type {
  Account,
  Connection,
  ConnectOptions,
  Fetch,
  Progress,
  RequestState,
  SignalOptions,
  Signer,
  SignOptions,
  WalletPicker,
  WalletScope,
} from './types.js';

// A response that claims signing succeeded cannot prove that no signature was produced.
function unverifiedResult(caught: unknown) {
  return Object.assign(requestError(caught), { requestState: 'unknown' as const, canceled: false });
}
interface ClientOptions {
  fetch?: Fetch;
  pollInterval?: number;
  /** The window. The SDK listens to its `pagehide` and `storage` events. `null` disables both. */
  page?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
}
type Artifact =
  | { kind: 'transaction'; xdr: string }
  | { kind: 'auth_entry'; preimage_xdr: string }
  | { kind: 'authorization'; auth_entry_xdr: string; auth_address: string; adapter: AuthAdapter };
const resultField = {
  transaction: 'signed_tx_xdr',
  auth_entry: 'signed_auth_entry',
  authorization: 'signed_auth_entry_xdr',
} as const;

/** One bridge session. Failures throw. `Walleterm` wraps it with the SEP-43 surface. */
export class WalletermClient {
  readonly url: string;
  readonly fetch: Fetch;
  readonly pollInterval: number;
  readonly page: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  token: string | null = null;
  account: Account | null = null;
  walletScope: WalletScope = 'selected';
  revision: number | null = 0;
  generation = 0;
  signings = new Set<AbortController>();
  selecting = false;
  selectionUncertain: { revision: number; publicKey: string } | null = null;
  grant?: string;
  /** Called after each account or credential change. `Walleterm` uses it. */
  onAccountChange?: () => void;
  constructor(
    bridgeUrl: string,
    {
      fetch: fetcher = globalThis.fetch.bind(globalThis),
      pollInterval = 1000,
      page = globalThis,
    }: ClientOptions = {},
  ) {
    const url = new URL(bridgeUrl);
    if (
      url.origin !== bridgeUrl ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      )
    )
      throw walletermError('invalid_request', 'Use the public bridge origin, without a path.');
    this.url = url.origin;
    this.fetch = fetcher;
    this.pollInterval = pollInterval;
    this.page = page;
  }
  setAccount(account: Account | null) {
    this.account = account;
    try {
      this.onAccountChange?.();
    } catch {
      /* Observers must not change the connection. */
    }
  }
  async request<P extends RequestPath>(
    path: P,
    data?: unknown,
    signal?: AbortSignal,
    { keepalive = false, token = this.token }: { keepalive?: boolean; token?: string | null } = {},
  ): Promise<BridgeResponse<P>> {
    const timeout = ['/v1/signers', '/v1/select'].includes(path) ? 135000 : 15000;
    const response = await this.fetch(`${this.url}${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
      headers: {
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      keepalive,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw Object.assign(Error(`The bridge returned an unreadable response (${response.status}).`), {
        status: response.status,
      });
    }
    if (!response.ok) {
      // An old response must not clear a newer connection.
      if (response.status === 401 && this.token === token) {
        this.token = null;
        this.setAccount(null);
      }
      const error: Partial<Sep43Error> = result?.error || {};
      throw Object.assign(Error(error.message || `Bridge request failed (${response.status}).`), {
        status: response.status,
        ...(typeof error.code === 'number' ? { code: error.code } : {}),
        ...(Array.isArray(error.ext) ? { ext: error.ext.filter((v) => typeof v === 'string') } : {}),
      });
    }
    return result;
  }
  async wait(signal: AbortSignal, milliseconds = this.pollInterval) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', stop);
        resolve();
      }, milliseconds);
      signal.addEventListener('abort', stop, { once: true });
    });
  }
  async connect({
    code,
    selectWallet,
    walletScope = 'selected',
    signal = AbortSignal.timeout(300000),
  }: ConnectOptions) {
    if (!['selected', 'available'].includes(walletScope))
      throw walletermError('invalid_request', 'The wallet scope is invalid.');
    if (typeof selectWallet !== 'function')
      throw walletermError('invalid_request', 'Provide a wallet picker.');
    if (this.token) {
      try {
        const account = await this.getAccount();
        if (account.address) return account;
      } catch (errorValue) {
        const error = requestError(errorValue);
        if (error.status !== 401) throw error;
      }
    }
    if (!this.token) {
      if (typeof code !== 'string' || !/^\d{8}$/.test(code))
        throw walletermError('invalid_request', 'Enter the eight-digit code from the tunnel terminal.');
      const result = await this.request('/v1/connect', { code, wallet_scope: walletScope }, signal);
      this.token = result.token;
      this.selecting = false;
      this.selectionUncertain = null;
      this.walletScope = result.wallet_scope;
      this.revision = 0;
      this.generation++;
      this.setAccount(null);
    }
    try {
      const signers = await this.listWallets({ signal });
      const publicKey = await selectWallet(signers, { signal });
      signal.throwIfAborted();
      const result = await this.selectWallet(publicKey, { signal });
      this.setAccount(result);
      return { ...result };
    } catch (errorValue) {
      const error = requestError(errorValue);
      await this.disconnect().catch(() => {});
      this.token = null;
      this.setAccount(null);
      throw error;
    }
  }
  async listWallets({ signal }: SignalOptions = {}) {
    if (!this.token) throw walletermError('not_connected', 'Connect the website first.');
    const token = this.token,
      generation = this.generation;
    const { signers, grant_id } = await this.request('/v1/signers', undefined, signal, { token });
    if (token !== this.token || generation !== this.generation)
      throw walletermError('conflict', 'The website connection changed.');
    this.grant = grant_id;
    return signers;
  }
  async selectWallet(publicKey: string, { signal }: SignalOptions = {}) {
    if (!this.token) throw walletermError('not_connected', 'Connect the website first.');
    if (this.selecting) throw walletermError('conflict', 'A wallet selection is already in progress.');
    if (this.selectionUncertain)
      throw walletermError('conflict', 'Recover the account or reconnect before changing wallets.');
    if (this.account?.address === publicKey) return { ...this.account };
    if (this.account && this.walletScope !== 'available')
      throw walletermError('conflict', 'Connect again with wallet switching enabled.');
    const token = this.token,
      scoped = this.walletScope === 'available',
      priorRevision = this.revision ?? 0;
    this.selecting = true;
    const generation = ++this.generation;
    for (const stop of this.signings) stop.abort(Error('The active wallet changed.'));
    try {
      const result = await this.request(
        '/v1/select',
        {
          public_key: publicKey,
          ...(scoped
            ? { expected_revision: this.revision, ...(this.revision === 0 ? { grant_id: this.grant } : {}) }
            : {}),
        },
        signal,
        { token },
      );
      if (token !== this.token || generation !== this.generation)
        throw walletermError('conflict', 'The website connection changed.');
      if (scoped && (!Number.isSafeInteger(result.selection_revision) || result.selection_revision < 1))
        throw walletermError('internal', 'The bridge returned an invalid wallet selection.');
      this.selectionUncertain = null;
      this.revision = result.selection_revision;
      this.setAccount({ address: result.address, networkPassphrase: result.network_passphrase });
      return { ...this.account! };
    } catch (errorValue) {
      const error = requestError(errorValue);
      // Selection can succeed while its response is lost. Reconcile before permitting another signature.
      if (token === this.token && generation === this.generation) {
        this.revision = null;
        this.selectionUncertain =
          !error.status || error.status >= 500 ? { revision: priorRevision, publicKey } : null;
        this.setAccount(null);
        try {
          await this.readAccount(token, generation);
        } catch {
          /* Keep signing disabled until account recovery succeeds. */
        }
      }
      throw error;
    } finally {
      if (generation === this.generation) this.selecting = false;
    }
  }
  /** Read the connected account from the bridge. */
  async getAccount() {
    if (this.selecting) throw walletermError('conflict', 'Wait for the wallet selection to finish.');
    return this.readAccount(this.token, this.generation);
  }
  async readAccount(token: string | null, generation: number) {
    const result = await this.request('/v1/account', undefined, undefined, { token });
    if (token !== this.token || generation !== this.generation)
      throw walletermError('conflict', 'The website connection changed.');
    if (
      result.wallet_scope === 'available' &&
      (!Number.isSafeInteger(result.selection_revision) || result.selection_revision < 0)
    )
      throw walletermError('internal', 'The bridge returned an invalid wallet selection.');
    if (
      this.revision !== null &&
      Number.isSafeInteger(this.revision) &&
      result.selection_revision < this.revision
    )
      throw walletermError('conflict', 'The wallet account response is stale.');
    if (
      this.selectionUncertain &&
      (result.selection_revision <= this.selectionUncertain.revision ||
        result.address !== this.selectionUncertain.publicKey)
    )
      throw walletermError(
        'conflict',
        'The wallet selection is not confirmed. Reconnect or recover the account later.',
      );
    if (result.network_passphrase !== Networks.TESTNET)
      throw walletermError('network_unsupported', 'The bridge reported a network other than testnet.');
    this.selectionUncertain = null;
    this.revision = result.selection_revision;
    this.walletScope = result.wallet_scope;
    this.setAccount({ address: result.address, networkPassphrase: result.network_passphrase });
    return { ...this.account! };
  }
  // Retry after a network error or a 5xx response. Stop when the connection changes.
  async retry<T>(
    send: () => Promise<T>,
    signal: AbortSignal,
    token: string,
    generation: number,
    onRetry?: () => void,
  ): Promise<T> {
    let failures = 0;
    for (;;) {
      try {
        return await send();
      } catch (errorValue) {
        const error = requestError(errorValue);
        if (signal.aborted || (error.status && error.status < 500)) throw error;
        onRetry?.();
        await this.wait(signal, Math.min(this.pollInterval * 2 ** Math.min(failures++, 3), 5000));
        if (this.token !== token || this.generation !== generation)
          throw walletermError('conflict', 'The website connection changed. Build a new transaction.');
      }
    }
  }
  /** The selected account, network, and signer for one request. Defaults follow SEP-43. */
  signer({ address, networkPassphrase }: Pick<SignOptions, 'address' | 'networkPassphrase'>) {
    const selected = this.account;
    if (!selected?.address || !this.token || this.selecting)
      throw walletermError('not_connected', 'Connect and select a wallet first.');
    const passphrase = networkPassphrase ?? selected.networkPassphrase;
    if (passphrase !== selected.networkPassphrase)
      throw walletermError('network_unsupported', 'Walleterm signs only on Stellar testnet.');
    if (address != null && address !== selected.address)
      throw walletermError('address_mismatch', 'The requested signer differs from the selected account.');
    return { address: selected.address, networkPassphrase: passphrase };
  }
  // An abort, a rejection, or leaving the page cancels the bridge request. Build a new transaction to try again.
  // error.canceled reports cancellation or lost session access. It does not prove that signing stopped.
  // requestState stays unknown when cancellation cannot determine whether a signature was produced.
  async signTransaction(transactionXdr: string, options: SignOptions = {}) {
    const { address, networkPassphrase } = this.signer(options);
    inspectTransactionRequest(transactionXdr, address, networkPassphrase);
    const signed = await this.signArtifact(
      { kind: 'transaction', xdr: transactionXdr },
      { ...options, address, networkPassphrase },
    );
    try {
      verifyTransactionSignature(transactionXdr, signed, address, networkPassphrase);
    } catch (error) {
      throw unverifiedResult(error);
    }
    return { signedTxXdr: signed, signerAddress: address };
  }
  /** SEP-43: sign SHA-256 of an address-bound authorization preimage. Returns Base64 signature bytes. */
  async signAuthEntry(preimageXdr: string, options: SignOptions = {}) {
    const { address, networkPassphrase } = this.signer(options);
    const { digest } = inspectAuthPreimage(preimageXdr, address, networkPassphrase);
    const signed = await this.signArtifact(
      { kind: 'auth_entry', preimage_xdr: preimageXdr },
      { ...options, address, networkPassphrase },
    );
    try {
      verifyPreimageSignature(digest, address, signed);
    } catch (error) {
      throw unverifiedResult(error);
    }
    return { signedAuthEntry: signed, signerAddress: address };
  }
  /** Walleterm extension: sign a complete AddressV2 entry through an adapter. */
  async signAuthorization(authEntryXdr: string, options: AuthSignOptions) {
    const { address: signer, networkPassphrase } = this.signer({
      networkPassphrase: options.networkPassphrase,
    });
    const input = {
      auth_entry_xdr: authEntryXdr,
      address: options.address,
      adapter: structuredClone(options.adapter ?? { type: 'account' as const }),
      public_key: signer,
      network_passphrase: networkPassphrase,
    };
    // Local verification checks exact artifacts. Only the bridge supplies trusted current-ledger evidence.
    const expiration = addressCredentials(parseAuthEntry(authEntryXdr)).signatureExpirationLedger;
    const structuralLedger = Math.max(1, expiration - 60);
    inspectAuthEntry(input, signer, structuralLedger);
    const signed = await this.signArtifact(
      {
        kind: 'authorization',
        auth_entry_xdr: input.auth_entry_xdr,
        auth_address: input.address,
        adapter: input.adapter,
      },
      { signal: options.signal, onProgress: options.onProgress, address: signer, networkPassphrase },
    );
    try {
      verifyAuthEntrySignature(input, signed, structuralLedger);
    } catch (error) {
      throw unverifiedResult(error);
    }
    return { signedAuthEntryXdr: signed, signerAddress: signer };
  }

  private async signArtifact(
    artifact: Artifact,
    {
      networkPassphrase,
      address,
      signal = AbortSignal.timeout(300000),
      onProgress,
    }: {
      networkPassphrase: string;
      address: string;
      signal?: AbortSignal;
      onProgress?: SignOptions['onProgress'];
    },
  ) {
    const token = this.token;
    if (!token || !this.account?.address || this.selecting)
      throw walletermError('not_connected', 'Connect and select a wallet first.');
    const generation = this.generation,
      revision = this.revision;
    const id = crypto.randomUUID(),
      cancel = `/v1/requests/${id}/cancel` as const,
      stop = new AbortController();
    signal = AbortSignal.any([signal, stop.signal]);
    this.signings.add(stop);
    const leave = () => {
      stop.abort(Error('The page closed.'));
      this.request(cancel, {}, undefined, { keepalive: true, token }).catch(() => {});
    };
    this.page?.addEventListener?.('pagehide', leave);
    // Observers must not interrupt signing or alter cancellation behavior.
    const notify = (progress: Progress) => {
      try {
        onProgress?.(progress);
      } catch {
        /* Ignore display errors. */
      }
    };
    const retrying = () => notify({ state: 'retrying' });
    let result: RequestResult;
    // A create attempt that failed without a definitive answer can still have reached the bridge.
    let created = false,
      uncertain = false;
    try {
      // The bridge returns the same request for a repeated ID, so a lost response is safe to resend.
      result = await this.retry(
        () =>
          this.request(
            '/v1/requests',
            {
              id,
              ...artifact,
              network_passphrase: networkPassphrase,
              address,
              ...(this.walletScope === 'available' ? { selection_revision: revision } : {}),
            },
            signal,
            { token },
          ),
        signal,
        token,
        generation,
        () => {
          uncertain = true;
          retrying();
        },
      );
      created = true;
      notify({ state: result.state, expiresAt: result.expires_at });
      while (['pending', 'approved', 'signing'].includes(result.state)) {
        await this.wait(signal);
        result = await this.retry(
          () => this.request(`/v1/requests/${id}`, undefined, signal, { token }),
          signal,
          token,
          generation,
          retrying,
        );
        notify({ state: result.state, expiresAt: result.expires_at });
      }
      signal.throwIfAborted();
      if (this.token !== token || this.generation !== generation || this.revision !== revision)
        throw walletermError('conflict', 'The wallet selection changed. Build a new transaction.');
    } catch (caught) {
      const error = requestError(caught);
      // A 4xx answer to the first create attempt proves that the bridge created no request.
      if (!created && !uncertain && error.status && error.status >= 400 && error.status < 500) {
        // A 409 means that another tab changed the wallet. This request fails. The next one uses the new wallet.
        if (error.status === 409 && this.walletScope === 'available')
          await this.readAccount(token, generation).catch(() => {});
        throw error;
      }
      error.canceled = false;
      const cancellation = AbortSignal.timeout(10000);
      for (let attempt = 0; attempt < 3 && !error.canceled && !cancellation.aborted; attempt++) {
        try {
          const canceled = await this.request(cancel, {}, cancellation, { token });
          error.canceled = true;
          if (canceled.state === 'unknown') error.requestState = 'unknown';
        } catch (value) {
          const cancelError = requestError(value);
          if (cancelError.status === 401) {
            error.canceled = true;
            error.requestState = 'unknown';
          }
        }
      }
      throw error;
    } finally {
      this.signings.delete(stop);
      this.page?.removeEventListener?.('pagehide', leave);
    }
    if (result.state !== 'signed') {
      const bridge = result.error;
      throw Object.assign(Error(bridge?.message || `The signing request is ${result.state}.`), {
        requestState: result.state,
        ...(bridge && typeof bridge.code === 'number' ? { code: bridge.code, ext: bridge.ext } : {}),
      });
    }
    const signed = result[resultField[artifact.kind]];
    if (typeof signed !== 'string') throw unverifiedResult(Error('The bridge returned no signed artifact.'));
    return signed;
  }
  async disconnect() {
    const token = this.token;
    if (token) {
      try {
        await this.request('/v1/disconnect', {}, undefined, { token });
      } catch (errorValue) {
        const error = requestError(errorValue);
        if (error.status !== 401) throw error;
      }
      // A slow disconnect must not clear a newer connection.
      if (this.token === token) {
        this.forgetConnection();
      }
    }
  }
  // Local discard cannot prove that the bridge revoked its session.
  forgetConnection() {
    this.token = null;
    this.generation++;
    this.selecting = false;
    this.selectionUncertain = null;
    for (const stop of this.signings) stop.abort(Error('The website disconnected.'));
    this.setAccount(null);
  }
}

/** A SEP-43 result. As in Freighter, a failure returns empty strings and `error`. */
export type Result<T> = T & { error?: Sep43Error };
export interface SignRequestOptions extends SignalOptions {
  networkPassphrase?: string;
  address?: string;
  onProgress?: (progress: Progress) => void;
}
export interface AddressChange {
  address: string | null;
  network: 'TESTNET';
  networkPassphrase: string;
}
/** The interface that obtains access. `WalletermConnect` implements it. */
export interface AccessInterface {
  requestAccess(wallet: Walleterm): Promise<string>;
}
export interface WalletermOptions extends ClientOptions {
  walletScope?: WalletScope;
  /** The `localStorage` key that the website's tabs share. `null` keeps credentials in memory only. */
  storageKey?: string | null;
  ui?: AccessInterface | null;
}
async function settle<T extends Record<string, string>>(
  empty: T,
  work: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return await work();
  } catch (error) {
    return { ...empty, error: sep43Error(error) };
  }
}
const emptyAddress = { address: '' },
  emptyTransaction = { signedTxXdr: '', signerAddress: '' },
  emptyAuthEntry = { signedAuthEntry: '', signerAddress: '' };
async function defaultInterface(wallet: Walleterm): Promise<AccessInterface> {
  if (typeof document === 'undefined')
    throw walletermError('not_connected', 'Walleterm needs a page with a document to connect.');
  const { WalletermConnect } = await import('./connect.js');
  const host = document.createElement('div');
  document.body.append(host);
  return new WalletermConnect(host, { wallet, header: false });
}

/**
 * SEP-43 wallet. The five SEP-43 methods resolve results and never reject.
 * Native methods manage pairing, switching, and disconnection. They throw `WalletermError`.
 */
export class Walleterm {
  readonly walletScope: WalletScope;
  readonly storageKey: string | null;
  readonly clientOptions: ClientOptions;
  ui: AccessInterface | null;
  client: WalletermClient | null = null;
  #listeners = new Set<(change: AddressChange) => void>();
  // `undefined` means that listeners have no state yet. The next confirmed state is then a change.
  #published: string | null | undefined = null;
  #restored = false;
  // The saved token that this tab last read or wrote. This tab changes only that saved session.
  #token: string | null = null;
  #queued = false;
  #adopting = 0;
  #access?: Promise<string>;
  constructor({
    walletScope = 'selected',
    storageKey = 'walleterm:session',
    ui = null,
    ...clientOptions
  }: WalletermOptions = {}) {
    if (!['selected', 'available'].includes(walletScope))
      throw walletermError('invalid_request', 'The wallet scope is invalid.');
    this.walletScope = walletScope;
    this.storageKey = storageKey;
    this.ui = ui;
    this.clientOptions = clientOptions;
    // The website's tabs share one session. Another tab's change arrives as a storage event.
    const page = clientOptions.page === undefined ? globalThis : clientOptions.page;
    if (storageKey) page?.addEventListener?.('storage', (event) => this.#follow(event as StorageEvent));
  }
  /** The selected G-address, or an empty string. The Stellar SDK contract client reads this property. */
  get address(): string {
    return (this.client?.token && this.client.account?.address) || '';
  }
  get url(): string | null {
    return this.client?.url ?? null;
  }
  /** Report each address change. A disconnection reports `null`. */
  onChange(listener: (change: AddressChange) => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
  #publish() {
    // Report a confirmed address or an ended session. An account that awaits confirmation is not a change.
    if (this.client?.token && !this.client.account?.address) return;
    const address = this.address || null;
    if (address === this.#published) return;
    this.#published = address;
    for (const listener of this.#listeners)
      try {
        listener({ address, network: 'TESTNET', networkPassphrase: Networks.TESTNET });
      } catch {
        /* Observers must not change the connection. */
      }
  }
  #storage(): Storage | null {
    try {
      return this.storageKey ? globalThis.localStorage : null;
    } catch {
      return null;
    }
  }
  // `revision` only tells other tabs that the wallet changed. They read the selection from the bridge.
  #save() {
    const storage = this.#storage();
    if (!storage) return;
    try {
      // A tab that missed a storage event can hold an old session. It follows the saved state instead:
      // a newer session, or none when another tab discarded it. Unreadable storage proves nothing.
      const saved = this.#savedToken(storage);
      if (saved !== undefined && saved !== this.#token) return this.#sync();
      const client = this.client;
      if (client?.token && client.account?.address) {
        storage.setItem(
          this.storageKey!,
          JSON.stringify({ version: 3, url: client.url, token: client.token, revision: client.revision }),
        );
        this.#token = client.token;
      } else if (!client?.token) {
        storage.removeItem(this.storageKey!);
        this.#token = null;
      }
    } catch {
      /* Unavailable storage leaves the connection in memory. */
    }
  }
  /** The token of a well-formed saved session, null for none, or undefined when storage cannot be read. */
  #savedToken(storage: Storage): string | null | undefined {
    let saved;
    try {
      saved = storage.getItem(this.storageKey!);
    } catch {
      return undefined;
    }
    try {
      const value = JSON.parse(saved ?? 'null');
      return value?.version === 3 && /^[A-Za-z0-9_-]{43}$/.test(value.token) ? (value.token as string) : null;
    } catch {
      return null;
    }
  }
  /** A client for the saved session, without an account. An invalid value is removed. */
  #load(storage: Storage) {
    try {
      const saved = storage.getItem(this.storageKey!);
      if (!saved) return null;
      const value = JSON.parse(saved);
      if (
        value?.version !== 3 ||
        typeof value.url !== 'string' ||
        typeof value.token !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.token)
      )
        throw Error('The saved connection is invalid.');
      const client = new WalletermClient(value.url, this.clientOptions);
      client.token = value.token;
      client.walletScope = this.walletScope;
      client.revision = null;
      return { client, revision: value.revision };
    } catch {
      try {
        storage.removeItem(this.storageKey!);
      } catch {
        /* Storage can fail. */
      }
      return null;
    }
  }
  #use(client: WalletermClient | null) {
    if (this.client && this.client !== client) this.client.onAccountChange = undefined;
    this.client = client;
    if (client)
      client.onAccountChange = () => {
        if (this.client !== client) return;
        this.#save();
        // Publish after the client operation settles. A listener can then read the account at once.
        if (this.#queued) return;
        this.#queued = true;
        queueMicrotask(() => {
          this.#queued = false;
          this.#publish();
        });
      };
    this.#save();
    this.#publish();
  }
  /** Load a saved session once. The bridge, not storage, supplies its account, scope, and revision. */
  restore() {
    if (this.#restored) return;
    this.#restored = true;
    const storage = this.#storage();
    if (!storage || this.client) return;
    const saved = this.#load(storage);
    if (!saved) return;
    this.#token = saved.client.token;
    this.#use(saved.client);
    // A Kit can show the saved address already. Report the confirmed state, even a disconnection.
    this.#published = undefined;
  }
  // Follow another tab. It paired a new session, changed the wallet, or ended the session.
  #follow(event: StorageEvent) {
    // `localStorage.clear()` reports a null key.
    if (event.key === null || event.key === this.storageKey) this.#sync();
  }
  #sync() {
    // A pairing in this tab writes the next session. Other tabs then follow it.
    if (this.#adopting) return;
    const storage = this.#storage();
    if (!storage) return;
    this.#restored = true;
    const saved = this.#load(storage),
      client = this.client;
    if (!saved) {
      this.#token = null;
      if (client) this.forgetConnection();
    } else if (client?.token === saved.client.token && client.url === saved.client.url) {
      this.#token = saved.client.token;
      if (!client.account?.address || client.revision !== saved.revision) client.getAccount().catch(() => {});
    } else {
      // The other tab revoked or discarded the previous session. Confirm the new one before publishing it.
      if (client) {
        client.onAccountChange = undefined;
        client.forgetConnection();
      }
      this.#token = saved.client.token;
      this.#use(saved.client);
      saved.client.getAccount().catch(() => {});
    }
  }
  /** Use a newly paired session. The previous session is revoked, or discarded when revocation fails. */
  async adopt(next: WalletermClient, { signal }: SignalOptions = {}) {
    if (!next.token || !next.account?.address)
      throw walletermError('not_connected', 'Select a wallet before using this connection.');
    signal?.throwIfAborted();
    const previous = this.client;
    let previousRevoked = true;
    if (previous && previous !== next) {
      previous.onAccountChange = undefined;
      // Other tabs can report the end of the previous session meanwhile. That report is not a disconnection here.
      this.#adopting++;
      try {
        await previous.disconnect();
      } catch {
        previous.forgetConnection();
        previousRevoked = false;
      } finally {
        this.#adopting--;
      }
      // Revoking the previous session can take a while. A canceled pairing then keeps no session.
      if (signal?.aborted) {
        if (this.client === previous) this.#use(null);
        signal.throwIfAborted();
      }
    }
    this.#restored = true;
    // A new pairing in this tab replaces any saved session.
    const storage = this.#storage();
    if (storage) this.#token = this.#savedToken(storage) ?? null;
    this.#use(next);
    return { address: next.account.address, previousRevoked };
  }
  /** Pair a tunnel without the dialog. A failure keeps the current session. */
  async connect({
    url,
    code,
    selectWallet,
    signal,
  }: {
    url: string;
    code: string;
    selectWallet: WalletPicker;
    signal?: AbortSignal;
  }) {
    const next = new WalletermClient(url, this.clientOptions);
    await next.connect({ code, selectWallet, walletScope: this.walletScope, signal });
    return this.adopt(next, { signal });
  }
  /** Open the access interface once, even for concurrent callers. */
  requestAccess() {
    this.#access ??= (async () => (this.ui ?? (await defaultInterface(this))).requestAccess(this))().finally(
      () => (this.#access = undefined),
    );
    return this.#access;
  }
  #connected() {
    this.restore();
    const client = this.client;
    if (!client?.token) throw walletermError('not_connected', 'Connect Walleterm first.');
    return client;
  }
  async #ready(options: SignRequestOptions) {
    if ((options.networkPassphrase ?? Networks.TESTNET) !== Networks.TESTNET)
      throw walletermError(
        'network_unsupported',
        'Walleterm signs only on Stellar testnet. Use Networks.TESTNET.',
      );
    const client = this.#connected();
    if (!client.account?.address) await client.getAccount();
    return client;
  }

  // SEP-43 methods.
  getAddress({ skipRequestAccess = false }: { skipRequestAccess?: boolean } = {}) {
    return settle(emptyAddress, async () => {
      this.restore();
      // The address of a session, or null when it has none. A 401 ends a session and is not an error here.
      const read = async (client: WalletermClient) => {
        try {
          return (await client.getAccount()).address || null;
        } catch (errorValue) {
          if (requestError(errorValue).status !== 401) throw errorValue;
          return null;
        }
      };
      const client = this.client;
      if (client?.token) {
        let address = await read(client);
        // The tab can follow a newer session that another tab saved. Read that one before opening pairing.
        const next = this.client;
        if (!address && next !== client && next?.token) address = await read(next);
        if (address) return { address };
      }
      if (skipRequestAccess) throw walletermError('not_connected', 'Connect Walleterm first.');
      return { address: await this.requestAccess() };
    });
  }
  signTransaction(xdr: string, options: SignRequestOptions & { submit?: boolean; submitUrl?: string } = {}) {
    return settle(emptyTransaction, async () => {
      if (options.submit || options.submitUrl !== undefined)
        throw walletermError(
          'unsupported',
          'Walleterm does not submit transactions. Submit the signed transaction.',
        );
      const client = await this.#ready(options);
      return client.signTransaction(xdr, options);
    });
  }
  signAuthEntry(authEntry: string, options: SignRequestOptions = {}) {
    return settle(emptyAuthEntry, async () => (await this.#ready(options)).signAuthEntry(authEntry, options));
  }
  signMessage(_message: string, _options: SignRequestOptions = {}) {
    return settle({ signedMessage: '', signerAddress: '' }, async () => {
      throw walletermError('unsupported', 'Walleterm does not sign messages yet. See docs/SEP-43.md.');
    });
  }
  getNetwork() {
    return settle({ network: '', networkPassphrase: '' }, async () => ({
      network: 'TESTNET',
      networkPassphrase: Networks.TESTNET,
    }));
  }

  // Walleterm extensions.
  signAuthorization(authEntryXdr: string, options: AuthSignOptions) {
    return settle({ signedAuthEntryXdr: '', signerAddress: '' }, async () =>
      (await this.#ready(options)).signAuthorization(authEntryXdr, options),
    );
  }
  async listWallets(options: SignalOptions = {}): Promise<Signer[]> {
    return this.#connected().listWallets(options);
  }
  async selectWallet(publicKey: string, options: SignalOptions = {}) {
    return this.#connected().selectWallet(publicKey, options);
  }
  async disconnect() {
    this.restore();
    const client = this.client;
    if (!client) return;
    // Publish one disconnection after revocation, not an intermediate expiry.
    client.onAccountChange = undefined;
    try {
      await client.disconnect();
    } catch (error) {
      if (this.client === client) this.#use(client);
      throw error;
    }
    if (this.client === client) this.#use(null);
  }
  forgetConnection() {
    const client = this.client;
    if (!client) return;
    client.onAccountChange = undefined;
    client.forgetConnection();
    if (this.client === client) this.#use(null);
  }
}
