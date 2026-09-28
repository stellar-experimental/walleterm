import { requestError } from '../sdk/errors.ts';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = resolve(process.argv[2]);
let stage, link;
try {
  if (!Bun.semver.satisfies(Bun.version, '>=1.4.2'))
    throw Error('Install Bun 1.4.2 or later, then run make install.');
  const go = spawnSync('go', ['version'], { stdio: 'ignore' });
  if (go.error || go.status !== 0) throw Error('Install go, then run make install.');
  const versions = join(prefix, 'share', 'walleterm', 'releases');
  mkdirSync(versions, { recursive: true });
  stage = mkdtempSync(join(versions, '.install-'));
  // Build both binaries in the stage. A failed build leaves the installed command unchanged.
  const build = spawnSync('bun', [join(root, 'scripts', 'package.ts'), join(stage, 'bin')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (build.error || build.status !== 0)
    throw Error('The build failed. The installed version did not change.');
  const digest = createHash('sha256');
  for (const file of ['bin/walleterm', 'bin/walleterm-bridge'])
    digest.update(file).update(readFileSync(join(stage, file)));
  const release = join(versions, digest.digest('hex').slice(0, 24));
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
