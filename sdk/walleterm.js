// Browser adapter for Walleterm bridge protocol v2. Credentials remain in memory.
export class WalletermClient {
  constructor(bridgeUrl, { fetch: fetcher = globalThis.fetch.bind(globalThis), pollInterval = 1000, page = globalThis } = {}) {
    const url = new URL(bridgeUrl);
    if (url.origin !== bridgeUrl || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('Use the public bridge origin, without a path.');
    this.url = url.origin; this.fetch = fetcher; this.pollInterval = pollInterval; this.page = page; this.token = null; this.account = null; this.walletScope = 'selected'; this.revision = 0; this.generation = 0; this.signings = new Set();
  }
  async request(path, data, signal, { keepalive = false, token = this.token } = {}) {
    const timeout = ['/v1/signers', '/v1/select'].includes(path) ? 135000 : 15000;
    const response = await this.fetch(`${this.url}${path}`, {
      method: data === undefined ? 'GET' : 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
      headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), keepalive,
    });
    let result;
    try { result = await response.json(); }
    catch { throw Object.assign(Error(`The bridge returned an unreadable response (${response.status}).`), { status: response.status }); }
    if (!response.ok) {
      // An old response must not clear a newer connection.
      if (response.status === 401 && this.token === token) { this.token = null; this.account = null; }
      throw Object.assign(Error(result.error?.message || `Bridge request failed (${response.status}).`), { status: response.status });
    }
    return result;
  }
  async wait(signal) {
    signal.throwIfAborted();
    await new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, this.pollInterval);
      signal.addEventListener('abort', stop, { once: true });
    });
  }
  async connect({ code, selectWallet, walletScope = 'selected', signal = AbortSignal.timeout(300000) } = {}) {
    if (!['selected', 'available'].includes(walletScope)) throw Error('The wallet scope is invalid.');
    if (typeof selectWallet !== 'function') throw Error('Provide a wallet picker.');
    if (this.token) {
      try { const account = await this.getAddress(); if (account.address) return account; }
      catch (error) { if (error.status !== 401) throw error; }
    }
    if (!this.token) {
      if (typeof code !== 'string' || !/^\d{8}$/.test(code)) throw Error('Enter the eight-digit code from the tunnel terminal.');
      const result = await this.request('/v1/connect', { code, ...(walletScope === 'available' ? { wallet_scope: walletScope } : {}) }, signal);
      this.token = result.token; this.account = null; this.selecting = false; this.selectionUncertain = null; this.walletScope = walletScope; this.revision = 0; this.generation++;
      if (walletScope === 'available' && result.wallet_scope !== walletScope) { await this.disconnect().catch(() => {}); throw Error('This bridge does not support wallet switching. Update the bridge.'); }
    }
    try {
      const signers = await this.listWallets({ signal });
      const publicKey = await selectWallet(signers, { signal });
      signal.throwIfAborted();
      const result = await this.selectWallet(publicKey, { signal });
      this.account = result;
      return { ...this.account };
    } catch (error) { await this.disconnect().catch(() => {}); this.token = null; this.account = null; throw error; }
  }
  async listWallets({ signal } = {}) {
    if (!this.token) throw Error('Connect the website first.');
    const token = this.token, generation = this.generation;
    const { signers, grant_id } = await this.request('/v1/signers', undefined, signal, { token });
    if (token !== this.token || generation !== this.generation) throw Error('The website connection changed.');
    this.grant = grant_id;
    return signers;
  }
  async selectWallet(publicKey, { signal } = {}) {
    if (!this.token) throw Error('Connect the website first.');
    if (this.selecting) throw Error('A wallet selection is already in progress.');
    if (this.selectionUncertain) throw Error('Recover the account or reconnect before changing wallets.');
    if (this.account?.address === publicKey) return { ...this.account };
    if (this.account && this.walletScope !== 'available') throw Error('Connect again with wallet switching enabled.');
    const token = this.token, scoped = this.walletScope === 'available', priorRevision = this.revision;
    this.selecting = true; const generation = ++this.generation;
    for (const stop of this.signings) stop.abort(Error('The active wallet changed.'));
    try {
      const result = await this.request('/v1/select', { public_key: publicKey,
        ...(scoped ? { expected_revision: this.revision, ...(this.revision === 0 ? { grant_id: this.grant } : {}) } : {}) }, signal, { token });
      if (token !== this.token || generation !== this.generation) throw Error('The website connection changed.');
      if (scoped && (!Number.isSafeInteger(result.selection_revision) || result.selection_revision < 1)) throw Error('The bridge returned an invalid wallet selection.');
      this.selectionUncertain = null; this.revision = result.selection_revision; this.account = { address: result.public_key, networkPassphrase: result.network_passphrase };
      return { ...this.account };
    } catch (error) {
      // Selection can succeed while its response is lost. Reconcile before permitting another signature.
      if (token === this.token && generation === this.generation) {
        this.account = null; this.revision = null;
        this.selectionUncertain = !error.status || error.status >= 500 ? { revision: priorRevision, publicKey } : null;
        try { await this.readAccount(token, generation); } catch { /* Keep signing disabled until account recovery succeeds. */ }
      }
      throw error;
    } finally { if (generation === this.generation) this.selecting = false; }
  }
  async getAddress() {
    if (this.selecting) throw Error('Wait for the wallet selection to finish.');
    return this.readAccount(this.token, this.generation);
  }
  async readAccount(token, generation) {
    const result = await this.request('/v1/account', undefined, undefined, { token });
    if (token !== this.token || generation !== this.generation) throw Error('The website connection changed.');
    if (this.walletScope === 'available' && (!Number.isSafeInteger(result.selection_revision) || result.selection_revision < 0)) throw Error('The bridge returned an invalid wallet selection.');
    if (Number.isSafeInteger(this.revision) && result.selection_revision < this.revision) throw Error('The wallet account response is stale.');
    if (this.selectionUncertain && (result.selection_revision <= this.selectionUncertain.revision || result.public_key !== this.selectionUncertain.publicKey)) throw Error('The wallet selection is not confirmed. Reconnect or recover the account later.');
    this.selectionUncertain = null;
    this.revision = result.selection_revision; this.walletScope = result.wallet_scope || this.walletScope;
    this.account = { address: result.public_key, networkPassphrase: result.network_passphrase };
    return { ...this.account };
  }
  // Retry after a network error or a 5xx response. Stop when the connection changes.
  async retry(send, signal, token, generation) {
    for (;;) {
      try { return await send(); }
      catch (error) {
        if (signal.aborted || (error.status && error.status < 500)) throw error;
        await this.wait(signal);
        if (this.token !== token || this.generation !== generation) throw Error('The website connection changed. Build a new transaction.');
      }
    }
  }
  // Address and network default to the connected account, as in SEP-43.
  // An abort, a rejection, or leaving the page cancels the bridge request. Build a new transaction to try again.
  // error.canceled reports cancellation or lost session access. It does not prove that signing stopped.
  // requestState stays unknown when cancellation cannot determine whether a signature was produced.
  async signTransaction(transactionXdr, { networkPassphrase = this.account?.networkPassphrase, address = this.account?.address, signal = AbortSignal.timeout(300000) } = {}) {
    const token = this.token;
    if (!token || !this.account?.address || this.selecting) throw Error('Connect and select a wallet first.');
    const generation = this.generation, revision = this.revision;
    const id = crypto.randomUUID(), cancel = `/v1/requests/${id}/cancel`, stop = new AbortController();
    signal = AbortSignal.any([signal, stop.signal]); this.signings.add(stop);
    const leave = () => {
      stop.abort(Error('The page closed.'));
      this.request(cancel, {}, undefined, { keepalive: true, token }).catch(() => {});
    };
    this.page?.addEventListener?.('pagehide', leave);
    let result;
    try {
      // The bridge returns the same request for a repeated ID, so a lost response is safe to resend.
      result = await this.retry(() => this.request('/v1/requests', { id, transaction_xdr: transactionXdr, network_passphrase: networkPassphrase, public_key: address, ...(this.walletScope === 'available' ? { selection_revision: revision } : {}) }, signal, { token }), signal, token, generation);
      while (['pending', 'approved', 'signing'].includes(result.state)) {
        await this.wait(signal); result = await this.retry(() => this.request(`/v1/requests/${id}`, undefined, signal, { token }), signal, token, generation);
      }
      signal.throwIfAborted();
      if (this.token !== token || this.generation !== generation) throw Error('The wallet selection changed. Build a new transaction.');
    } catch (caught) {
      const error = caught instanceof Error ? caught : Error(String(caught));
      error.canceled = false;
      for (let attempt = 0; attempt < 3 && !error.canceled; attempt++) {
        try { const canceled = await this.request(cancel, {}, undefined, { token }); error.canceled = true;
          if (canceled.state === 'unknown') error.requestState = 'unknown'; }
        catch (cancelError) { if (cancelError.status === 401) { error.canceled = true; error.requestState = 'unknown'; } }
      }
      throw error;
    } finally { this.signings.delete(stop); this.page?.removeEventListener?.('pagehide', leave); }
    if (result.state !== 'signed') throw Object.assign(Error(result.message || `The signing request is ${result.state}.`), { requestState: result.state });
    return { signedTxXdr: result.signed_xdr, signerAddress: address };
  }
  async disconnect() {
    const token = this.token;
    if (token) {
      try { await this.request('/v1/disconnect', {}, undefined, { token }); } catch (error) { if (error.status !== 401) throw error; }
      // A slow disconnect must not clear a newer connection.
      if (this.token === token) { this.token = null; this.account = null; this.generation++; this.selecting = false;
        for (const stop of this.signings) stop.abort(Error('The website disconnected.')); }
    }
  }
}
