import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  exit('Use bun scripts/release.ts <major.minor.patch> [--publish | --no-notarize].');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  exit('Build releases on an Apple silicon Mac.');

function exit(message: string): never {
  console.error(message);
  process.exit(1);
}

function fail(message: string): never {
  throw Error(message);
}
// Tools run with a minimal environment. A loaded .env or shell setting cannot change the build.
const environment: NodeJS.ProcessEnv = { GOTOOLCHAIN: 'local' };
for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'SSH_AUTH_SOCK', 'GH_TOKEN'])
  if (process.env[name] !== undefined) environment[name] = process.env[name];
function run(command: string, args: string[], cwd = root, quiet = false) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : ['ignore', 'pipe', 'inherit'],
  });
  if (result.error || result.status !== 0)
    fail(`${command} ${args[0]} failed.\n${result.stderr ?? ''}${result.stdout ?? ''}`.trim());
  return result.stdout.trim();
}

let source: string | undefined;
try {
  release();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  if (source) spawnSync('git', ['worktree', 'remove', '--force', source], { cwd: root, stdio: 'inherit' });
}

function release() {
  const tag = `v${version}`;
  if (run('git', ['status', '--porcelain', '--untracked-files=no']))
    fail('Commit or stash tracked changes first.');
  if (run('git', ['tag', '--list', tag]) || run('git', ['ls-remote', '--tags', 'origin', tag]))
    fail(`The tag ${tag} already exists.`);
  const commit = run('git', ['rev-parse', 'HEAD']);
  if (publish) {
    run('git', ['fetch', '--quiet', 'origin', 'main']);
    if (commit !== run('git', ['rev-parse', 'origin/main'])) fail('Publish from a checkout of origin/main.');
    const runs = JSON.parse(
      run('gh', [
        'run',
        'list',
        '--repo',
        REPOSITORY,
        '--commit',
        commit,
        '--workflow',
        'test.yml',
        '--json',
        'conclusion',
      ]),
    );
    if (!runs.some((item: { conclusion: string }) => item.conclusion === 'success'))
      fail(`Wait for a passing Test workflow on ${commit.slice(0, 7)}.`);
  }
  // Use the exact toolchain that CI tests.
  const workflow = readFileSync(join(root, '.github/workflows/test.yml'), 'utf8');
  const pinned = (name: string) => workflow.match(new RegExp(`${name}: '([^']+)'`))?.[1];
  const toolchain = { bun: Bun.version, go: run('go', ['env', 'GOVERSION']).replace(/^go/, '') };
  if (toolchain.bun !== pinned('bun-version') || toolchain.go !== pinned('go-version'))
    fail(`Use Bun ${pinned('bun-version')} and Go ${pinned('go-version')}, as CI does.`);
  const identities = run('security', ['find-identity', '-v', '-p', 'codesigning'], root, true);
  const identity = identities
    .split('\n')
    .find((line) => line.includes('"Developer ID Application:') && line.includes(`(${TEAM_ID})"`))
    ?.match(/\b[0-9A-F]{40}\b/)?.[0];
  if (!identity) fail(`Install the Developer ID Application certificate for team ${TEAM_ID}.`);

  // Build from a fresh worktree of HEAD. Ignored files and local dependencies cannot enter the release.
  const out = join(root, 'release', version);
  const stage = join(out, 'walleterm');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  source = join(mkdtempSync(join(tmpdir(), 'walleterm-release-')), 'source');
  run('git', ['worktree', 'add', '--quiet', '--detach', source, commit]);
  {
    run('bun', ['install', '--frozen-lockfile', '--ignore-scripts', '--production'], source);
    run(process.execPath, ['--no-env-file', 'scripts/package.ts', stage, version], source);

    // Hardened runtime is required for notarization. Only the Bun JIT receives an entitlement.
    for (const [file, entitlements] of [
      ['walleterm', []],
      ['walleterm-bridge', ['com.apple.security.cs.allow-jit']],
    ] as const) {
      const path = join(stage, file);
      const plist = entitlements.length
        ? ['--entitlements', join(source, 'scripts/bridge.entitlements.plist')]
        : [];
      run(
        'codesign',
        ['--force', '--timestamp', '--options', 'runtime', ...plist, '--sign', identity, path],
        root,
        true,
      );
      run('codesign', ['--verify', '--strict', path], root, true);
      const details = spawnSync('codesign', ['-dvv', path], { encoding: 'utf8' }).stderr;
      const granted = [
        ...run('codesign', ['-d', '--entitlements', '-', '--xml', path], root, true).matchAll(
          /<key>([^<]+)<\/key>/g,
        ),
      ].map((match) => match[1]);
      if (
        !details.includes(`Authority=Developer ID Application:`) ||
        !details.includes(`TeamIdentifier=${TEAM_ID}`) ||
        !/flags=0x10000\(runtime\)/.test(details) ||
        granted.join() !== entitlements.join()
      )
        fail(`${file} does not have the expected signature or entitlements.`);
    }
    if (run(join(stage, 'walleterm'), ['--version']) !== `walleterm ${version}`)
      fail('The version check failed.');
    const check = spawnSync(join(stage, 'walleterm'), ['sign-auth'], { input: '{}', encoding: 'utf8' });
    if (check.status !== 2 || !check.stdout.includes('"invalid_input"'))
      fail('The signed bridge did not start.');

    const archive = join(out, `walleterm-${version}-darwin-arm64${skipNotary ? '-unnotarized' : ''}.zip`);
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
    console.log(`Built ${basename(archive)} (${sha256}) from ${commit.slice(0, 7)}.`);
    console.log(`Toolchain: Bun ${toolchain.bun}, Go ${toolchain.go}.`);
    if (!publish) {
      console.log(
        skipNotary
          ? 'Apple did not notarize this archive. Do not publish it.'
          : 'Apple notarized the archive.',
      );
      console.log(`Publish with: bun scripts/release.ts ${version} --publish`);
      return;
    }

    // Publish the tagged source, then check the uploaded archive against the local checksum.
    run('git', ['tag', '--annotate', tag, '--message', `walleterm ${version}`, commit]);
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
      '--notes',
      `Built from ${commit} with Bun ${toolchain.bun} and Go ${toolchain.go}. Signed by Developer ID team ${TEAM_ID} and notarized by Apple.`,
      '--generate-notes',
      '--verify-tag',
    ]);
    const download = mkdtempSync(join(tmpdir(), 'walleterm-download-'));
    run('gh', [
      'release',
      'download',
      tag,
      '--repo',
      REPOSITORY,
      '--pattern',
      basename(archive),
      '--dir',
      download,
    ]);
    if (
      createHash('sha256')
        .update(readFileSync(join(download, basename(archive))))
        .digest('hex') !== sha256
    )
      fail('The uploaded archive does not match the local checksum.');
    rmSync(download, { recursive: true, force: true });

    // Propose the cask change for review. Nothing pushes to main directly.
    const branch = `cask-${version}`;
    const caskPath = join(source, 'Casks/walleterm.rb');
    writeFileSync(
      caskPath,
      readFileSync(caskPath, 'utf8')
        .replace(/version "[^"]+"/, `version "${version}"`)
        .replace(/sha256 "[0-9a-f]{64}"/, `sha256 "${sha256}"`),
    );
    run('git', ['switch', '--quiet', '--create', branch], source);
    run(
      'git',
      ['commit', '--quiet', '--message', `Point the cask at walleterm ${version}`, '--', caskPath],
      source,
    );
    run('git', ['push', '--quiet', 'origin', branch], source);
    const pr = run(
      'gh',
      [
        'pr',
        'create',
        '--repo',
        REPOSITORY,
        '--head',
        branch,
        '--title',
        `Point the cask at walleterm ${version}`,
        '--body',
        `The release ${tag} archive has SHA-256 \`${sha256}\`. Merge to publish it to Homebrew users.`,
      ],
      source,
    );
    console.log(`Published ${tag}. Merge ${pr} to update the Homebrew cask.`);
    console.log(
      `Install: brew tap ${REPOSITORY} https://github.com/${REPOSITORY} && brew install --cask ${REPOSITORY}/walleterm`,
    );
  }
}
