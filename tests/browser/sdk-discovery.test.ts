// SDK discovery cancellation with a mocked transport. Ported from bridge/vault.test.ts.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { WalletermClient } from '../../sdk/walleterm.ts';
import { requestSignal, requestUrl } from '../../bridge/test/support.ts';

test('caller cancellation still stops SDK vault discovery immediately', async () => {
  const controller = new AbortController();
  const listing = Promise.withResolvers<void>();
  const client = new WalletermClient('http://127.0.0.1:8787', {
    fetch: async (input, options) => {
      const url = requestUrl(input);
      if (url.endsWith('/v1/signers')) {
        listing.resolve();
        const signal = requestSignal(options);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (signal.aborted) reject(signal.reason);
        });
      }
      return Response.json(url.endsWith('/v1/connect') ? { token: 'mock-token' } : { disconnected: true });
    },
  });
  const pending = client.connect({
    code: '01234567',
    selectWallet: () => {
      throw Error('The picker must not open.');
    },
    signal: controller.signal,
  });
  await listing.promise;
  controller.abort(Error('Caller canceled discovery.'));
  await assert.rejects(pending, /Caller canceled discovery/);
  assert.equal(client.token, null);
});
