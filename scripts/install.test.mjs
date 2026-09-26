import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const fail of [true, false]) test(`installation ${fail ? 'failure preserves the previous release' : 'switches to a complete release'}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'walleterm-install-'));
  const prefix = join(root, 'prefix'); const mock = join(root, 'tools');
  mkdirSync(join(prefix, 'bin'), { recursive: true }); mkdirSync(mock);
  writeFileSync(join(prefix, 'bin', 'walleterm'), 'old binary');
  writeFileSync(join(mock, 'go'), '#!/bin/sh\nif [ "$1" = version ]; then exit 0; fi\nprintf "new binary" > "$4"\n', { mode: 0o700 });
  writeFileSync(join(mock, 'npm'), `#!/bin/sh\nif [ "$1" = version ]; then exit 0; fi\nexit ${fail ? 1 : 0}\n`, { mode: 0o700 });
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./install.mjs', import.meta.url)), prefix],
      { env: { ...process.env, PATH: `${mock}:${process.env.PATH}` }, encoding: 'utf8' });
    assert.equal(result.status, fail ? 1 : 0, result.stderr);
    assert.equal(readFileSync(join(prefix, 'bin', 'walleterm'), 'utf8'), fail ? 'old binary' : 'new binary');
    const releases = join(prefix, 'share', 'walleterm', 'releases');
    assert.equal(readdirSync(releases).some(name => name.startsWith('.install-')), false);
    if (!fail) {
      const binary = realpathSync(join(prefix, 'bin', 'walleterm'));
      const release = join(binary, '..', '..');
      assert.equal(existsSync(join(release, 'bridge', 'entry.mjs')), true);
      assert.equal(existsSync(join(release, 'demo', 'entry.mjs')), true);
      for (const asset of ['activity.js', 'activity.css', 'code-view.js', 'code-view.css', 'vendor/syntax.js', 'vendor/syntax.LICENSE']) assert.equal(existsSync(join(release, 'demo', 'site', asset)), true);
      for (const asset of ['walleterm.js', 'connect.js', 'connect.css', 'scan.js']) assert.equal(existsSync(join(release, 'sdk', asset)), true);
      assert.equal(existsSync(join(release, 'bridge', 'tunnel-child.mjs')), true);
      assert.equal(realpathSync(join(prefix, 'bin', 'stellar-walleterm')), binary);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
