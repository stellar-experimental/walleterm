import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('built portable SDK imports without loading the demo or accessing a browser document', () => {
  const entry = fileURLToPath(new URL('../../dist/sdk/walleterm.js', import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      '--no-env-file',
      '-e',
      `
    const sdk = await import(${JSON.stringify(entry)});
    for (const name of ['createAuthEntry', 'inspectAuthEntry', 'verifyAuthEntrySignature', 'WalletermClient']) {
      if (typeof sdk[name] !== 'function') throw Error(name);
    }
  `,
    ],
    { encoding: 'utf8', timeout: 10000 },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});
