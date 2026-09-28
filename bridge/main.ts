import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { DemoFiles } from '../demo/server.ts';

// Compiled executables do not load .env. Read only the vault filter. A shell value still wins.
// Return the other Bun .env files that set OP_VAULT, so the tunnel can report them as ignored.
export function loadVaultSetting(directory = '.', env = process.env) {
  const read = (name: string) => {
    try {
      return parseEnv(readFileSync(join(directory, name), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const ignored = [
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
  ].filter((name) => read(name)?.OP_VAULT !== undefined);
  if (!('OP_VAULT' in env)) {
    const value = read('.env')?.OP_VAULT;
    if (value !== undefined) env.OP_VAULT = value;
  }
  return ignored;
}

// The Go command starts one mode. Each mode loads only its own modules.
export async function main(args: string[], files?: DemoFiles) {
  const [mode, value] = args;
  if (mode === 'tunnel-child') {
    const { runTunnelChild } = await import('./tunnel-child.ts');
    return runTunnelChild(args.slice(1));
  }
  if (args.length === 2 && mode === 'sign-auth') {
    const { runAuthCLI } = await import('./auth-cli.ts');
    return runAuthCLI(value);
  }
  if (args.length === 2 && (mode === 'tunnel' || mode === 'demo')) {
    const { runService } = await import('./launch.ts');
    const config = JSON.parse(value);
    if (mode === 'demo') {
      const { createDemoSite } = await import('../demo/server.ts');
      return runService(
        { ...config, label: 'Walleterm demo' },
        { create: (options) => createDemoSite({ ...options, files }) },
      );
    }
    for (const name of loadVaultSetting())
      process.stderr.write(`Walleterm ignores OP_VAULT in ${name}. Move it to .env.\n`);
    process.stdout.write(
      process.env.OP_VAULT
        ? `Website wallets: 1Password vault ${JSON.stringify(process.env.OP_VAULT)}.\n`
        : 'Website wallets: every Ed25519 key in the 1Password SSH agent. Set OP_VAULT to limit them.\n',
    );
    const { createBridge } = await import('./server.ts');
    return runService({ ...config, label: 'Walleterm tunnel' }, { create: createBridge });
  }
  process.stderr.write('Run walleterm tunnel, walleterm demo, or walleterm sign-auth.\n');
  process.exitCode = 2;
}
if (import.meta.main) await main(process.argv.slice(2));
