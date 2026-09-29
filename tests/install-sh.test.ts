import { afterAll, afterEach, beforeAll, beforeEach, expect, setDefaultTimeout, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// site/install.sh runs against stand-ins for curl, codesign, and sysctl on PATH. The script itself has no test switches.
// The stand-ins are written once and read FAKE_* variables, because macOS can check each new executable slowly.
const script = new URL('../site/install.sh', import.meta.url).pathname;
const archive = 'walleterm-0.2.0-darwin-arm64.zip';
const tools = mkdtempSync(join(tmpdir(), 'walleterm-install-sh-tools-'));
let root: string;
let fake: Record<string, string>;

setDefaultTimeout(30_000);

beforeAll(() => {
  const tool = (name: string, body: string) => {
    writeFileSync(join(tools, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(tools, name), 0o755);
  };
  // curl copies the file named by the last URL segment and records every URL it fetched.
  tool(
    'curl',
    `for a; do case "$a" in https://*) url="$a";; esac; done
echo "$url" >> "$FAKE_ROOT/urls"
while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done
cp "$FAKE_ROOT/files/\${url##*/}" "$out"`,
  );
  tool('codesign', 'case "$1" in --verify) exit 0;; -d) echo "TeamIdentifier=$FAKE_TEAM" >&2;; esac');
  tool('sysctl', 'echo "$FAKE_ARM64"');
});
afterAll(() => rmSync(tools, { recursive: true, force: true }));

function release({
  checksum,
  team = '4JWM8JNM37',
  arm64 = '1',
}: {
  checksum?: string;
  team?: string;
  arm64?: string;
}) {
  const stage = join(root, 'stage');
  mkdirSync(stage);
  writeFileSync(join(stage, 'walleterm'), '#!/bin/sh\necho "walleterm 0.2.0"\n');
  chmodSync(join(stage, 'walleterm'), 0o755);
  writeFileSync(join(stage, 'NOTICES.txt'), 'notices\n');
  Bun.spawnSync(['ditto', '-c', '-k', '--norsrc', stage, join(root, 'files', archive)]);
  const sha = createHash('sha256')
    .update(readFileSync(join(root, 'files', archive)))
    .digest('hex');
  writeFileSync(join(root, 'files', 'checksums.txt'), `${checksum ?? sha}  ${archive}\n`);
  fake = { FAKE_ROOT: root, FAKE_TEAM: team, FAKE_ARM64: arm64 };
}

function install(env: Record<string, string> = {}) {
  const run = Bun.spawnSync(['/bin/sh', script], {
    env: { PATH: `${tools}:/usr/bin:/bin`, HOME: join(root, 'home'), ...fake, ...env },
  });
  return { status: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'walleterm-install-sh-'));
  mkdirSync(join(root, 'files'));
  mkdirSync(join(root, 'home'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('installs the latest release into ~/.local/bin with its alias', () => {
  release({});
  const result = install();
  expect(result.err).toBe('');
  expect(result.status).toBe(0);
  const bin = join(root, 'home', '.local', 'bin');
  expect(result.out).toContain(`Installed walleterm 0.2.0 to ${bin}/walleterm`);
  expect(result.out).toContain(`Add ${bin} to your PATH`);
  expect(readlinkSync(join(bin, 'stellar-walleterm'))).toBe('walleterm');
  expect(readFileSync(join(root, 'urls'), 'utf8').trim().split('\n')).toEqual([
    'https://github.com/stellar-experimental/walleterm/releases/latest/download/checksums.txt',
    `https://github.com/stellar-experimental/walleterm/releases/latest/download/${archive}`,
  ]);
});

test('installs a pinned version into a chosen directory', () => {
  release({});
  const dir = join(root, 'custom');
  const result = install({ WALLETERM_VERSION: 'v0.2.0', WALLETERM_INSTALL_DIR: dir });
  expect(result.status).toBe(0);
  expect(existsSync(join(dir, 'walleterm'))).toBe(true);
  expect(readFileSync(join(root, 'urls'), 'utf8')).toContain('/releases/download/v0.2.0/checksums.txt');
});

test('refuses an archive that does not match its checksum', () => {
  release({ checksum: '0'.repeat(64) });
  const result = install();
  expect(result.status).toBe(1);
  expect(result.err).toContain('does not match its SHA-256');
  expect(existsSync(join(root, 'home', '.local', 'bin', 'walleterm'))).toBe(false);
});

test('refuses a binary from another signing team', () => {
  release({ team: 'ABCDE12345' });
  const result = install();
  expect(result.status).toBe(1);
  expect(result.err).toContain('not signed by Developer ID team 4JWM8JNM37');
  expect(existsSync(join(root, 'home', '.local', 'bin', 'walleterm'))).toBe(false);
});

test('refuses Intel Macs, including a Rosetta shell on Apple silicon', () => {
  release({ arm64: '0' });
  const result = install();
  expect(result.status).toBe(1);
  expect(result.err).toContain('only on macOS with Apple silicon');
  expect(existsSync(join(root, 'urls'))).toBe(false);
});

test('warns when another walleterm runs first on PATH', () => {
  release({});
  const bin = join(root, 'home', '.local', 'bin');
  const other = join(root, 'other');
  mkdirSync(other);
  writeFileSync(join(other, 'walleterm'), '#!/bin/sh\n');
  chmodSync(join(other, 'walleterm'), 0o755);
  const result = install({ PATH: `${tools}:${other}:${bin}:/usr/bin:/bin` });
  expect(result.status).toBe(0);
  expect(result.out).toContain(`Your PATH runs ${join(other, 'walleterm')} first.`);
});
