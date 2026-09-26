import { requestError } from './errors.js';
import { WalletermClient } from './walleterm.js';
import { scanConnection } from './scan.js';

const short = (address: string) => `${address.slice(0, 7)}…${address.slice(-6)}`;

// Optional connection UI. Transaction construction, review, and submission belong to the host site.
// Load connect.css with this module. All credentials stay in the client instance, in memory.
import type { Account, Signer } from './types.js';

interface ConnectElements {
  url: HTMLInputElement;
  code: HTMLInputElement;
  camera: HTMLVideoElement;
  continue: HTMLButtonElement;
  scan: HTMLButtonElement;
  disconnect: HTMLButtonElement;
  refresh: HTMLButtonElement;
  'retry-wallets': HTMLButtonElement;
  copy: HTMLButtonElement;
}
export interface ConnectionChange {
  client: WalletermClient | null;
  account: Account | null;
}
export interface ConnectUIOptions {
  onChange?: (value: ConnectionChange) => void;
  onBusyChange?: (busy: boolean) => void;
}

export class WalletermConnect {
  element: HTMLElement;
  onChange: (value: ConnectionChange) => void;
  onBusyChange: (busy: boolean) => void;
  client: WalletermClient | null = null;
  account: Account | null = null;
  wallets: Signer[] = [];
  nextWallets: Signer[] = [];
  busy = false;
  working = false;
  phase = '';
  refreshing = false;
  copying = false;
  scanning: AbortController | null = null;
  connection: AbortController | null = null;
  selectingKey: string | null = null;
  trigger: HTMLButtonElement;
  dialog: HTMLDialogElement;
  outside: (event: MouseEvent) => void;
  keyboard: (event: KeyboardEvent) => void;

  $<K extends string>(name: K): K extends keyof ConnectElements ? ConnectElements[K] : HTMLElement {
    const node = this.element.querySelector(`[data-wt="${name}"]`);
    if (!node) throw Error(`Missing connection element: ${name}`);
    // The template above defines the element type for each data-wt name.
    return node as K extends keyof ConnectElements ? ConnectElements[K] : HTMLElement;
  }
  constructor(element: HTMLElement, { onChange = () => {}, onBusyChange = () => {} }: ConnectUIOptions = {}) {
    this.element = element;
    this.onChange = onChange;
    this.onBusyChange = onBusyChange;
    element.classList.add('wt-connect');
    element.innerHTML = `
      <button type="button" class="wt-trigger" aria-haspopup="dialog" aria-expanded="false"><span class="wt-mark" aria-hidden="true">w</span><span data-wt="trigger-label">Connect Walleterm</span><span data-wt="chevron" hidden aria-hidden="true">⌄</span></button>
      <div class="wt-menu" data-wt="menu" hidden role="dialog" aria-label="Wallet connection">
        <div class="wt-menu-heading"><span class="wt-brand">Walleterm</span><span class="wt-network">Testnet</span></div>
        <p class="wt-caption">Active wallet</p><strong data-wt="wallet-name"></strong>
        <button type="button" class="wt-address" data-wt="copy" aria-label="Copy wallet address"><span data-wt="address"></span><span class="wt-copy-label" data-wt="copy-label">Copy address</span></button>
        <div class="wt-menu-section"><div class="wt-list-heading"><span>Your wallets</span><button type="button" class="wt-text-button" data-wt="refresh">Refresh</button></div><div data-wt="wallets" class="wt-wallets"></div></div>
        <p class="wt-message" data-wt="menu-status" role="status"></p>
        <div class="wt-tunnel"><span>Connected tunnel</span><span data-wt="tunnel"></span></div>
        <button type="button" class="wt-disconnect" data-wt="disconnect">Disconnect</button>
      </div>
      <dialog class="wt-dialog" aria-labelledby="wt-title">
        <div class="wt-dialog-top"><span class="wt-brand"><span class="wt-mark" aria-hidden="true">w</span>Walleterm</span><button type="button" class="wt-close" data-wt="close" aria-label="Close connection dialog">×</button></div>
        <div class="wt-dialog-body">
          <div class="wt-progress" role="group" aria-label="Connection steps"><span data-wt="step-connect">Connect your Mac</span><span aria-hidden="true">/</span><span data-wt="step-wallet">Choose a wallet</span></div>
          <h2 id="wt-title">Connect Walleterm</h2><p class="wt-description" data-wt="description">Use the tunnel on your Mac to connect a 1Password wallet.</p>
          <form data-wt="form">
            <div class="wt-command"><span>Run on your Mac</span><code>walleterm tunnel</code></div>
            <button type="button" class="wt-scan" data-wt="scan"><span aria-hidden="true">▣</span> Scan tunnel QR code</button>
            <div class="wt-divider">or enter the connection details</div>
            <label class="wt-label">Tunnel URL<input data-wt="url" type="url" placeholder="https://example.trycloudflare.com" autocomplete="off" spellcheck="false" required></label>
            <label class="wt-label">Connection code<input data-wt="code" class="wt-code" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]{8}" maxlength="8" placeholder="12345678" required></label>
            <p class="wt-help" data-wt="details-help">Enter the tunnel URL and eight-digit code, or scan the QR code.</p>
            <button type="submit" class="wt-primary" data-wt="continue" disabled>Continue</button>
          </form>
          <div data-wt="scanner" hidden><video data-wt="camera" autoplay muted playsinline></video><p class="wt-help">Point the camera at the QR code in your tunnel terminal.</p><button type="button" class="wt-secondary" data-wt="stop-scan">Enter details instead</button></div>
          <div data-wt="picker" hidden><div class="wt-wallets" data-wt="choices"></div><button type="button" class="wt-secondary" data-wt="retry-wallets" hidden>Refresh wallets</button></div>
          <p class="wt-message" data-wt="status" role="status"></p>
        </div>
        <div class="wt-dialog-footer"><span aria-hidden="true">◇</span> Keys stay in 1Password on your Mac.</div>
      </dialog>`;
    this.trigger = element.querySelector<HTMLButtonElement>('.wt-trigger')!;
    this.dialog = element.querySelector('dialog')!;
    this.trigger.onclick = () => (this.account ? this.toggleMenu() : this.open());
    this.$('close').onclick = () => this.close();
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const controls = [
        ...this.dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
      ].filter((node) => node.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    });
    this.dialog.addEventListener('click', (event) => {
      const rect = this.dialog.getBoundingClientRect();
      if (
        event.target === this.dialog &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        this.close();
    });
    this.outside = (event) => {
      if (!(event.target instanceof Node && element.contains(event.target))) this.hideMenu();
    };
    this.keyboard = (event) => {
      if (event.key === 'Escape' && !this.$('menu').hidden) {
        this.hideMenu();
        this.trigger.focus();
      }
    };
    document.addEventListener('click', this.outside);
    document.addEventListener('keydown', this.keyboard);
    element.addEventListener('focusout', (event) => {
      if (
        event.relatedTarget &&
        !(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))
      )
        this.hideMenu();
    });
    this.$('url').oninput = this.$('code').oninput = () => this.update();
    this.$('form').onsubmit = (event) => {
      event.preventDefault();
      this.connect();
    };
    this.$('scan').onclick = () => this.scan();
    this.$('stop-scan').onclick = () => this.scanning?.abort();
    this.$('refresh').onclick = () => this.refresh();
    this.$('disconnect').onclick = () => this.disconnect();
    this.$('copy').onclick = async () => {
      if (!this.account || this.copying) return;
      this.copying = true;
      try {
        await navigator.clipboard.writeText(this.account.address!);
        this.message('Address copied.', true);
        this.$('copy-label').textContent = 'Copied ✓';
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch {
        this.message('Copy the address from the button text.', true);
      } finally {
        this.$('copy-label').textContent = 'Copy address';
        this.copying = false;
      }
    };
    this.update();
  }
  message(text: string, menu = false) {
    this.$(menu ? 'menu-status' : 'status').textContent = text;
  }
  loading(node: HTMLElement, active: boolean) {
    node.classList.toggle('wt-loading', !!active);
    node.setAttribute('aria-busy', String(!!active));
  }
  setWorking(working: boolean) {
    const changed = this.working !== working;
    this.working = working;
    this.update();
    if (changed) this.onBusyChange?.(working);
  }
  validDetails() {
    try {
      const raw = this.$('url').value.trim().replace(/\/$/, ''),
        url = new URL(raw);
      return (
        url.origin === raw &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) &&
        /^\d{8}$/.test(this.$('code').value)
      );
    } catch {
      return false;
    }
  }
  setBusy(busy: boolean) {
    this.busy = busy;
    this.update();
  }
  sync() {
    if (this.client && !this.client.token) {
      this.client = null;
      this.account = null;
      this.wallets = [];
      this.hideMenu();
      this.update();
      this.onChange({ client: null, account: null });
    }
  }
  update() {
    const labels: Record<string, string> = {
      connecting: 'Connecting…',
      selecting: 'Selecting wallet…',
      switching: 'Changing wallet…',
      disconnecting: 'Disconnecting…',
      canceling: 'Canceling…',
    };
    this.$('trigger-label').textContent = this.working
      ? labels[this.phase] || 'Connecting…'
      : this.account
        ? short(this.account.address!)
        : 'Connect Walleterm';
    this.$('chevron').hidden = !this.account;
    this.trigger.disabled = this.working || (!this.account && this.busy);
    this.loading(this.trigger, this.working && !this.dialog.open && !!this.$('menu').hidden);
    this.$('details-help').textContent = this.validDetails()
      ? 'Connection details are ready. Select Continue.'
      : 'Enter the tunnel origin without a path and the eight-digit code, or scan the QR code.';
    this.$('continue').disabled = this.busy || this.working || !!this.scanning || !this.validDetails();
    this.$('continue').textContent = this.phase === 'connecting' ? 'Connecting…' : 'Continue';
    this.loading(this.$('continue'), this.phase === 'connecting');
    for (const name of ['url', 'code'] as const) this.$(name).disabled = this.working || !!this.scanning;
    this.$('scan').disabled = this.busy || this.working || !!this.scanning;
    this.$('disconnect').disabled = this.busy || this.working;
    this.$('disconnect').textContent = this.phase === 'disconnecting' ? 'Disconnecting…' : 'Disconnect';
    this.loading(this.$('disconnect'), this.phase === 'disconnecting');
    this.$('refresh').disabled = this.busy || this.working || this.refreshing;
    this.$('refresh').textContent = this.refreshing ? 'Refreshing…' : 'Refresh';
    this.loading(this.$('refresh'), this.refreshing);
    this.$('retry-wallets').disabled = this.phase !== 'choosing';
    this.$('retry-wallets').textContent =
      this.phase === 'loading-wallets' ? 'Finding wallets…' : 'Refresh wallets';
    this.loading(this.$('retry-wallets'), this.phase === 'loading-wallets');
    this.$('copy').disabled = !this.account;
    for (const [selector, picker] of [
      ['.wt-menu .wt-wallet-row', false],
      ['.wt-dialog .wt-wallet-row', true],
    ] as const) {
      this.element.querySelectorAll<HTMLButtonElement>(selector).forEach((row) => {
        const active = !picker && row.title === this.account?.address;
        const selecting = ['selecting', 'switching'].includes(this.phase) && row.title === this.selectingKey;
        row.disabled = picker
          ? this.phase !== 'choosing'
          : this.busy || this.working || this.refreshing || active;
        row.setAttribute('aria-busy', String(selecting));
        if (active) row.setAttribute('aria-current', 'true');
        else row.removeAttribute('aria-current');
        const state = row.querySelector<HTMLElement>('.wt-wallet-state')!;
        state.textContent = selecting ? 'Selecting…' : active ? 'Active' : 'Select';
        this.loading(state, selecting);
      });
    }
    if (this.account) {
      this.$('wallet-name').textContent =
        this.wallets.find((key) => key.public_key === this.account?.address)?.comment || '1Password wallet';
      this.$('address').textContent = this.account.address!;
      this.$('tunnel').textContent = new URL(this.client!.url).host;
    }
  }
  hideMenu() {
    this.$('menu').hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.loading(this.trigger, this.working && !this.dialog.open);
  }
  toggleMenu() {
    if (!this.$('menu').hidden) return this.hideMenu();
    this.$('menu').hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.message(this.busy ? 'Wait for the current action before changing the connection.' : '', true);
    this.$('copy').focus();
    this.refresh();
  }
  rows(target: HTMLElement, keys: Signer[], choose: (key: Signer) => void, active?: string | null) {
    target.replaceChildren();
    for (const key of keys) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'wt-wallet-row';
      const avatar = document.createElement('span');
      avatar.className = 'wt-avatar';
      avatar.textContent = (key.comment || 'W').slice(0, 1).toUpperCase();
      avatar.setAttribute('aria-hidden', 'true');
      const content = document.createElement('span');
      content.className = 'wt-wallet-label';
      const name = document.createElement('strong');
      name.textContent = key.comment || '1Password wallet';
      const address = document.createElement('span');
      address.textContent = short(key.public_key);
      address.title = key.public_key;
      content.append(name, address);
      const state = document.createElement('span');
      state.className = 'wt-wallet-state';
      state.textContent = key.public_key === active ? 'Active' : 'Select';
      if (key.public_key === active) row.setAttribute('aria-current', 'true');
      row.title = key.public_key;
      row.append(avatar, content, state);
      row.onclick = () => choose(key);
      target.append(row);
    }
  }
  async refresh({ quiet = false } = {}) {
    if (!this.client || this.busy || this.working || this.refreshing) return;
    const client = this.client;
    this.refreshing = true;
    this.update();
    if (!quiet) this.message('Refreshing wallets. Unlock 1Password if it asks.', true);
    try {
      const keys = await client.listWallets();
      if (client !== this.client) return;
      this.wallets = keys;
      this.rows(
        this.$('wallets'),
        keys,
        (key) => {
          if (this.busy || this.working || key.public_key === this.account?.address) return;
          this.changeWallet(key);
        },
        this.account?.address,
      );
      if (!quiet || !keys.length)
        this.message(
          keys.length
            ? 'Wallets are up to date.'
            : 'No wallets are available. Check the 1Password SSH agent, then refresh.',
          true,
        );
    } catch (errorValue) {
      const error = requestError(errorValue);
      if (client === this.client) {
        if (!quiet) this.message(error.message, true);
        this.sync();
      }
    } finally {
      this.refreshing = false;
      this.update();
    }
  }
  async changeWallet(key: Signer) {
    if (
      !this.client ||
      this.busy ||
      this.working ||
      this.refreshing ||
      key.public_key === this.account?.address
    )
      return;
    const client = this.client;
    this.phase = 'switching';
    this.selectingKey = key.public_key;
    this.setWorking(true);
    this.message('Changing the active wallet. Unlock 1Password if it asks.', true);
    try {
      const account = await client.selectWallet(key.public_key);
      if (client !== this.client) return;
      this.account = account;
      this.onChange({ client, account: { ...account } });
      this.message('The active wallet changed.', true);
    } catch (errorValue) {
      const error = requestError(errorValue);
      // A lost response can hide a successful change. Publish only the recovered account.
      if (client === this.client) {
        this.account = client.account?.address ? { ...client.account } : null;
        this.onChange({ client: this.account ? client : null, account: this.account });
        this.message(error.message, true);
        this.sync();
        if (!this.account) this.hideMenu();
      }
    } finally {
      this.phase = '';
      this.selectingKey = null;
      this.setWorking(false);
      if (this.account) await this.refresh({ quiet: true });
    }
  }
  open() {
    if (this.busy || this.working) return;
    this.hideMenu();
    this.$('form').hidden = false;
    this.$('picker').hidden = true;
    this.$('scanner').hidden = true;
    this.$('code').value = '';
    this.$('url').value = this.client?.url || this.$('url').value;
    this.element.querySelector('#wt-title')!.textContent = 'Connect Walleterm';
    this.$('description').textContent =
      'Connect your Mac. This website can switch between the wallets you approve in the next step.';
    this.$('step-connect').setAttribute('aria-current', 'step');
    this.$('step-wallet').removeAttribute('aria-current');
    this.message('');
    this.update();
    this.dialog.showModal();
    this.trigger.setAttribute('aria-expanded', 'true');
    this.$('scan').focus({ preventScroll: true });
  }
  close() {
    if (this.connection) this.phase = 'canceling';
    this.connection?.abort(Error('Connection canceled. Use the current code from your tunnel terminal.'));
    this.scanning?.abort();
    this.scanning = null;
    this.$('status').classList.remove('wt-loading');
    this.dialog.close();
    this.trigger.setAttribute('aria-expanded', 'false');
    this.update();
    this.trigger.focus();
  }
  async scan() {
    if (this.scanning || this.working || this.busy) return;
    const controller = new AbortController();
    this.scanning = controller;
    this.$('form').hidden = true;
    this.$('scanner').hidden = false;
    this.$('stop-scan').focus({ preventScroll: true });
    this.update();
    this.$('status').classList.add('wt-loading');
    const ready = () => {
      if (this.scanning === controller) this.message('Camera is ready. Point it at the tunnel QR code.');
    };
    this.$('camera').addEventListener('playing', ready);
    let scanned = false;
    this.message('Allow camera access to scan the tunnel QR code.');
    try {
      const connection = await scanConnection(this.$('camera'), { signal: controller.signal });
      controller.signal.throwIfAborted();
      this.$('url').value = connection.url;
      this.$('code').value = connection.code;
      scanned = true;
      this.message('Connection details are ready. Select Continue.');
    } catch (errorValue) {
      const error = requestError(errorValue);
      if (this.scanning === controller)
        this.message(
          controller.signal.aborted ? '' : `${error.message} Enter the connection details instead.`,
        );
    } finally {
      this.$('camera').removeEventListener('playing', ready);
      if (this.scanning === controller) {
        this.scanning = null;
        this.$('scanner').hidden = true;
        this.$('form').hidden = false;
        this.$('status').classList.remove('wt-loading');
        this.update();
        if (this.dialog.open) this.$(scanned ? 'continue' : 'scan').focus({ preventScroll: true });
      }
    }
  }
  chooseWallet(client: WalletermClient, keys: Signer[], signal: AbortSignal): Promise<string> {
    this.$('form').hidden = true;
    this.$('picker').hidden = false;
    this.element.querySelector('#wt-title')!.textContent = 'Choose a wallet';
    this.$('description').textContent = 'Select a dedicated testnet wallet from 1Password.';
    this.$('step-connect').removeAttribute('aria-current');
    this.$('step-wallet').setAttribute('aria-current', 'step');
    return new Promise<string>((resolve, reject) => {
      const stop = () => {
        this.$('retry-wallets').onclick = null;
        reject(signal.reason);
      };
      signal.addEventListener('abort', stop, { once: true });
      const draw = (values: Signer[]) => {
        this.phase = 'choosing';
        this.nextWallets = values;
        this.rows(this.$('choices'), values, (key) => {
          if (signal.aborted || this.phase !== 'choosing') return;
          this.phase = 'selecting';
          this.selectingKey = key.public_key;
          this.update();
          this.message('Confirming your wallet selection. Unlock 1Password if it asks.');
          signal.removeEventListener('abort', stop);
          this.$('retry-wallets').onclick = null;
          resolve(key.public_key);
        });
        this.message(
          values.length
            ? 'This connection lets the website switch between these wallets and request signatures. New wallets need a new connection.'
            : 'No wallets are available. Check the 1Password SSH agent on your Mac.',
        );
        this.$('retry-wallets').hidden = !!values.length;
        this.update();
        this.$('choices').querySelector('button')?.focus();
      };
      this.$('retry-wallets').onclick = async () => {
        if (signal.aborted || this.phase !== 'choosing') return;
        this.phase = 'loading-wallets';
        this.update();
        this.message('Finding wallets. Unlock 1Password if it asks.');
        try {
          const values = await client.listWallets({ signal });
          if (!signal.aborted) draw(values);
        } catch (errorValue) {
          const error = requestError(errorValue);
          if (!signal.aborted) {
            this.phase = 'choosing';
            this.update();
            this.message(error.message);
          }
        }
      };
      draw(keys);
      if (signal.aborted) stop();
    });
  }
  async connect() {
    if (this.working || this.busy || this.scanning || !this.validDetails()) return;
    this.phase = 'connecting';
    this.setWorking(true);
    const controller = new AbortController();
    this.connection = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]);
    let next: WalletermClient | undefined;
    this.message('Connecting and finding wallets. Unlock 1Password if it asks.');
    try {
      next = new WalletermClient(this.$('url').value.trim().replace(/\/$/, ''));
      const account = await next.connect({
        code: this.$('code').value.trim(),
        walletScope: 'available',
        signal,
        selectWallet: (keys, { signal }) => {
          this.$('code').value = '';
          this.nextWallets = keys;
          return this.chooseWallet(next!, keys, signal);
        },
      });
      signal.throwIfAborted();
      // A failed replacement leaves the current connection usable.
      await this.client?.disconnect();
      signal.throwIfAborted();
      this.client = next;
      this.account = account;
      this.wallets = this.nextWallets || [];
      this.connection = null;
      this.close();
      this.onChange({ client: next, account: { ...account } });
    } catch (errorValue) {
      const error = requestError(errorValue);
      await next?.disconnect().catch(() => {});
      this.$('form').hidden = false;
      this.$('picker').hidden = true;
      this.message(error.message);
      this.sync();
    } finally {
      this.connection = null;
      this.phase = '';
      this.selectingKey = null;
      this.setWorking(false);
      if (!this.dialog.open) this.trigger.focus();
    }
  }
  async disconnect() {
    if (this.busy || this.working || !this.client) return;
    this.phase = 'disconnecting';
    this.setWorking(true);
    this.message('Disconnecting this website.', true);
    try {
      await this.client.disconnect();
      this.client = null;
      this.account = null;
      this.wallets = [];
      this.hideMenu();
      this.onChange({ client: null, account: null });
      this.trigger.focus();
    } catch (errorValue) {
      const error = requestError(errorValue);
      this.message(`Could not disconnect. ${error.message} Try again.`, true);
    } finally {
      this.phase = '';
      this.setWorking(false);
      this.trigger.focus();
    }
  }
}
