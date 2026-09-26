import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { reviewInTerminal } from './terminal.mjs';

test('terminal review rejects noninteractive input', async () => {
  await assert.rejects(reviewInTerminal({}, { input: { isTTY: false }, output: { isTTY: false } }), /interactive terminal/);
});
for (const accept of [false, true]) test(`terminal review ${accept ? 'accepts the exact challenge' : 'rejects a generic yes'} and escapes untrusted text`, async () => {
  const input = new PassThrough(), output = new PassThrough(); input.isTTY = output.isTTY = true;
  let text = '', sent = false;
  output.on('data', chunk => {
    text += chunk;
    const code = text.match(/Type sign ([a-f0-9]{6})/);
    if (code && !sent) { sent = true; queueMicrotask(() => input.write(accept ? `sign ${code[1]}\n` : 'yes\n')); }
  });
  const result = await reviewInTerminal({ origin: 'https://site.example', details: { name: '\x1b[2J\u202e', hash: 'mock' } }, { input, output, signal: AbortSignal.timeout(2000) });
  assert.equal(result, accept); assert.ok(!text.includes('\x1b[2J')); assert.ok(!text.includes('\u202e'));
  assert.match(text, /\\u001b/); assert.match(text, /\\u202e/);
  input.destroy(); output.destroy();
});
test('Ctrl+C during a review stops the service and shows the signer', async () => {
  const input = new PassThrough(), output = new PassThrough(); input.isTTY = output.isTTY = true;
  const controller = new AbortController();
  let text = '', interrupted = false, sent = false;
  output.on('data', chunk => {
    text += chunk;
    if (!sent && text.includes('Press Enter to deny')) { sent = true; queueMicrotask(() => input.write('\x03')); }
  });
  const pending = reviewInTerminal({ origin: 'https://site.example', signer: { public_key: 'GMOCK', comment: 'Testnet key', fingerprint: 'SHA256:mock' }, details: { hash: 'mock' } },
    { input, output, signal: controller.signal, interrupt: () => { interrupted = true; controller.abort(Error('The service stopped.')); } });
  await assert.rejects(pending);
  assert.equal(interrupted, true);
  assert.match(text, /"comment": "Testnet key"/); assert.match(text, /"fingerprint": "SHA256:mock"/);
  input.destroy(); output.destroy();
});

test('input typed before the prompt cannot answer it', async () => {
  const input = new PassThrough(), output = new PassThrough(); input.isTTY = output.isTTY = true;
  let text = '', sent = false;
  input.write('\n'); input.write('sign 000000\n'); // Early input: an extra Enter and an old answer.
  output.on('data', chunk => {
    text += chunk;
    const code = text.match(/Type sign ([a-f0-9]{6})/);
    if (code && !sent) { sent = true; queueMicrotask(() => input.write(`sign ${code[1]}\n`)); }
  });
  assert.equal(await reviewInTerminal({ origin: 'https://site.example', details: { hash: 'mock' } }, { input, output, signal: AbortSignal.timeout(2000) }), true);
  input.destroy(); output.destroy();
});
test('unfinished terminal input is drained before the review prompt', async () => {
  const input = new PassThrough(), output = new PassThrough(); input.isTTY = output.isTTY = true;
  let stale = 'stale', text = '', sent = false;
  input.setRawMode = raw => { input.isRaw = raw; if (raw && stale) { input.write(stale); stale = ''; } };
  output.on('data', chunk => {
    text += chunk;
    const code = text.match(/Type sign ([a-f0-9]{6})/);
    if (code && !sent) { sent = true; queueMicrotask(() => input.write(`sign ${code[1]}\n`)); }
  });
  assert.equal(await reviewInTerminal({ origin: 'https://site.example', details: { hash: 'mock' } }, { input, output, signal: AbortSignal.timeout(2000) }), true);
  assert.equal(input.isRaw, false);
  input.destroy(); output.destroy();
});
