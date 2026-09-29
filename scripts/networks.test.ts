import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// docs/NETWORKS.md must name each product file that holds a testnet value. AGENTS.md states the rule.
const root = fileURLToPath(new URL('..', import.meta.url));
const product = [
  'build.rs',
  'src/**/*.rs',
  'sdk/**/*.ts',
  'demo/site/**/*.{ts,html}',
  '.agents/skills/*/scripts/*',
];
const testnet = new RegExp(
  [
    'Test SDF Network ; September 2015',
    '\\bTESTNET\\b',
    'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
    '(soroban|horizon)-testnet\\.stellar\\.org',
    'friendbot\\.stellar\\.org',
  ].join('|'),
);

test('docs/NETWORKS.md names every product file with a testnet value', () => {
  const doc = readFileSync(`${root}docs/NETWORKS.md`, 'utf8');
  const files = product.flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: root, dot: true })]);
  const matched = files.filter((file) => testnet.test(readFileSync(`${root}${file}`, 'utf8')));
  // Guard the scan itself: a broken pattern must not pass by matching nothing.
  assert.ok(matched.includes('src/bridge.rs') && matched.includes('sdk/walleterm.ts'));
  assert.deepEqual(matched.filter((file) => !doc.includes(`\`${file}\``)).sort(), []);
});
