import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { DemoFiles } from '../demo/server.ts';

// Compiled executables do not load .env. Read only the vault filter. A shell value still wins.
export function loadVaultSetting(file = '.env', env = process.env) {
  if ('OP_VAULT' in env) return;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const value = parseEnv(text).OP_VAULT;
  if (value !== undefined) env.OP_VAULT = value;
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
    loadVaultSetting();
    const { createBridge } = await import('./server.ts');
    return runService({ ...config, label: 'Walleterm tunnel' }, { create: createBridge });
  }
  process.stderr.write('Run walleterm tunnel, walleterm demo, or walleterm sign-auth.\n');
  process.exitCode = 2;
}
if (import.meta.main) await main(process.argv.slice(2));
