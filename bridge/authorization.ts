import { Networks } from '@stellar/stellar-sdk';
import {
  addressCredentials,
  attachAuthSignature as attachEntrySignature,
  inspectAuthEntry,
  parseAuthEntry,
} from '../sdk/authorization.ts';
import { WalletermError, walletermError } from '../sdk/errors.ts';
import { base64, inspectAuthPreimage, verifyPreimageSignature } from '../sdk/preimage.ts';
import type { AuthPreimageInput, AuthorizationInput } from '../sdk/types.ts';

const testnet = (passphrase: string) => {
  if (passphrase !== Networks.TESTNET)
    throw walletermError('network_unsupported', 'Walleterm signs only on Stellar testnet.');
};

/** SEP-43 preimage. Admission checks structure. The queue checks expiry against a trusted ledger. */
export function inspectAuthPreimageRequest(
  input: AuthPreimageInput,
  key: string,
  now: number,
  latestLedger?: number,
) {
  testnet(input.network_passphrase);
  if (input.address !== key)
    throw walletermError('address_mismatch', 'The requested signer differs from the selected account.');
  return {
    ...inspectAuthPreimage(input.preimage_xdr, key, input.network_passphrase, latestLedger),
    expires: now + 300000,
  };
}
/** Verify the raw signature, then return it as Base64. */
export function attachPreimageSignature(
  input: AuthPreimageInput,
  key: string,
  latestLedger: number,
  signature: string,
) {
  const { digest } = inspectAuthPreimage(input.preimage_xdr, key, input.network_passphrase, latestLedger);
  if (!/^[a-f0-9]{128}$/.test(signature)) throw Error('The signer returned an invalid signature.');
  const encoded = base64(Uint8Array.from(signature.match(/../g)!, (h) => parseInt(h, 16)));
  verifyPreimageSignature(digest, key, encoded);
  return encoded;
}

// The adapter extension reuses the CLI input shape. `address` names the signer in protocol 3.
const entryInput = (input: AuthorizationInput) => ({
  auth_entry_xdr: input.auth_entry_xdr,
  network_passphrase: input.network_passphrase,
  public_key: input.address,
  address: input.auth_address,
  adapter: input.adapter,
});
export function inspectAuthorization(
  input: AuthorizationInput,
  key: string,
  now: number,
  latestLedger?: number,
) {
  testnet(input.network_passphrase);
  // Admission validates structure only. The queue obtains a trusted ledger before signing.
  const expiry = addressCredentials(parseAuthEntry(input.auth_entry_xdr)).signatureExpirationLedger;
  const checked = inspectAuthEntry(entryInput(input), key, latestLedger ?? Math.max(1, expiry - 60));
  return { ...checked, expires: now + 300000 };
}
export function attachAuthSignature(
  input: AuthorizationInput,
  key: string,
  latestLedger: number,
  signature: string,
) {
  return attachEntrySignature(entryInput(input), key, latestLedger, signature);
}

// getHealth reports the most recent known ledger without getLatestLedger's full ledger metadata.
// https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth
// Checked 2026-09-26. Keep the small streamed byte cap and ten-second deadline.
const MAX_HEALTH_RESPONSE_BYTES = 16384;

/** Fixed endpoint: the website cannot supply a ledger or redirect the bridge. */
export async function latestTestnetLedger({ signal }: { signal: AbortSignal }): Promise<number> {
  try {
    return await readLedger(signal);
  } catch (error) {
    if (error instanceof WalletermError || signal.aborted) throw error;
    throw walletermError('ledger_unavailable', 'The trusted testnet ledger is unavailable.');
  }
}
async function readLedger(signal: AbortSignal): Promise<number> {
  const response = await fetch('https://soroban-testnet.stellar.org', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
  });
  if (!response.ok || !response.body)
    throw walletermError('ledger_unavailable', 'The trusted testnet ledger is unavailable.');
  const reader = response.body.getReader();
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HEALTH_RESPONSE_BYTES)
        throw walletermError('ledger_unavailable', 'The trusted ledger response is too large.');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  const result = JSON.parse(text);
  const sequence = result?.result?.latestLedger;
  if (
    result.id !== 1 ||
    result.error ||
    result?.result?.status !== 'healthy' ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > 0xffffffff
  )
    throw walletermError('ledger_unavailable', 'The trusted testnet ledger response is invalid.');
  return sequence;
}
