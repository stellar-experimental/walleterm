// Browser adapter for Walleterm bridge protocol v2. Credentials remain in memory.
export class WalletermClient {
  constructor(bridgeUrl, { fetch: fetcher = globalThis.fetch.bind(globalThis), pollInterval = 1000, page = globalThis } = {}) {
    const url = new URL(bridgeUrl);
    if (url.origin !== bridgeUrl || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('Use the public bridge origin, without a path.');
    this.url = url.origin; this.fetch = fetcher; this.pollInterval = pollInterval; this.page = page; this.token = null; this.account = null;
  }
  async request(path, data, signal, { keepalive = false, token = this.token } = {}) {
    const response = await this.fetch(`${this.url}${path}`, {
      method: data === undefined ? 'GET' : 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
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
  async connect({ code, selectWallet, signal = AbortSignal.timeout(300000) } = {}) {
    if (typeof selectWallet !== 'function') throw Error('Provide a wallet picker.');
    if (this.token) {
      try { const account = await this.getAddress(); if (account.address) return account; }
      catch (error) { if (error.status !== 401) throw error; }
    }
    if (!this.token) {
      if (typeof code !== 'string' || !/^\d{8}$/.test(code)) throw Error('Enter the eight-digit code from the tunnel terminal.');
      const result = await this.request('/v1/connect', { code }, signal);
      this.token = result.token;
    }
    try {
      const { signers } = await this.request('/v1/signers', undefined, signal);
      if (!signers.length) throw Error('No Ed25519 wallets are available. Check the 1Password SSH agent on your Mac.');
      const publicKey = await selectWallet(signers, { signal });
      signal.throwIfAborted();
      const result = await this.request('/v1/select', { public_key: publicKey }, signal);
      this.account = { address: result.public_key, networkPassphrase: result.network_passphrase };
      return { ...this.account };
    } catch (error) { await this.disconnect().catch(() => {}); this.token = null; this.account = null; throw error; }
  }
  async getAddress() {
    const result = await this.request('/v1/account');
    this.account = { address: result.public_key, networkPassphrase: result.network_passphrase };
    return { ...this.account };
  }
  // Retry after a network error or a 5xx response. Stop when the connection changes.
  async retry(send, signal, token) {
    for (;;) {
      try { return await send(); }
      catch (error) {
        if (signal.aborted || (error.status && error.status < 500)) throw error;
        await this.wait(signal);
        if (this.token !== token) throw Error('The website connection changed. Build a new transaction.');
      }
    }
  }
  // Address and network default to the connected account, as in SEP-43.
  // An abort, a rejection, or leaving the page cancels the bridge request. Build a new transaction to try again.
  // error.canceled is false when the bridge did not confirm the cancellation.
  async signTransaction(transactionXdr, { networkPassphrase = this.account?.networkPassphrase, address = this.account?.address, signal = AbortSignal.timeout(300000) } = {}) {
    const token = this.token;
    if (!token) throw Error('Connect the website first.');
    const id = crypto.randomUUID(), cancel = `/v1/requests/${id}/cancel`, stop = new AbortController();
    signal = AbortSignal.any([signal, stop.signal]);
    const leave = () => {
      stop.abort(Error('The page closed.'));
      this.request(cancel, {}, undefined, { keepalive: true, token }).catch(() => {});
    };
    this.page?.addEventListener?.('pagehide', leave);
    let result;
    try {
      // The bridge returns the same request for a repeated ID, so a lost response is safe to resend.
      result = await this.retry(() => this.request('/v1/requests', { id, transaction_xdr: transactionXdr, network_passphrase: networkPassphrase, public_key: address }, signal, { token }), signal, token);
      while (['pending', 'approved', 'signing'].includes(result.state)) {
        await this.wait(signal); result = await this.retry(() => this.request(`/v1/requests/${id}`, undefined, signal, { token }), signal, token);
      }
    } catch (caught) {
      const error = caught instanceof Error ? caught : Error(String(caught));
      error.canceled = false;
      for (let attempt = 0; attempt < 3 && !error.canceled; attempt++) {
        try { await this.request(cancel, {}, undefined, { token }); error.canceled = true; }
        catch (cancelError) { if (cancelError.status === 401) error.canceled = true; }
      }
      throw error;
    } finally { this.page?.removeEventListener?.('pagehide', leave); }
    if (result.state !== 'signed') throw Object.assign(Error(result.message || `The signing request is ${result.state}.`), { requestState: result.state });
    return { signedTxXdr: result.signed_xdr, signerAddress: address };
  }
  async disconnect() {
    const token = this.token;
    if (token) {
      try { await this.request('/v1/disconnect', {}, undefined, { token }); } catch (error) { if (error.status !== 401) throw error; }
      // A slow disconnect must not clear a newer connection.
      if (this.token === token) { this.token = null; this.account = null; }
    }
  }
}
