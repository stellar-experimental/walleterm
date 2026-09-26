import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = resolve(process.argv[2]);
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw Error(`${command} failed. The installed version did not change.`);
};
let stage, link;
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Install Node.js 22 or later, then run make install.');
  for (const command of ['go', 'npm']) {
    const check = spawnSync(command, ['version'], { stdio: 'ignore' });
    if (check.error || check.status !== 0) throw Error(`Install ${command}, then run make install.`);
  }
  const files = ['package.json', 'package-lock.json',
    'bridge/entry.mjs', 'bridge/launch.mjs', 'bridge/runtime.mjs', 'bridge/tunnel-child.mjs', 'bridge/server.mjs', 'bridge/signer.mjs', 'bridge/transaction.mjs',
    'demo/entry.mjs', 'demo/server.mjs', 'demo/site/code-view.js', 'demo/site/code-view.css', 'demo/site/vendor/syntax.js', 'demo/site/vendor/syntax.LICENSE', 'demo/site/app.js', 'demo/site/activity.js', 'demo/site/activity.css', 'demo/site/index.html', 'demo/site/style.css', 'sdk/walleterm.js', 'sdk/connect.js', 'sdk/connect.css', 'sdk/scan.js'];
  const versions = join(prefix, 'share', 'walleterm', 'releases');
  mkdirSync(versions, { recursive: true });
  stage = mkdtempSync(join(versions, '.install-'));
  mkdirSync(join(stage, 'bin'));
  run('go', ['build', '-trimpath', '-o', join(stage, 'bin', 'walleterm'), '.']);
  for (const file of files) {
    mkdirSync(dirname(join(stage, file)), { recursive: true });
    copyFileSync(join(root, file), join(stage, file));
  }
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
  const digest = createHash('sha256');
  for (const file of ['bin/walleterm', ...files]) digest.update(file).update(readFileSync(join(stage, file)));
  const release = join(versions, digest.digest('hex').slice(0, 24));
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ files, built_at: new Date().toISOString() }) + '\n');
  if (existsSync(release)) rmSync(stage, { recursive: true });
  else renameSync(stage, release);
  stage = null;
  const bin = join(prefix, 'bin');
  mkdirSync(bin, { recursive: true });
  const alias = join(bin, 'stellar-walleterm');
  if (existsSync(alias) && !lstatSync(alias).isSymbolicLink()) throw Error('stellar-walleterm already exists. Preserve it before installing the alias.');
  const aliasLink = join(bin, `.stellar-walleterm-${randomUUID()}`);
  symlinkSync('walleterm', aliasLink);
  renameSync(aliasLink, alias);
  link = join(bin, `.walleterm-${randomUUID()}`);
  symlinkSync(join(release, 'bin', 'walleterm'), link);
  renameSync(link, join(bin, 'walleterm'));
  link = null;
  console.log(`Installed walleterm in ${bin}.`);
} catch (error) {
  if (stage) rmSync(stage, { recursive: true, force: true });
  if (link) rmSync(link, { force: true });
  console.error(error.message);
  process.exitCode = 1;
}
