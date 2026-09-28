import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('installed Go dispatch uses its sidecar and rejects invalid artifacts without signing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-auth-dispatch-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    mkdirSync(join(directory, 'bin'));
    const binary = join(directory, 'bin/walleterm');
    const build = spawnSync('go', ['build', '-o', binary, '.'], { cwd: root, encoding: 'utf8' });
    expect(build.status).toBe(0);
    symlinkSync(resolve(root, 'bridge'), join(directory, 'bridge'));
    for (const input of ['{}', '{"auth_entry_xdr":"bad"}', '{}{}', ' '.repeat(49153)]) {
      const result = spawnSync(binary, ['sign-auth'], { input, encoding: 'utf8', timeout: 10000 });
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('built portable SDK imports without loading the demo or accessing a browser document', () => {
  const entry = fileURLToPath(new URL('../dist/sdk/walleterm.js', import.meta.url));
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
