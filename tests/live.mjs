import { ctx } from './live-utils.mjs';

const selected = process.argv[2] ?? 'classic';
if (selected === 'reconcile') {
  console.log(JSON.stringify(await ctx.reconcile()));
  process.exit(0);
}
const runners = {
  classic: ['classic', 'runClassic'],
  contracts: ['contracts', 'runContracts'],
  extended: ['extended-contracts', 'runExtended'],
  cap71: ['cap71', 'runCap71'],
  cap85: ['cap85', 'runCap85'],
};
if (!runners[selected]) throw new Error('Use classic, contracts, extended, cap71, cap85, or reconcile');
ctx.assertClear();
ctx.record('environment', 'passed', { network: 'testnet', version: await ctx.rpc.getVersionInfo(), keys: Object.fromEntries(Object.entries(ctx.keys).map(([name, key]) => [name, key.publicKey])) });
for (const key of Object.values(ctx.keys)) await ctx.fund(key);
const [file, run] = runners[selected];
const module = await import(`./${file}.mjs`);
await module[run](ctx);
