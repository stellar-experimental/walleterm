import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { tokenize } from '../../demo/site/syntax.ts';

test('the browser syntax bundle matches the typed tokenizer entry', async () => {
  const built: typeof import('../../demo/site/syntax.ts') = await import(
    new URL('../../dist/demo/site/syntax.js', import.meta.url).href
  );
  for (const [source, language] of [
    ['{"html":"<script>☃</script>","ok":true}', 'json'],
    ['walleterm tunnel\nprintf "$HOME"\n', 'bash'],
    ['unrecognized', 'unknown'],
  ]) {
    assert.deepEqual(built.tokenize(source, language), tokenize(source, language));
  }
});
