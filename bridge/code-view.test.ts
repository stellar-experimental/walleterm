import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemoSite } from '../demo/server.ts';
import vm from 'node:vm';
import { browserScript, listeningPort } from './test/support.ts';
import { tokenize } from '../demo/site/syntax.ts';

class Node {
  children: (Node | string)[] = [];
  events: Record<string, (() => void)[]> = {};
  tag: string;
  className = '';
  classList: { add(): void };
  open = false;
  hidden = false;
  tabIndex = 0;
  scrollWidth = 0;
  clientWidth = 0;
  scrollLeft = 0;
  constructor(tag = '') {
    this.tag = tag;
    this.children = [];
    this.events = {};
    this.classList = { add() {} };
  }
  set textContent(value: string) {
    this.children = [String(value)];
  }
  get textContent(): string {
    return this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
  }
  append(...children: (Node | string)[]) {
    this.children.push(
      ...children.flatMap((child) =>
        typeof child !== 'string' && child.tag === 'fragment' ? child.children : [child],
      ),
    );
  }
  replaceChildren(...children: (Node | string)[]) {
    this.children = [];
    this.append(...children);
  }
  setAttribute() {}
  addEventListener(name: string, callback: () => void) {
    (this.events[name] ||= []).push(callback);
  }
  dispatch(name: string) {
    this.events[name]?.forEach((callback) => callback());
  }
}
interface CodeViewModule {
  highlightCode(code: Node, source: string, language: string): Promise<boolean>;
  createCodeView(container: Node, options: { disclosure: Node }): (source: string) => void;
  MAX_HIGHLIGHT_LENGTH: number;
}
const context = vm.createContext({
  syntaxModule: { tokenize },
  document: {
    createElement: (tag: string) => new Node(tag),
    createDocumentFragment: () => new Node('fragment'),
    createTextNode: (text: string) => String(text),
  },
});
const { createCodeView, highlightCode, MAX_HIGHLIGHT_LENGTH }: CodeViewModule = vm.runInContext(
  browserScript(new URL('../demo/site/code-view.ts', import.meta.url)) +
    '\nsyntax = Promise.resolve(syntaxModule); ({ createCodeView, highlightCode, MAX_HIGHLIGHT_LENGTH });',
  context,
);
function child(node: Node, index: number): Node {
  const value = node.children[index];
  assert.ok(value instanceof Node);
  return value;
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

test('JSON tokens preserve source text and keep HTML inert', async () => {
  const code = new Node('code');
  const source = JSON.stringify(
    {
      html: '</code><script>alert(1)</script>&',
      unicode: '☃ 😀',
      escaped: '\n\t"',
      count: 4,
      ok: true,
      empty: null,
    },
    null,
    2,
  );
  assert.equal(await highlightCode(code, source, 'json'), true);
  assert.equal(code.textContent, source);
  assert.ok(code.children.some((node) => typeof node !== 'string' && node.className.includes('boolean')));
  assert.ok(code.children.every((node) => typeof node === 'string' || node.tag === 'span'));
});

test('terminal command highlighting preserves spaces and newlines', async () => {
  const code = new Node('code'),
    source = 'walleterm tunnel\n# Scan on your phone\nprintf "$HOME"\r\n';
  assert.equal(await highlightCode(code, source, 'bash'), true);
  assert.equal(code.textContent, source);
});

test('large, dense, and unsupported source remains complete plain text', async () => {
  for (const [source, language] of [
    ['x'.repeat(MAX_HIGHLIGHT_LENGTH + 1), 'json'],
    ['[0,'.repeat(7000), 'json'],
    ['<p>Hello</p>', 'unknown'],
  ]) {
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
  const container = new Node('div'),
    disclosure = new Node('details');
  disclosure.open = false;
  const update = createCodeView(container, { disclosure });
  const pre = child(container, 1),
    code = child(pre, 0);
  update('{"value": 1}');
  assert.equal(code.textContent, '');
  disclosure.open = true;
  disclosure.dispatch('toggle');
  await turn();
  assert.equal(code.textContent, '{"value": 1}');
  const token = code.children[0];
  pre.scrollLeft = 100;
  update('{"value": 1}');
  disclosure.dispatch('toggle');
  await turn();
  assert.equal(code.children[0], token);
  assert.equal(pre.scrollLeft, 100);
  disclosure.open = false;
  update('{"value": 2}');
  assert.equal(code.textContent, '{"value": 1}');
  disclosure.open = true;
  disclosure.dispatch('toggle');
  await turn();
  assert.equal(code.textContent, '{"value": 2}');
});

test('demo serves the exact bundled assets under the existing strict CSP', async () => {
  const app = createDemoSite({ port: 0 });
  await app.listen();
  try {
    const origin = `http://127.0.0.1:${listeningPort(app.server)}`;
    const visited = new Set<string>();
    async function checkModule(path: string) {
      if (visited.has(path)) return;
      visited.add(path);
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      const source = await response.text();
      for (const dependency of new Bun.Transpiler({ loader: 'js' }).scanImports(source)) {
        if (dependency.path.endsWith('.js'))
          await checkModule(new URL(dependency.path, origin + path).pathname);
      }
    }
    for (const path of ['/app.js', '/activity.js', '/code-view.js', '/sdk/connect.js'])
      await checkModule(path);
    for (const path of ['code-view.js', 'code-view.css', 'vendor/syntax.js', 'vendor/syntax.LICENSE']) {
      const response = await fetch(`http://127.0.0.1:${listeningPort(app.server)}/${path}`);
      assert.equal(response.status, 200);
      assert.equal(
        await response.text(),
        await readFile(
          new URL(
            path === 'code-view.js'
              ? '../dist/demo/site/code-view.js'
              : path === 'vendor/syntax.js'
                ? '../dist/demo/site/syntax.js'
                : `../demo/site/${path}`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
      assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self';/);
    }
  } finally {
    await app.close();
  }
});
