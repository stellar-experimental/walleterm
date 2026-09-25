import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { ctx } from './live-utils.mjs';

const stellar = (args, input) => execFileSync('stellar', args, { input, encoding: 'utf8', timeout: 60000 }).trim();
const unsigned = stellar(['tx', 'new', 'payment', '--network', 'testnet', '--source-account', ctx.keys.a.publicKey,
  '--destination', ctx.keys.c.publicKey, '--amount', '100', '--build-only']);
const tx = ctx.sdk.TransactionBuilder.fromXDR(unsigned, ctx.networkPassphrase);
const digest = stellar(['tx', 'hash', '--network', 'testnet'], unsigned);
assert.equal(digest, Buffer.from(tx.hash()).toString('hex'));
const decoded = JSON.parse(stellar(['tx', 'decode'], unsigned));
assert.ok(decoded.tx?.signatures);
writeFileSync(new URL('../evidence/live/cli-pipeline-unsigned.json', import.meta.url), JSON.stringify({ network: 'testnet', unsigned_xdr: unsigned, decoded, digest }, null, 2) + '\n');
const signature = await ctx.signDigest(ctx.keys.a, Buffer.from(digest, 'hex'));
decoded.tx.signatures.push({ hint: ctx.keys.a.rawPublicKey.subarray(-4).toString('hex'), signature: signature.toString('hex') });
const signed = stellar(['tx', 'encode'], JSON.stringify(decoded));
assert.equal(stellar(['tx', 'hash', '--network', 'testnet'], signed), digest);
const output = stellar(['tx', 'send', '--network', 'testnet'], signed);
const result = await ctx.rpc.getTransaction(digest);
assert.equal(result.status, 'SUCCESS');
ctx.record('CLI01', 'passed', { hash: digest, ledger: result.ledger, signed_xdr: signed, cli_output: output,
  assertion: 'Stellar CLI built, hashed, decoded, encoded, and submitted; walleterm signed through 1Password.' });
