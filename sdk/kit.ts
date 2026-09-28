import { Walleterm } from './walleterm.js';
import type { AddressChange, Result } from './walleterm.js';

// Stellar Wallets Kit v2.7.0 module shape, written structurally so the SDK needs no Kit dependency.
// fixtures/kit/ checks it against the pinned Kit types.
type KitOptions = { networkPassphrase?: string; address?: string; path?: string };
interface KitChange {
  address: string;
  network: string;
  networkPassphrase: string;
  error?: { code: number; message: string };
}

export const WALLETERM_ID = 'walleterm';
const ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><rect width="44" height="44" rx="10" fill="#3855d9"/><path d="M10 14l5 16 7-11 7 11 5-16" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  );
// The Kit expects rejections. SEP-43 results carry the same error object.
async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const value = await result;
  if (value.error) throw value.error;
  return value;
}

/** Kit module for Walleterm. After connection, `WalletermConnect` can drive wallet switching. */
export class WalletermModule {
  // The Kit types this field as its string enum `ModuleType`. `BRIDGE_WALLET` is the runtime value.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly moduleType: any = 'BRIDGE_WALLET';
  readonly productId = WALLETERM_ID;
  readonly productName = 'Walleterm';
  readonly productUrl = 'https://github.com/stellar-experimental/walleterm';
  readonly productIcon = ICON;
  readonly wallet: Walleterm;
  constructor({ wallet = new Walleterm() }: { wallet?: Walleterm } = {}) {
    this.wallet = wallet;
  }
  // The Kit waits at most 1000 ms. No extension exists to detect.
  async isAvailable() {
    return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof fetch === 'function';
  }
  getAddress(params?: { path?: string; skipRequestAccess?: boolean }) {
    return unwrap(this.wallet.getAddress({ skipRequestAccess: params?.skipRequestAccess }));
  }
  signTransaction(xdr: string, opts?: KitOptions) {
    return unwrap(
      this.wallet.signTransaction(xdr, {
        networkPassphrase: opts?.networkPassphrase,
        address: opts?.address,
      }),
    );
  }
  signAuthEntry(authEntry: string, opts?: KitOptions) {
    return unwrap(
      this.wallet.signAuthEntry(authEntry, {
        networkPassphrase: opts?.networkPassphrase,
        address: opts?.address,
      }),
    );
  }
  signMessage(message: string, opts?: KitOptions) {
    return unwrap(
      this.wallet.signMessage(message, {
        networkPassphrase: opts?.networkPassphrase,
        address: opts?.address,
      }),
    );
  }
  getNetwork() {
    return unwrap(this.wallet.getNetwork());
  }
  /**
   * The Kit core does not call this hook. Connect it once, read the event, and act only while Walleterm is the
   * Kit's selected wallet. Both Kit calls use the selected module. See docs/SEP-43.md for the guarded hook.
   * A switch updates the Kit address. A disconnection or an expired session clears it without opening a dialog.
   * Changes in other tabs of the website arrive here too.
   */
  onChange(callback: (event: KitChange) => void) {
    this.wallet.onChange(({ address, network, networkPassphrase }: AddressChange) =>
      callback({
        address: address ?? '',
        network,
        networkPassphrase,
        ...(address ? {} : { error: { code: -3, message: 'Walleterm disconnected. Connect again.' } }),
      }),
    );
    // The Kit restores its address on load. Confirm the saved session, so the event reports its current state.
    this.wallet.restore();
    if (this.wallet.client?.token && !this.wallet.client.account?.address)
      void this.wallet.getAddress({ skipRequestAccess: true });
  }
  async disconnect() {
    try {
      await this.wallet.disconnect();
    } catch {
      this.wallet.forgetConnection();
    }
  }
}
