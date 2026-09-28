// SEP-43 live acceptance step 4: requests that must never reach the signer.
// Each case runs twice: through the SDK, which must send no bridge request,
// and as a raw bridge request with the session token, which the bridge must refuse.
import {
  Account,
  Address,
  Asset,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
  xdr,
} from '@stellar/stellar-sdk';
import type { Walleterm } from '../../../sdk/walleterm.ts';

export interface BridgeRequest {
  method: string;
  path: string;
}
export interface Outcome {
  code?: number;
  ext?: string[];
}
// A lone surrogate is not well-formed text. As UTF-8 it would become U+FFFD, so a signature would cover other text.
const MESSAGE = 'Sign in to example.com \ud800';

// A V1 preimage omits the address. Walleterm refuses it because it permits cross-address replay.
function v1Preimage() {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(Asset.native().contractId(Networks.TESTNET)).toScAddress(),
        functionName: 'transfer',
        args: [],
      }),
    ),
    subInvocations: [],
  });
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(new TextEncoder().encode(Networks.TESTNET)),
      nonce: 1n,
      signatureExpirationLedger: 1,
      invocation,
    }),
  ).toXDR('base64');
}

/** Run the four cases for the connected wallet. `requests` records every bridge request from the wallet. */
export async function runNegatives(wallet: Walleterm, requests: BridgeRequest[]) {
  const client = wallet.client;
  const address = wallet.address;
  if (!client?.token || !address) throw Error('Connect Walleterm first.');
  // A transaction that the selected key could sign on testnet. Only the request options make it invalid.
  const transaction = new TransactionBuilder(new Account(address, '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'sep43-negative', value: 'no' }))
    .setTimeout(120)
    .build()
    .toXDR();
  const preimage = v1Preimage();
  const calls: Record<string, () => Promise<{ error?: Outcome }>> = {
    public: () => wallet.signTransaction(transaction, { networkPassphrase: Networks.PUBLIC }),
    v1_preimage: () => wallet.signAuthEntry(preimage),
    bad_message: () => wallet.signMessage(MESSAGE),
    submit: () => wallet.signTransaction(transaction, { submit: true }),
  };
  const sdk: Record<string, Outcome & { bridgeRequests: number }> = {};
  for (const [name, call] of Object.entries(calls)) {
    const before = requests.length;
    const { error } = await call();
    sdk[name] = { code: error?.code, ext: error?.ext, bridgeRequests: requests.length - before };
  }
  const raw = async (body: Record<string, unknown>) => {
    const response = await client.fetch(`${client.url}/v1/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.token}` },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        network_passphrase: Networks.TESTNET,
        address,
        ...(client.walletScope === 'available' ? { selection_revision: client.revision } : {}),
        ...body,
      }),
    });
    const data = await response.json();
    return { status: response.status, code: data.error?.code, ext: data.error?.ext };
  };
  const bridge = {
    public: await raw({ kind: 'transaction', xdr: transaction, network_passphrase: Networks.PUBLIC }),
    v1_preimage: await raw({ kind: 'auth_entry', preimage_xdr: preimage }),
    // JSON.stringify escapes the lone surrogate. The bridge refuses the escape as invalid JSON text.
    bad_message: await raw({ kind: 'message', message: MESSAGE }),
    // The bridge has no submission field.
    submit: await raw({ kind: 'transaction', xdr: transaction, submit: true }),
  };
  return { address, sdk, bridge };
}

/** The expected result of each case. The procedure and the offline check compare against it. */
export const EXPECTED = {
  sdk: {
    public: { code: -3, ext: ['walleterm:network_unsupported'], bridgeRequests: 0 },
    v1_preimage: { code: -3, ext: ['walleterm:unsupported'], bridgeRequests: 0 },
    bad_message: { code: -3, ext: ['walleterm:invalid_request'], bridgeRequests: 0 },
    submit: { code: -3, ext: ['walleterm:unsupported'], bridgeRequests: 0 },
  },
  bridge: {
    public: { status: 400, code: -3, ext: ['walleterm:network_unsupported'] },
    v1_preimage: { status: 400, code: -3, ext: ['walleterm:unsupported'] },
    bad_message: { status: 400, code: -3, ext: ['walleterm:invalid_request'] },
    submit: { status: 400, code: -3, ext: ['walleterm:invalid_request'] },
  },
};

/** List each field that differs from EXPECTED. An empty list passes. */
export function mismatches(result: { sdk: Record<string, object>; bridge: Record<string, object> }) {
  const found: string[] = [];
  for (const layer of ['sdk', 'bridge'] as const)
    for (const [name, expected] of Object.entries(EXPECTED[layer])) {
      const actual = result[layer][name] as Record<string, unknown> | undefined;
      for (const [field, value] of Object.entries(expected))
        if (JSON.stringify(actual?.[field]) !== JSON.stringify(value))
          found.push(`${layer}.${name}.${field}: ${JSON.stringify(actual?.[field])}`);
    }
  return found;
}
