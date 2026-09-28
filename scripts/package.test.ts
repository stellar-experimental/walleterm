import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { demoFiles } from '../demo/server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let directory: string, bin: string, work: string, dist: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'walleterm-package-'));
  bin = join(directory, 'bin');
  work = join(directory, 'work');
  const build = spawnSync(process.execPath, ['scripts/package.ts', bin, '9.9.9-test'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(build.status, build.stderr).toBe(0);
  // Build a separate reference copy. Browser builds are deterministic, so the bytes must match.
  dist = join(directory, 'dist');
  expect(spawnSync(process.execPath, ['scripts/build.ts', dist], { cwd: root }).status).toBe(0);
  // A hostile working directory must not change the compiled runtime.
  spawnSync('mkdir', [work]);
  writeFileSync(join(work, 'bunfig.toml'), 'preload = ["./preload.ts"]\n');
  writeFileSync(
    join(work, 'preload.ts'),
    `require('node:fs').writeFileSync(${JSON.stringify(join(work, 'ran'))}, '');\n`,
  );
}, 120000);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test('the package reports its version and includes notices', () => {
  const result = spawnSync(join(bin, 'walleterm'), ['--version'], { encoding: 'utf8' });
  expect(result.stdout).toBe('walleterm 9.9.9-test\n');
  expect(readFileSync(join(bin, 'NOTICES.txt'), 'utf8')).toContain('== @stellar/stellar-sdk ');
});

test('sign-auth ignores bunfig.toml, package.json, and Bun variables from the caller', () => {
  writeFileSync(join(work, 'package.json'), JSON.stringify({ scripts: { 'sign-auth': 'touch ran' } }));
  writeFileSync(join(work, 'sign-auth.ts'), `require('node:fs').writeFileSync('ran', '');\n`);
  const env = {
    ...process.env,
    BUN_OPTIONS: '--preload ./preload.ts',
    BUN_BE_BUN: '1',
    NODE_OPTIONS: '--require ./preload.ts',
  };
  for (const input of ['{}', '{"auth_entry_xdr":"bad"}', '{}{}', ' '.repeat(49153)]) {
    const result = spawnSync(join(bin, 'walleterm'), ['sign-auth'], {
      cwd: work,
      env,
      input,
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  }
  expect(existsSync(join(work, 'ran'))).toBe(false);
});

test('the compiled demo serves every embedded route and supervises cloudflared through itself', async () => {
  const port = await new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
  const tools = join(directory, 'tools');
  const marker = join(directory, 'cloudflared-started');
  spawnSync('mkdir', [tools]);
  writeFileSync(join(tools, 'cloudflared'), `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexec sleep 30\n`, {
    mode: 0o700,
  });
  const demo = spawn(join(bin, 'walleterm'), ['demo', '--port', String(port)], {
    cwd: work,
    env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, BUN_OPTIONS: '--preload ./preload.ts' },
    stdio: 'ignore',
  });
  try {
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 10000;
    while (!existsSync(marker) && Date.now() < deadline) await delay(50);
    expect(existsSync(marker)).toBe(true);
    const session = await fetch(`${origin}/api/session`);
    expect(await session.json()).toEqual({ service: 'walleterm-demo' });
    for (const [route, [path, type]] of Object.entries(demoFiles(dist))) {
      const response = await fetch(origin + route);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(`${type}; charset=utf-8`);
      expect(Buffer.from(await response.arrayBuffer()).equals(readFileSync(path))).toBe(true);
    }
    expect(existsSync(join(work, 'ran'))).toBe(false);
  } finally {
    const exited = new Promise((resolve) => demo.once('exit', resolve));
    demo.kill('SIGTERM');
    await exited;
  }
}, 30000);
