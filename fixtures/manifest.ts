// Writes fixtures/wasm/manifest.json for fixtures/build.sh.
// Usage: bun fixtures/manifest.ts <wasm directory> <OpenZeppelin commit>. No network. No keys.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const [out, commit] = process.argv.slice(2);
if (!out || !commit)
  throw new Error('Usage: bun fixtures/manifest.ts <wasm directory> <OpenZeppelin commit>');
const files = readdirSync(out)
  .filter((f) => f.endsWith('.wasm'))
  .sort();
const artifacts = Object.fromEntries(
  files.map((f) => {
    const bytes = readFileSync(`${out}/${f}`);
    const source = f.startsWith('multisig_')
      ? { repo: 'OpenZeppelin/stellar-contracts', commit, path: 'examples/multisig-smart-account' }
      : { repo: 'local', path: 'fixtures/contracts' };
    return [f, { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, ...source }];
  }),
);
const manifest = { built_at: new Date().toISOString(), oz_commit: commit, artifacts };
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
