import { Networks } from '@stellar/stellar-sdk';
import {
  addressCredentials,
  attachAuthSignature,
  inspectAuthEntry,
  parseAuthEntry,
} from '../sdk/authorization.ts';
import type { AuthSigningInput } from '../sdk/types.ts';

export function inspectAuthorization(
  input: AuthSigningInput,
  key: string,
  now: number,
  latestLedger?: number,
) {
  if (input.network_passphrase !== Networks.TESTNET)
    throw Object.assign(Error('Only Stellar testnet is supported.'), { status: 400 });
  // Admission validates structure only. The queue obtains a trusted ledger before signing.
  const expiry = addressCredentials(parseAuthEntry(input.auth_entry_xdr)).signatureExpirationLedger;
  const checked = inspectAuthEntry(input, key, latestLedger ?? Math.max(1, expiry - 60));
  return { ...checked, expires: now + 300000 };
}
export { attachAuthSignature };

// getHealth reports the most recent known ledger without getLatestLedger's full ledger metadata.
// https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth
// Checked 2026-09-26. Keep the small streamed byte cap and ten-second deadline.
const MAX_HEALTH_RESPONSE_BYTES = 16384;

/** Fixed endpoint: the website cannot supply a ledger or redirect the bridge. */
export async function latestTestnetLedger({ signal }: { signal: AbortSignal }): Promise<number> {
  const response = await fetch('https://soroban-testnet.stellar.org', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
  });
  if (!response.ok || !response.body) throw Error('The trusted testnet ledger is unavailable.');
  const reader = response.body.getReader();
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HEALTH_RESPONSE_BYTES) throw Error('The trusted ledger response is too large.');
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
    throw Error('The trusted testnet ledger response is invalid.');
  return sequence;
}
