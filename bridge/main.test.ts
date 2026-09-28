import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVaultSetting } from './main.ts';

test('the tunnel reads only OP_VAULT from .env and keeps shell values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-env-'));
  const file = join(directory, '.env');
  try {
    writeFileSync(file, '# vault\nOP_VAULT="Private Keys"\nOTHER=value\n');
    const env: NodeJS.ProcessEnv = {};
    loadVaultSetting(file, env);
    expect(env).toEqual({ OP_VAULT: 'Private Keys' });
    const shell: NodeJS.ProcessEnv = { OP_VAULT: '' };
    loadVaultSetting(file, shell);
    expect(shell).toEqual({ OP_VAULT: '' });
    const missing: NodeJS.ProcessEnv = {};
    loadVaultSetting(join(directory, 'missing'), missing);
    expect(missing).toEqual({});
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
