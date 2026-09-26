import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('the committed syntax bundle matches the pinned source and dependencies', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./build-syntax.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
