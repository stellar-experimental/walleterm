// The code view in a small DOM model. tests/browser/demo.test.ts and tests/demo.rs cover the served files.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { browserScript } from './support.ts';
import { tokenize } from '../../demo/site/syntax.ts';

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
  browserScript(new URL('../../demo/site/code-view.ts', import.meta.url)) +
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
