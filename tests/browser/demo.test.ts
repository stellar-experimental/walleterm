// The embedded demo website from the Rust host: every module that the entry points import is served.
// Ported from the demo cases in bridge/code-view.test.ts.
import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHost } from './host.ts';

test('the demo serves every imported module under the strict CSP', async () => {
  const host = await createHost({ demo: true });
  onTestFinished(() => host.close());
  const origin = host.demoOrigin!;
  const visited = new Set<string>();
  async function checkModule(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self';/);
    const source = await response.text();
    for (const dependency of new Bun.Transpiler({ loader: 'js' }).scanImports(source)) {
      if (dependency.path.endsWith('.js'))
        await checkModule(new URL(dependency.path, origin + path).pathname);
    }
  }
  for (const path of ['/app.js', '/activity.js', '/code-view.js', '/sdk/connect.js', '/sdk/scan.js'])
    await checkModule(path);
  const page = await (await fetch(origin + '/')).text();
  assert.equal(page, await readFile(new URL('../../demo/site/index.html', import.meta.url), 'utf8'));
  for (const reference of page.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const response = await fetch(origin + reference[1]);
    assert.equal(response.status, 200, reference[1]);
  }
});
