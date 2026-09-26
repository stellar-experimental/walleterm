import { ctx } from './live-utils.ts';
import type { LiveContext } from './types.ts';

const selected = process.argv[2] ?? 'classic';
if (selected === 'reconcile') {
  console.log(JSON.stringify(await ctx.reconcile()));
  process.exit(0);
}
// Each runner loads only when selected. Importing a runner never starts network or signing work.
const runners = new Map<string, () => Promise<(context: LiveContext) => Promise<unknown>>>([
  ['classic', async () => (await import('./classic.ts')).runClassic],
  ['contracts', async () => (await import('./contracts.ts')).runContracts],
  ['extended', async () => (await import('./extended-contracts.ts')).runExtended],
  ['cap71', async () => (await import('./cap71.ts')).runCap71],
  ['cap85', async () => (await import('./cap85.ts')).runCap85],
]);
const load = runners.get(selected);
if (!load) throw new Error('Use classic, contracts, extended, cap71, cap85, or reconcile');
// CAP-85 reconciles both journals before it funds or signs anything.
if (selected !== 'cap85') {
  ctx.assertClear();
  ctx.record('environment', 'passed', {
    network: 'testnet',
    version: await ctx.rpc.getVersionInfo(),
    keys: Object.fromEntries(Object.entries(ctx.keys).map(([name, key]) => [name, key.publicKey])),
  });
  for (const key of Object.values(ctx.keys)) await ctx.fund(key);
}
const run = await load();
await run(ctx);
