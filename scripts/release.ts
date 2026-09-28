import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Build, sign, and notarize a release on the maintainer's Mac. The signing key stays in its keychain.
const TEAM_ID = 'T4GBHCYB7P';
const NOTARY_PROFILE = 'walleterm-notary';
const REPOSITORY = 'stellar-experimental/walleterm';
const root = fileURLToPath(new URL('../', import.meta.url));
const [version, ...flags] = process.argv.slice(2);
const publish = flags.includes('--publish'),
  skipNotary = flags.includes('--no-notarize');
if (
  !/^\d+\.\d+\.\d+$/.test(version ?? '') ||
  flags.some((flag) => !['--publish', '--no-notarize'].includes(flag)) ||
  (publish && skipNotary)
)
  fail('Use bun scripts/release.ts <major.minor.patch> [--publish | --no-notarize].');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  fail('Build releases on an Apple silicon Mac.');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
function run(command: string, args: string[], options: { quiet?: boolean; input?: string } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    input: options.input,
    stdio: options.quiet || options.input !== undefined ? 'pipe' : ['ignore', 'pipe', 'inherit'],
  });
  if (result.error || result.status !== 0)
    fail(`${command} ${args[0]} failed.\n${result.stderr ?? ''}${result.stdout ?? ''}`.trim());
  return result.stdout.trim();
}

const tag = `v${version}`;
if (run('git', ['status', '--porcelain', '--untracked-files=no']))
  fail('Commit or stash tracked changes first.');
if (run('git', ['tag', '--list', tag]) || run('git', ['ls-remote', '--tags', 'origin', tag]))
  fail(`The tag ${tag} already exists.`);
if (publish) {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', 'origin/main']))
    fail('Publish from a checkout of origin/main.');
}
const identities = run('security', ['find-identity', '-v', '-p', 'codesigning'], { quiet: true });
const identity = identities
  .split('\n')
  .find((line) => line.includes('"Developer ID Application:') && line.includes(`(${TEAM_ID})"`))
  ?.match(/\b[0-9A-F]{40}\b/)?.[0];
if (!identity) fail(`Install the Developer ID Application certificate for team ${TEAM_ID}.`);

const out = join(root, 'release', version);
const stage = join(out, 'walleterm');
rmSync(out, { recursive: true, force: true });
run(process.execPath, ['scripts/package.ts', stage, version]);

// Hardened runtime is required for notarization. Only the Bun JIT receives an entitlement.
for (const [file, entitlements] of [
  ['walleterm', []],
  ['walleterm-bridge', ['--entitlements', join(root, 'scripts/bridge.entitlements.plist')]],
] as const) {
  const path = join(stage, file);
  run('codesign', [
    '--force',
    '--timestamp',
    '--options',
    'runtime',
    ...entitlements,
    '--sign',
    identity,
    path,
  ]);
  run('codesign', ['--verify', '--strict', path], { quiet: true });
  const details = spawnSync('codesign', ['-dv', path], { encoding: 'utf8' }).stderr;
  if (!details.includes(`TeamIdentifier=${TEAM_ID}`) || !/flags=0x10000\(runtime\)/.test(details))
    fail(`${file} does not have the expected signature.`);
}
if (run(join(stage, 'walleterm'), ['--version']) !== `walleterm ${version}`)
  fail('The version check failed.');
const check = spawnSync(join(stage, 'walleterm'), ['sign-auth'], { input: '{}', encoding: 'utf8' });
if (check.status !== 2 || !check.stdout.includes('"invalid_input"')) fail('The signed bridge did not start.');

const archive = join(out, `walleterm-${version}-darwin-arm64.zip`);
run('ditto', ['-c', '-k', '--norsrc', stage, archive]);
if (!skipNotary) {
  const submitted = JSON.parse(
    run('xcrun', [
      'notarytool',
      'submit',
      archive,
      '--keychain-profile',
      NOTARY_PROFILE,
      '--wait',
      '--output-format',
      'json',
    ]),
  );
  if (submitted.status !== 'Accepted') {
    spawnSync('xcrun', ['notarytool', 'log', submitted.id, '--keychain-profile', NOTARY_PROFILE], {
      stdio: 'inherit',
    });
    fail(`Apple notarization returned ${submitted.status}.`);
  }
}
const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
const checksums = join(out, 'checksums.txt');
writeFileSync(checksums, `${sha256}  ${basename(archive)}\n`);
copyFileSync(join(stage, 'NOTICES.txt'), join(out, 'NOTICES.txt'));
const caskPath = join(root, 'Casks/walleterm.rb');
const cask = readFileSync(caskPath, 'utf8')
  .replace(/version "[^"]+"/, `version "${version}"`)
  .replace(/sha256 "[0-9a-f]{64}"/, `sha256 "${sha256}"`);
console.log(`Built ${basename(archive)} (${sha256}).`);
if (!publish) {
  console.log(
    `${skipNotary ? 'Apple did not notarize this archive. Do not publish it.' : 'Apple notarized the archive.'}`,
  );
  console.log(`Publish with: bun scripts/release.ts ${version} --publish`);
  process.exit(0);
}

// Publish the tagged source, then point the cask at the uploaded archive.
run('git', ['tag', '--annotate', tag, '--message', `walleterm ${version}`]);
run('git', ['push', 'origin', tag]);
run('gh', [
  'release',
  'create',
  tag,
  archive,
  checksums,
  join(out, 'NOTICES.txt'),
  '--repo',
  REPOSITORY,
  '--title',
  `walleterm ${version}`,
  '--generate-notes',
  '--verify-tag',
]);
writeFileSync(caskPath, cask);
run('git', ['commit', '--quiet', '--message', `Point the cask at walleterm ${version}`, '--', caskPath]);
run('git', ['push', 'origin', 'HEAD:main']);
console.log(
  `Published ${tag}. Install with: brew install --cask ${REPOSITORY.split('/')[0]}/walleterm/walleterm`,
);
