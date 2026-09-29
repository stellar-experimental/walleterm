// Phase 7a differential fuzz corpus: Bun node:util.parseEnv results for random inputs.
// Usage: bun phase-7a-fuzz.mts <mode: chars|wide|lines> <seed hex> <count> <max length> > corpus.json
import { parseEnv } from 'node:util';

const [mode, seedHex, countText, maxText] = process.argv.slice(2);
let seed = BigInt('0x' + seedHex);
// splitmix64: a different generator from dotenv.ts.
function next(): number {
  seed = (seed + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
  let z = seed;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
  return Number((z ^ (z >> 31n)) & 0xffffffffn);
}
const pick = <T>(list: T[]): T => list[next() % list.length];

// The dotenv.ts alphabet.
const base = ['O', 'P', '_', 'V', 'K', 'a', '1', '.', '-', '=', ':', ' ', '\t', '\n', '\r', '\v', '\f', '"', "'", '`',
  '\\', 'n', 'r', '#', 'export', 'export ', 'OP_VAULT', '﻿', ' ', 'é', '$', '!', '/'];
// Extra characters that dotenv.ts does not use.
const extra = ['\u0000', '\u0085', ' ', ' ', '­', '​', '　', ' ', '᠎', '\u0001',
  '\u001f', '\u007f', '😀', 'Ä', 'ß', '{', '}', '[', ']', '(', ')', ',', ';', '*', '+', '@', '%', '^', '&', '|',
  '~', '?', '<', '>', 'x', 'Z', '0', '9', 'b', 't', 'u', 'e', 'OP_VAULT=', 'OP_VAULT:', '\r\n', '\\n', '\\"', '${',
  'export\t'];
const wide = [...base, ...extra];

const keys = ['OP_VAULT', 'K', 'A', 'B', 'a.b', 'x-y', '_', '1K', 'Ä', 'OP_VAULTX', 'export', 'op_vault', ''];
const values = ['Private', 'a b', '', ' ', 'x#y', 'é', '$A', '${A}', 'a\\nb', '\\', '"', "'", '`', '=', ':', '#'];
const quotes = ['', '"', "'", '`'];
const seps = ['=', ' = ', ':', ': ', '==', '\t=\t'];
const ends = ['\n', '\r\n', '\r', '', ' #c\n', '\n\n', '\f', '\v'];
const prefixes = ['', 'export ', '  ', '\t', '﻿', '# ', 'export\t', 'export  '];

function line(): string {
  const q = pick(quotes);
  // Sometimes leave a quote open or add trailing text after it.
  const close = next() % 8 === 0 ? '' : q;
  const tail = next() % 6 === 0 ? pick([' y', '"', "'", ' #c', 'x']) : '';
  let value = '';
  const n = next() % 3;
  for (let i = 0; i <= n; i++) value += pick(values);
  if (next() % 5 === 0) value += pick(['\n', '\r\n', '\r']) + pick(values);
  return pick(prefixes) + pick(keys) + pick(seps) + q + value + close + tail + pick(ends);
}

const count = Number(countText);
const max = Number(maxText);
const cases: { text: string; env: Record<string, string> }[] = [];
for (let i = 0; i < count; i++) {
  let text = '';
  if (mode === 'lines') {
    const n = 1 + (next() % 5);
    for (let j = 0; j < n; j++) text += line();
  } else {
    const alphabet = mode === 'wide' ? wide : base;
    const length = next() % (max + 1);
    for (let j = 0; j < length; j++) text += pick(alphabet);
  }
  cases.push({ text, env: { ...parseEnv(text) } });
}
console.log(JSON.stringify({ producer: `Bun ${Bun.version} node:util.parseEnv, phase-7a fuzz ${mode} ${seedHex}`, cases }));
