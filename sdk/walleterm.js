// Browser adapter for Walleterm bridge protocol v2. Credentials remain in memory.
export class WalletermClient {
  constructor(bridgeUrl, { fetch: fetcher = globalThis.fetch.bind(globalThis), pollInterval = 1000 } = {}) {
    const url = new URL(bridgeUrl);
    if (url.origin !== bridgeUrl || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('Use the public bridge origin, without a path.');
    this.url = url.origin; this.fetch = fetcher; this.pollInterval = pollInterval; this.token = null; this.connectionId = null; this.account = null;
  }
  async request(path, data, signal) {
    const response = await this.fetch(`${this.url}${path}`, {
      method: data === undefined ? 'GET' : 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { this.token = null; this.connectionId = null; this.account = null; }
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
      this.token = result.token; this.connectionId = result.connection_id;
    }
    try {
      const { signers } = await this.request('/v1/signers', undefined, signal);
      if (!signers.length) throw Error('No Ed25519 wallets are available. Check the 1Password SSH agent on your Mac.');
      const publicKey = await selectWallet(signers, { signal });
      signal.throwIfAborted();
      const result = await this.request('/v1/select', { public_key: publicKey }, signal);
      this.account = { address: result.public_key, networkPassphrase: result.network_passphrase };
      return { ...this.account };
    } catch (error) { await this.disconnect().catch(() => {}); this.token = null; this.connectionId = null; this.account = null; throw error; }
  }
  async getAddress() {
    const result = await this.request('/v1/account'); this.connectionId = result.connection_id;
    this.account = { address: result.public_key, networkPassphrase: result.network_passphrase };
    return { ...this.account };
  }
  // Address and network default to the connected account, as in SEP-43.
  // Keep requestId after transport failure. Reuse it only with the exact same XDR.
  async signTransaction(transactionXdr, { networkPassphrase = this.account?.networkPassphrase, address = this.account?.address, requestId = crypto.randomUUID(), onRequest = () => {}, signal = AbortSignal.timeout(300000) } = {}) {
    if (!this.token) throw Error('Connect the website first.');
    try {
      let result = await this.request('/v1/requests', { id: requestId, transaction_xdr: transactionXdr, network_passphrase: networkPassphrase, public_key: address }, signal);
      await onRequest({ requestId, hash: result.hash });
      while (['pending', 'approved', 'signing'].includes(result.state)) {
        await this.wait(signal); result = await this.request(`/v1/requests/${requestId}`, undefined, signal);
      }
      if (result.state !== 'signed') throw Object.assign(Error(result.message || `The signing request is ${result.state}.`), { requestState: result.state });
      return { signedTxXdr: result.signed_xdr, signerAddress: address, requestId, hash: result.hash };
    } catch (error) { error.requestId = requestId; throw error; }
  }
  async cancel(requestId) { return this.request(`/v1/requests/${encodeURIComponent(requestId)}/cancel`, {}); }
  async disconnect() {
    if (this.token) {
      try { await this.request('/v1/disconnect', {}); } catch (error) { if (error.status !== 401) throw error; }
      this.token = null; this.connectionId = null; this.account = null;
    }
  }
}
