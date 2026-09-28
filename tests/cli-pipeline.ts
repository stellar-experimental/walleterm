import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSubmissionGuard, type RpcStatus } from './submission.ts';
import type { LiveContext } from './types.ts';

export type CliPipelineContext = Pick<
  LiveContext,
  'sdk' | 'networkPassphrase' | 'keys' | 'signDigest' | 'record'
> & { rpc: { getTransaction(hash: string): Promise<RpcStatus> } };

interface CliPipelineOptions {
  stellar(args: string[], input?: string): string;
  directory: string | URL;
  timeoutMs?: number;
  pollMs?: number;
}

export async function runCliPipeline(
  ctx: CliPipelineContext,
  { stellar, directory, timeoutMs, pollMs }: CliPipelineOptions,
) {
  const guard = createSubmissionGuard({
    rpc: {
      async sendTransaction(tx) {
        const output = stellar(['tx', 'send', '--network', 'testnet'], tx.toXDR());
        // CLI completion is not the original-hash lookup result.
        return { status: 'PENDING', hash: Buffer.from(tx.hash()).toString('hex'), cli_output: output };
      },
      getTransaction: (hash) => ctx.rpc.getTransaction(hash),
    },
    directory,
    record: ctx.record,
    networkPassphrase: ctx.networkPassphrase,
    timeoutMs,
    pollMs,
  });
  guard.assertClear();
  const unsigned = stellar([
    'tx',
    'new',
    'payment',
    '--network',
    'testnet',
    '--source-account',
    ctx.keys.a.publicKey,
    '--destination',
    ctx.keys.c.publicKey,
    '--amount',
    '100',
    '--build-only',
  ]);
  const tx = ctx.sdk.TransactionBuilder.fromXDR(unsigned, ctx.networkPassphrase);
  const digest = stellar(['tx', 'hash', '--network', 'testnet'], unsigned);
  assert.equal(digest, Buffer.from(tx.hash()).toString('hex'));
  // Stellar CLI JSON for a V1 envelope. Only the signature list changes here.
  const decoded: { tx?: { signatures: { hint: string; signature: string }[] } } = JSON.parse(
    stellar(['tx', 'decode'], unsigned),
  );
  assert.ok(decoded.tx?.signatures);
  writeFileSync(
    join(
      resolve(directory instanceof URL ? fileURLToPath(directory) : directory),
      'cli-pipeline-unsigned.json',
    ),
    JSON.stringify({ network: 'testnet', unsigned_xdr: unsigned, decoded, digest }, null, 2) + '\n',
  );
  guard.assertClear();
  const signature = await ctx.signDigest(ctx.keys.a, Buffer.from(digest, 'hex'));
  assert.ok(decoded.tx);
  decoded.tx.signatures.push({
    hint: Buffer.from(ctx.keys.a.rawPublicKey).subarray(-4).toString('hex'),
    signature: Buffer.from(signature).toString('hex'),
  });
  const signed = stellar(['tx', 'encode'], JSON.stringify(decoded));
  assert.equal(stellar(['tx', 'hash', '--network', 'testnet'], signed), digest);
  const signedTx = ctx.sdk.TransactionBuilder.fromXDR(signed, ctx.networkPassphrase);
  assert.equal(Buffer.from(signedTx.hash()).toString('hex'), digest);
  assert.equal(signedTx.toXDR(), signed);
  const outcome = await guard.send(signedTx, 'CLI01');
  ctx.record('CLI01', 'passed', {
    hash: outcome.hash,
    ledger: outcome.ledger,
    signed_xdr: signed,
    cli_output: outcome.sent.cli_output,
    assertion:
      'Stellar CLI built, hashed, decoded, encoded, and submitted; walleterm signed through 1Password.',
  });
  return outcome;
}

if (import.meta.main) {
  const { ctx } = await import('./live-utils.ts');
  await runCliPipeline(ctx, {
    directory: new URL('../evidence/live/', import.meta.url),
    stellar: (args, input) =>
      execFileSync('stellar', args, { input, encoding: 'utf8', timeout: 60000 }).trim(),
  });
}
