import { requestError } from '../sdk/errors.ts';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  readdirSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = resolve(process.argv[2]);
const run = (command: string, args: string[], cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw Error(`${command} failed. The installed version did not change.`);
};
let stage, link;
try {
  if (!existsSync(join(root, 'bun.lock')))
    throw Error('The Bun lockfile is missing. Restore it before installing.');
  if (!Bun.semver.satisfies(Bun.version, '>=1.4.2'))
    throw Error('Install Bun 1.4.2 or later, then run make install.');
  for (const command of ['go', 'bun']) {
    const check = spawnSync(command, [command === 'go' ? 'version' : '--version'], { stdio: 'ignore' });
    if (check.error || check.status !== 0) throw Error(`Install ${command}, then run make install.`);
  }
  const files = [
    'package.json',
    'bun.lock',
    'bridge/entry.ts',
    'bridge/launch.ts',
    'bridge/runtime.ts',
    'bridge/tunnel-child.ts',
    'bridge/server.ts',
    'bridge/signer.ts',
    'bridge/transaction.ts',
    'bridge/authorization.ts',
    'bridge/auth-cli.ts',
    'sdk/authorization.ts',
    'sdk/transaction.ts',
    'fixtures/wasm/walleterm_simple_account.wasm',
    'fixtures/wasm/walleterm_auth_target.wasm',
    'demo/site/contracts.ts',
    'demo/entry.ts',
    'demo/server.ts',
    'demo/site/activity.css',
    'demo/site/code-view.ts',
    'demo/site/code-view.css',
    'demo/site/syntax.ts',
    'demo/site/vendor/syntax.LICENSE',
    'demo/site/index.html',
    'demo/site/style.css',
    'sdk/errors.ts',
    'sdk/types.ts',
    'sdk/connect.css',
    'sdk/walleterm.ts',
    'sdk/connect.ts',
    'sdk/scan.ts',
    'demo/site/app.ts',
    'demo/site/activity.ts',
    'scripts/build.ts',
    'tsconfig.json',
    'tsconfig.sdk.json',
  ];
  const versions = join(prefix, 'share', 'walleterm', 'releases');
  mkdirSync(versions, { recursive: true });
  stage = mkdtempSync(join(versions, '.install-'));
  mkdirSync(join(stage, 'bin'));
  run('go', ['build', '-trimpath', '-o', join(stage, 'bin', 'walleterm'), '.']);
  for (const file of files) {
    mkdirSync(dirname(join(stage, file)), { recursive: true });
    copyFileSync(join(root, file), join(stage, file));
  }
  // Each installation builds its own snapshot. Concurrent builds cannot mix browser chunks.
  run('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], stage);
  run('bun', ['run', 'build'], stage);
  files.push(
    ...readdirSync(join(stage, 'dist'), { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(js|ts)$/.test(file))
      .sort()
      .map((file) => `dist/${file}`),
  );
  rmSync(join(stage, 'node_modules'), { recursive: true, force: true });
  run('bun', ['install', '--production', '--frozen-lockfile', '--ignore-scripts'], stage);
  const digest = createHash('sha256');
  for (const file of ['bin/walleterm', ...files]) digest.update(file).update(readFileSync(join(stage, file)));
  const release = join(versions, digest.digest('hex').slice(0, 24));
  writeFileSync(
    join(stage, 'manifest.json'),
    JSON.stringify({ files, built_at: new Date().toISOString() }) + '\n',
  );
  if (existsSync(release)) rmSync(stage, { recursive: true });
  else renameSync(stage, release);
  stage = null;
  const bin = join(prefix, 'bin');
  mkdirSync(bin, { recursive: true });
  const alias = join(bin, 'stellar-walleterm');
  if (existsSync(alias) && !lstatSync(alias).isSymbolicLink())
    throw Error('stellar-walleterm already exists. Preserve it before installing the alias.');
  const aliasLink = join(bin, `.stellar-walleterm-${randomUUID()}`);
  symlinkSync('walleterm', aliasLink);
  renameSync(aliasLink, alias);
  link = join(bin, `.walleterm-${randomUUID()}`);
  symlinkSync(join(release, 'bin', 'walleterm'), link);
  renameSync(link, join(bin, 'walleterm'));
  link = null;
  console.log(`Installed walleterm in ${bin}.`);
} catch (errorValue) {
  const error = requestError(errorValue);
  if (stage) rmSync(stage, { recursive: true, force: true });
  if (link) rmSync(link, { force: true });
  console.error(error.message);
  process.exitCode = 1;
}
