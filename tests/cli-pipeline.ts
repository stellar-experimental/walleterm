import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSubmissionGuard, type RpcStatus } from './submission.ts';
import type { LiveContext } from './types.ts';

export type CliPipelineContext = Pick<
  LiveContext,
  'sdk' | 'networkPassphrase' | 'keys' | 'sign' | 'record'
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
  writeFileSync(
    join(
      resolve(directory instanceof URL ? fileURLToPath(directory) : directory),
      'cli-pipeline-unsigned.json',
    ),
    JSON.stringify({ network: 'testnet', unsigned_xdr: unsigned, digest }, null, 2) + '\n',
  );
  guard.assertClear();
  // One `walleterm sign` call with the transaction shape returns the signed envelope.
  const signedTx = await ctx.sign(tx, ctx.keys.a);
  const signed = signedTx.toXDR();
  assert.equal(stellar(['tx', 'hash', '--network', 'testnet'], signed), digest);
  assert.equal(signedTx.signatures.length, 1);
  const outcome = await guard.send(signedTx, 'CLI01');
  ctx.record('CLI01', 'passed', {
    hash: outcome.hash,
    ledger: outcome.ledger,
    signed_xdr: signed,
    cli_output: outcome.sent.cli_output,
    assertion:
      'Stellar CLI built, hashed, and submitted; walleterm signed the transaction through 1Password.',
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
