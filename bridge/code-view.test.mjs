import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemoSite } from '../demo/server.mjs';
import { createCodeView, highlightCode, MAX_HIGHLIGHT_LENGTH } from '../demo/site/code-view.js';

class Node {
  constructor(tag = '') { this.tag = tag; this.children = []; this.events = {}; this.classList = { add() {} }; }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  append(...children) { this.children.push(...children.flatMap(child => child.tag === 'fragment' ? child.children : [child])); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute() {}
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  dispatch(name) { this.events[name]?.forEach(callback => callback()); }
}
globalThis.document = { createElement: tag => new Node(tag), createDocumentFragment: () => new Node('fragment'), createTextNode: text => String(text) };
const turn = () => new Promise(resolve => setImmediate(resolve));

test('JSON tokens preserve source text and keep HTML inert', async () => {
  const code = new Node('code');
  const source = JSON.stringify({ html: '</code><script>alert(1)</script>&', unicode: '☃ 😀', escaped: '\n\t"', count: 4, ok: true, empty: null }, null, 2);
  assert.equal(await highlightCode(code, source, 'json'), true);
  assert.equal(code.textContent, source);
  assert.ok(code.children.some(node => node.className?.includes('boolean')));
  assert.ok(code.children.every(node => typeof node === 'string' || node.tag === 'span'));
});

test('terminal command highlighting preserves spaces and newlines', async () => {
  const code = new Node('code'), source = 'walleterm tunnel\n# Scan on your phone\nprintf "$HOME"\r\n';
  assert.equal(await highlightCode(code, source, 'bash'), true);
  assert.equal(code.textContent, source);
});

test('large, dense, and unsupported source remains complete plain text', async () => {
  for (const [source, language] of [['x'.repeat(MAX_HIGHLIGHT_LENGTH + 1), 'json'], ['[0,'.repeat(7000), 'json'], ['<p>Hello</p>', 'unknown']]) {
    const code = new Node('code');
    assert.equal(await highlightCode(code, source, language), false);
    assert.equal(code.textContent, source);
    assert.equal(code.children.length, 1);
  }
});

test('an older asynchronous highlight cannot replace newer content', async () => {
  const code = new Node('code');
  const old = highlightCode(code, '{"old": true}', 'json');
  const next = highlightCode(code, '{"new": true}', 'json');
  await Promise.all([old, next]);
  assert.equal(code.textContent, '{"new": true}');
});

test('disclosures highlight on demand and preserve unchanged DOM and scroll', async () => {
  const container = new Node('div'), disclosure = new Node('details'); disclosure.open = false;
  const update = createCodeView(container, { disclosure });
  const pre = container.children[1], code = pre.children[0];
  update('{"value": 1}');
  assert.equal(code.textContent, '');
  disclosure.open = true; disclosure.dispatch('toggle'); await turn();
  assert.equal(code.textContent, '{"value": 1}');
  const token = code.children[0]; pre.scrollLeft = 100;
  update('{"value": 1}'); disclosure.dispatch('toggle'); await turn();
  assert.equal(code.children[0], token); assert.equal(pre.scrollLeft, 100);
  disclosure.open = false; update('{"value": 2}');
  assert.equal(code.textContent, '{"value": 1}');
  disclosure.open = true; disclosure.dispatch('toggle'); await turn();
  assert.equal(code.textContent, '{"value": 2}');
});

test('demo serves the exact bundled assets under the existing strict CSP', async () => {
  const app = createDemoSite({ port: 0 }); await app.listen();
  try {
    for (const path of ['code-view.js', 'code-view.css', 'vendor/syntax.js', 'vendor/syntax.LICENSE']) {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}/${path}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), await readFile(new URL(`../demo/site/${path}`, import.meta.url), 'utf8'));
      assert.match(response.headers.get('content-security-policy'), /script-src 'self';/);
    }
  } finally { await app.close(); }
});
