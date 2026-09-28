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
    writeFileSync(join(mock, 'go'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    // The mock package step writes both binaries, then succeeds or fails.
    writeFileSync(
      join(mock, 'bun'),
      `#!/bin/sh\nmkdir -p "$2"\nprintf "new binary" > "$2/walleterm"\nprintf "new bridge" > "$2/walleterm-bridge"\nexit ${fail ? 1 : 0}\n`,
      { mode: 0o700 },
    );
    try {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./install.ts', import.meta.url)), prefix],
        {
          env: { ...process.env, PATH: `${mock}:${process.env.PATH}` },
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
        assert.equal(readFileSync(join(binary, '..', 'walleterm-bridge'), 'utf8'), 'new bridge');
        assert.equal(realpathSync(join(prefix, 'bin', 'stellar-walleterm')), binary);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
