// Writes fixtures/cap85/wasm/manifest.json for fixtures/cap85/build.sh.
// Usage: bun fixtures/cap85/manifest.ts <fixtures/cap85 directory>. No network. No keys.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const here = process.argv[2];
if (!here) throw new Error('Usage: bun fixtures/cap85/manifest.ts <fixtures/cap85 directory>');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const sdkOf = (ws: string) =>
  /name = "soroban-sdk"\nversion = "([^"]+)"/.exec(readFileSync(`${here}/${ws}/Cargo.lock`).toString())?.[1];
const files = readdirSync(`${here}/wasm`)
  .filter((f) => f.endsWith('.wasm'))
  .sort();
const workspaces: [string, string[]][] = [
  ['contracts', ['manager', 'target-v1', 'target-v2', 'account']],
  ['contracts-sdk27', ['legacy-account']],
];
const sources: Record<string, string> = {};
for (const [ws, crates] of workspaces) {
  sources[`${ws}/Cargo.toml`] = sha(readFileSync(`${here}/${ws}/Cargo.toml`));
  sources[`${ws}/Cargo.lock`] = sha(readFileSync(`${here}/${ws}/Cargo.lock`));
  for (const crate of crates)
    for (const f of ['Cargo.toml', 'src/lib.rs'])
      sources[`${ws}/${crate}/${f}`] = sha(readFileSync(`${here}/${ws}/${crate}/${f}`));
}
const manifest = {
  built_at: new Date().toISOString(),
  cap: 'CAP-0085 externally managed contract executables',
  workspaces: {
    contracts: { soroban_sdk: sdkOf('contracts') },
    'contracts-sdk27': { soroban_sdk: sdkOf('contracts-sdk27') },
  },
  toolchain: {
    rustc: execSync('rustc --version').toString().trim(),
    cargo: execSync('cargo --version').toString().trim(),
    stellar_cli: execSync('stellar --version').toString().split('\n')[0].trim(),
  },
  target: 'wasm32v1-none',
  profile: 'release (opt-level z, lto, panic abort), stellar contract build default optimize',
  sources,
  artifacts: Object.fromEntries(
    files.map((f) => {
      const b = readFileSync(`${here}/wasm/${f}`);
      return [
        f,
        { sha256: sha(b), bytes: b.length, sdk: f.includes('legacy') ? 'soroban-sdk 27' : 'soroban-sdk 28' },
      ];
    }),
  ),
};
writeFileSync(`${here}/wasm/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
