import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const fail of [true, false])
  test(`installation ${fail ? 'failure preserves the previous release' : 'switches to a complete release'}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'walleterm-install-'));
    const prefix = join(root, 'prefix');
    const mock = join(root, 'tools');
    mkdirSync(join(prefix, 'bin'), { recursive: true });
    mkdirSync(mock);
    writeFileSync(join(prefix, 'bin', 'walleterm'), 'old binary');
    writeFileSync(
      join(mock, 'go'),
      '#!/bin/sh\nif [ "$1" = version ]; then exit 0; fi\nprintf "new binary" > "$4"\n',
      { mode: 0o700 },
    );
    writeFileSync(
      join(mock, 'bun'),
      `#!/bin/sh\nif [ "$1" = --version ]; then exit 0; fi\nif [ "$1" = run ]; then cp -R "$WALLETERM_TEST_ASSETS" dist; fi\nexit ${fail ? 1 : 0}\n`,
      { mode: 0o700 },
    );
    try {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./install.ts', import.meta.url)), prefix],
        {
          env: {
            ...process.env,
            PATH: `${mock}:${process.env.PATH}`,
            WALLETERM_TEST_ASSETS: fileURLToPath(new URL('../dist', import.meta.url)),
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, fail ? 1 : 0, result.stderr);
      assert.equal(
        readFileSync(join(prefix, 'bin', 'walleterm'), 'utf8'),
        fail ? 'old binary' : 'new binary',
      );
      const releases = join(prefix, 'share', 'walleterm', 'releases');
      assert.equal(
        readdirSync(releases).some((name) => name.startsWith('.install-')),
        false,
      );
      if (!fail) {
        const binary = realpathSync(join(prefix, 'bin', 'walleterm'));
        const release = join(binary, '..', '..');
        assert.equal(existsSync(join(release, 'bridge', 'entry.ts')), true);
        assert.equal(existsSync(join(release, 'demo', 'entry.ts')), true);
        assert.equal(existsSync(join(release, 'demo', 'site', 'activity.css')), true);
        for (const asset of ['app.js', 'activity.js'])
          assert.equal(existsSync(join(release, 'dist', 'demo', 'site', asset)), true);
        assert.equal(existsSync(join(release, 'sdk', 'connect.css')), true);
        for (const asset of ['walleterm.js', 'connect.js', 'scan.js'])
          assert.equal(existsSync(join(release, 'dist', 'sdk', asset)), true);
        assert.equal(existsSync(join(release, 'bridge', 'tunnel-child.ts')), true);
        assert.equal(realpathSync(join(prefix, 'bin', 'stellar-walleterm')), binary);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
