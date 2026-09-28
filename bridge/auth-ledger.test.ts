import { test, expect } from 'bun:test';
import { latestTestnetLedger } from './authorization.ts';

const health = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    status: 'healthy',
    latestLedger: 76772,
    latestLedgerCloseTime: '1790467200',
    oldestLedger: 75000,
    oldestLedgerCloseTime: '1790458340',
    ledgerRetentionWindow: 17280,
  },
};
function mockFetch(fetcher: (url: string | URL | Request, options?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(fetcher, { preconnect: original.preconnect });
  return () => {
    globalThis.fetch = original;
  };
}

test('trusted auth ledger pins getHealth, requires healthy status, and validates latestLedger', async () => {
  for (const response of [
    health,
    { ...health, id: 2 },
    ...[0, -1, 1.5, '76772', null, 0x100000000].map((latestLedger) => ({
      ...health,
      result: { ...health.result, latestLedger },
    })),
    ...['unhealthy', 'HEALTHY', null, undefined].map((status) => ({
      ...health,
      result: { ...health.result, status },
    })),
    { ...health, result: { status: 'healthy', sequence: 76772 } },
    { ...health, error: { code: -32603, message: 'Unhealthy' } },
  ]) {
    const restore = mockFetch(async (url, options) => {
      expect(url).toBe('https://soroban-testnet.stellar.org');
      expect(options?.redirect).toBe('error');
      expect(JSON.parse(String(options?.body))).toEqual({ jsonrpc: '2.0', id: 1, method: 'getHealth' });
      return Response.json(response);
    });
    try {
      if (response === health)
        expect(await latestTestnetLedger({ signal: new AbortController().signal })).toBe(76772);
      else
        await expect(latestTestnetLedger({ signal: new AbortController().signal })).rejects.toThrow(
          'invalid',
        );
    } finally {
      restore();
    }
  }
});

// Match getLatestLedger's documented protocol-28 response shape with synthetic Base64 fields.
function largeLedgerResponse() {
  const response = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      id: 'ab'.repeat(32),
      protocolVersion: 28,
      sequence: 76772,
      closeTime: '1790467200',
      headerXdr: Buffer.alloc(336).toString('base64'),
      metadataXdr: '',
    },
  };
  const remaining = 76772 - Buffer.byteLength(JSON.stringify(response));
  response.result.metadataXdr = Buffer.alloc(Math.floor(remaining / 4) * 3).toString('base64');
  const body = JSON.stringify(response);
  return body + ' '.repeat(76772 - Buffer.byteLength(body));
}
function streamed(body: string, onCancel: () => void = () => {}) {
  const encoded = new TextEncoder().encode(body);
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (offset === encoded.length) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 4096, encoded.length);
          controller.enqueue(encoded.subarray(offset, end));
          offset = end;
        },
        cancel: onCancel,
      },
      { highWaterMark: 0 },
    ),
  );
}

test('trusted ledger avoids the observed 76772-byte getLatestLedger metadata response', async () => {
  const legacy = largeLedgerResponse(),
    methods: string[] = [];
  expect(Buffer.byteLength(legacy)).toBe(76772);
  expect(JSON.parse(legacy).result.sequence).toBe(health.result.latestLedger);
  const restore = mockFetch(async (_url, options) => {
    const method = JSON.parse(String(options?.body)).method;
    methods.push(method);
    return streamed(method === 'getHealth' ? JSON.stringify(health) : legacy);
  });
  try {
    expect(await latestTestnetLedger({ signal: new AbortController().signal })).toBe(76772);
    expect(methods).toEqual(['getHealth']);
  } finally {
    restore();
  }
});

test('trusted ledger accepts bounded padded health JSON and cancels oversized valid JSON', async () => {
  const json = JSON.stringify(health);
  for (const size of [16384, 16385, 76772]) {
    const body = json + ' '.repeat(size - Buffer.byteLength(json));
    let canceled = false;
    const restore = mockFetch(async () =>
      streamed(body, () => {
        canceled = true;
      }),
    );
    try {
      if (size === 16384)
        expect(await latestTestnetLedger({ signal: new AbortController().signal })).toBe(76772);
      else {
        await expect(latestTestnetLedger({ signal: new AbortController().signal })).rejects.toThrow(
          'too large',
        );
        expect(canceled).toBe(true);
      }
    } finally {
      restore();
    }
  }
});

test('trusted ledger rejects redirects, malformed responses, and request failures', async () => {
  for (const response of [
    new Response('', { status: 302 }),
    new Response('not JSON'),
    new Response('', { status: 503 }),
  ]) {
    const restore = mockFetch(async () => response);
    try {
      await expect(latestTestnetLedger({ signal: new AbortController().signal })).rejects.toThrow();
    } finally {
      restore();
    }
  }
  const restore = mockFetch(async () => {
    throw Error('Offline');
  });
  try {
    await expect(latestTestnetLedger({ signal: new AbortController().signal })).rejects.toThrow(
      'ledger is unavailable',
    );
  } finally {
    restore();
  }
});
