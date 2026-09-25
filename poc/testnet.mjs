import { StrKey, xdr } from '@stellar/stellar-sdk';

const HORIZON = 'https://horizon-testnet.stellar.org';
export const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

async function get(path) {
  const response = await fetch(`${HORIZON}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`Testnet Horizon returned ${response.status}.`);
  return response.json();
}
function stroops(value) {
  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) throw Error('The asset amount is invalid.');
  const [whole, part = ''] = value.split('.');
  return BigInt(whole) * 10000000n + BigInt(part.padEnd(7, '0'));
}
export async function listOffers(address) {
  const response = await get(`/accounts/${address}/offers?limit=200`);
  return response._embedded.records;
}
export async function lookupOffer(address, id, client) {
  if (!/^[1-9]\d*$/.test(id)) throw Error('The offer ID is invalid.');
  const key = xdr.LedgerKey.offer(new xdr.LedgerKeyOffer({
    sellerId: xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(address)),
    offerId: BigInt(id),
  }));
  const result = await client.getLedgerEntries(key);
  const latestLedger = Number(result.latestLedger);
  if (!Number.isSafeInteger(latestLedger) || latestLedger <= 0 || result.entries.length > 1) {
    throw Error('RPC returned an invalid offer lookup.');
  }
  return { exists: result.entries.length === 1, latestLedger };
}
export async function offerPreflight(address) {
  const account = await get(`/accounts/${address}`);
  const asset = account.balances.find(balance => balance.asset_code === 'USDC' && balance.asset_issuer === USDC_ISSUER);
  if (!asset || asset.is_authorized === false) throw Error('The signer needs an authorized testnet USDC trustline.');
  const free = stroops(asset.limit) - stroops(asset.balance) - stroops(asset.buying_liabilities);
  if (free < stroops('1')) throw Error('The testnet USDC trustline has too little free capacity.');
  const native = account.balances.find(balance => balance.asset_type === 'native');
  if (!native || stroops(native.balance) - stroops(native.selling_liabilities) < stroops('2')) {
    throw Error('The signer needs at least 2 free test XLM for the offer and reserve.');
  }
  return { existingOfferIds: (await listOffers(address)).map(offer => String(offer.id)) };
}
export function offerEffect(resultXdr) {
  if (!resultXdr) throw Error('The ledger result has no XDR.');
  const result = typeof resultXdr === 'string' ? xdr.TransactionResult.fromXDR(resultXdr, 'base64') : resultXdr;
  if (result.result.type !== 'txSuccess' || result.result.results.length !== 1) throw Error('The transaction has no successful offer operation.');
  const operation = result.result.results[0];
  if (operation.type !== 'opInner' || operation.tr.type !== 'manageSellOffer' || operation.tr.manageSellOfferResult.type !== 'manageSellOfferSuccess') {
    throw Error('The offer operation did not succeed.');
  }
  const effect = operation.tr.manageSellOfferResult.success.offer;
  if (effect.type === 'manageOfferDeleted') return { type: 'deleted' };
  if (effect.type === 'manageOfferCreated' || effect.type === 'manageOfferUpdated') {
    const amount = effect.offer.amount;
    const whole = amount / 10000000n;
    const fraction = (amount % 10000000n).toString().padStart(7, '0');
    return { type: effect.type === 'manageOfferCreated' ? 'created' : 'updated',
      id: effect.offer.offerId.toString(), amount: `${whole}.${fraction}` };
  }
  throw Error('The ledger returned an unknown offer effect.');
}
