import { afterAll, expect, test } from 'bun:test';
import { rpc } from '@stellar/stellar-sdk';

// getLatestLedger responses captured on 2026-11-16: testnet at protocol 30 and mainnet at protocol 29.
// The ledger close meta keeps its header and drops the transactions, to keep the file small.
// The demo reads the latest ledger. SDK 17.2.0 failed on the protocol 30 header with
// "LedgerHeader.scpValue.ext.v: unknown enum value 3".
const captured = {
  testnet: {
    id: '6c97bf8c80e05668ae52973ebeb86a1747547a15bde6a2b99847e1056299a875',
    sequence: 5766038,
    protocolVersion: 30,
    closeTime: '1794853835',
    headerXdr:
      'AAAAHiHGsXb9sZ9JZR9eWv2StkFbHudxhpUF6H6p1RJW8m7PtYxmcf4DpmKz2c/S4j9I7irmt+Yafmmu/XsEkU17sR0AAAAAavtLywAAAAAAAAADAAABoeWgFNYAAAAAqCTNGLyddQZNKZpbW6ykO8OqLzJpOBU9jC+btctt8DMAAABAQ8a67qj2rVPXHybbjZVmpdDCvH28NEZLYZOSfiheJhgB7Aq9ea73RHQSZzX28Ad/sTmiFP+Pc8i0PorWuMjtDZhTaJOBK2tG2f9834xeLB8U0IP5kK17Z5BEqG6n5LKCoewOSsEQIFSLuzYlkN4jVX0m1SsU8uoSsaSTY+zJ6foAV/uWDeC2s6dkAAAAAC0zMsRrbQAAAAAAAAAAAA7ypwAAAGQATEtAAAAAyOqjyKx9rhI5aGawFY4xBssIbM5aA2kYvgn84+1aRIyjdn5y9LxwptgVd7z83bjoaUunaW79ftkgglEfZ24X738hUR8+RPG78t5V2Z/KN5UZ1yhjYCbU/IPTmD1wlg2Q/0TAaAz0AcKXg+0YuEt37ZCofX9OhI4/zMdPViWaDD1oAAAAAA==',
    metadataXdr:
      'AAAAAgAAAABsl7+MgOBWaK5Slz6+uGoXR1R6Fb3mormYR+EFYpmodQAAAB4hxrF2/bGfSWUfXlr9krZBWx7ncYaVBeh+qdUSVvJuz7WMZnH+A6Zis9nP0uI/SO4q5rfmGn5prv17BJFNe7EdAAAAAGr7S8sAAAAAAAAAAwAAAaHloBTWAAAAAKgkzRi8nXUGTSmaW1uspDvDqi8yaTgVPYwvm7XLbfAzAAAAQEPGuu6o9q1T1x8m242VZqXQwrx9vDRGS2GTkn4oXiYYAewKvXmu90R0Emc19vAHf7E5ohT/j3PItD6K1rjI7Q2YU2iTgStrRtn/fN+MXiwfFNCD+ZCte2eQRKhup+SygqHsDkrBECBUi7s2JZDeI1V9JtUrFPLqErGkk2Psyen6AFf7lg3gtrOnZAAAAAAtMzLEa20AAAAAAAAAAAAO8qcAAABkAExLQAAAAMjqo8isfa4SOWhmsBWOMQbLCGzOWgNpGL4J/OPtWkSMo3Z+cvS8cKbYFXe8/N246GlLp2lu/X7ZIIJRH2duF+9/IVEfPkTxu/LeVdmfyjeVGdcoY2Am1PyD05g9cJYNkP9EwGgM9AHCl4PtGLhLd+2QqH1/ToSOP8zHT1Ylmgw9aAAAAAAAAAAAAAAAASHGsXb9sZ9JZR9eWv2StkFbHudxhpUF6H6p1RJW8m7PAAAAAAAAAAAAAAAAAAAAAAAAAAEX9wMdAAAAAA==',
  },
  mainnet: {
    id: 'ba08f6f46e7395b244b1c9fd5b6d55acd30a8701be8538d959a5e2fea82d5875',
    sequence: 65513559,
    protocolVersion: 29,
    closeTime: '1794853837',
    headerXdr:
      'AAAAHXE5+FrIZu33JtNWdVMEAS0KbtkxBjABQZPwHcv0n0ftBIoGgogtzOZqsjCjiHC1YhdOmXGuZPSDyZo+28ONkWUAAAAAavtLzQAAAAAAAAABAAAAADF88fn7/Qdf5AnejN22xxQnBxZIgcsq0VC/dFJbol8/AAAAQGRgvaU3EKMLzQ4f5aWECmdxeuTTrCiz3NlBY1s1cYuwk014VT+mQt1xOC7FV6ekSFjUNsfcWsrRIONWUw/qogWeaL5SZtl4VIzxxsD78AS28bwp3LhORI6EGPinw4mvGmP7ChLN3zepv8u360PtrTkFiO70zBZVroJV5869Ku4ZA+eoVw6iHrPseVthAABkeaBCS6EAAAEWAAAAAG8+PBYAAABkAExLQAAAA+gRHRB+0BdfjJXdrcW6eeAgefDbg9jRGBNs/bGZhHx7W6JJMrSOOg3NMHWwx4tkqKRnLpGBNmGK4OFX9f7jzjcxfhPHYSaSI6R1Bbe8bdoNa+IbM8Nk2+TftzIVsypMv7Ey/CmIHD6wNBmWE0N/i2Yg76Dtg7RN1j5wnDbOBCfdhAAAAAA=',
    metadataXdr:
      'AAAAAgAAAAC6CPb0bnOVskSxyf1bbVWs0wqHAb6FONlZpeL+qC1YdQAAAB1xOfhayGbt9ybTVnVTBAEtCm7ZMQYwAUGT8B3L9J9H7QSKBoKILczmarIwo4hwtWIXTplxrmT0g8maPtvDjZFlAAAAAGr7S80AAAAAAAAAAQAAAAAxfPH5+/0HX+QJ3ozdtscUJwcWSIHLKtFQv3RSW6JfPwAAAEBkYL2lNxCjC80OH+WlhApncXrk06wos9zZQWNbNXGLsJNNeFU/pkLdcTguxVenpEhY1DbH3FrK0SDjVlMP6qIFnmi+UmbZeFSM8cbA+/AEtvG8Kdy4TkSOhBj4p8OJrxpj+woSzd83qb/Lt+tD7a05BYju9MwWVa6CVefOvSruGQPnqFcOoh6z7HlbYQAAZHmgQkuhAAABFgAAAABvPjwWAAAAZABMS0AAAAPoER0QftAXX4yV3a3FunngIHnw24PY0RgTbP2xmYR8e1uiSTK0jjoNzTB1sMeLZKikZy6RgTZhiuDhV/X+4843MX4Tx2EmkiOkdQW3vG3aDWviGzPDZNvk37cyFbMqTL+xMvwpiBw+sDQZlhNDf4tmIO+g7YO0TdY+cJw2zgQn3YQAAAAAAAAAAAAAAAFxOfhayGbt9ybTVnVTBAEtCm7ZMQYwAUGT8B3L9J9H7QAAAAAAAAAAAAAAAAAAAAAAAAAAXaM4DwAAAAA=',
  },
};

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const network = new URL(request.url).pathname.slice(1) as keyof typeof captured;
    const { id } = (await request.json()) as { id: number };
    return Response.json({ jsonrpc: '2.0', id, result: captured[network] });
  },
});
afterAll(() => server.stop(true));

test.each([
  ['testnet', 30, 'stellarValueSignedMs'],
  ['mainnet', 29, 'stellarValueSigned'],
] as const)('the RPC client reads the latest %s ledger at protocol %d', async (network, protocol, ext) => {
  const client = new rpc.Server(`http://localhost:${server.port}/${network}`, { allowHttp: true });
  const ledger = await client.getLatestLedger();
  // The SDK types protocolVersion as a string, but RPC returns a number.
  expect(Number(ledger.protocolVersion)).toBe(protocol);
  expect(ledger.sequence).toBe(captured[network].sequence);
  expect(ledger.headerXdr.ledgerVersion).toBe(protocol);
  expect(ledger.headerXdr.scpValue.ext.type).toBe(ext);
});
