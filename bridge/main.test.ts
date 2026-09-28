import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVaultSetting } from './main.ts';

test('the tunnel reads only OP_VAULT from .env, keeps shell values, and reports ignored files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-env-'));
  try {
    const empty: NodeJS.ProcessEnv = {};
    expect(loadVaultSetting(directory, empty)).toEqual([]);
    expect(empty).toEqual({});
    writeFileSync(join(directory, '.env'), '# vault\nOP_VAULT="Private Keys"\nOTHER=value\n');
    writeFileSync(join(directory, '.env.local'), 'OP_VAULT=Other\n');
    writeFileSync(join(directory, '.env.example'), 'OP_VAULT=Example\n');
    const env: NodeJS.ProcessEnv = {};
    expect(loadVaultSetting(directory, env)).toEqual(['.env.local']);
    expect(env).toEqual({ OP_VAULT: 'Private Keys' });
    const shell: NodeJS.ProcessEnv = { OP_VAULT: '' };
    loadVaultSetting(directory, shell);
    expect(shell).toEqual({ OP_VAULT: '' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
