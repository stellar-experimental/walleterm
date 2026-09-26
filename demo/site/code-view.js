// Demo-only presentation. Keep source text separate from tokens and clipboard data.
let syntax;
const loadSyntax = () => syntax ||= import('./vendor/syntax.js');
export const MAX_HIGHLIGHT_LENGTH = 50000;
const MAX_TOKENS = 12000;

export async function highlightCode(code, source, language) {
  code.textContent = source;
  if (source.length > MAX_HIGHLIGHT_LENGTH) return false;
  try {
    const { tokenize } = await loadSyntax();
    // A newer render can replace this source while the module loads.
    if (code.textContent !== source) return false;
    const result = tokenize(source, language);
    if (!result || result.tokens.length / 3 > MAX_TOKENS) return false;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (let i = 0; i < result.tokens.length; i += 3) {
      const [type, start, end] = result.tokens.subarray(i, i + 3);
      if (start > cursor) fragment.append(document.createTextNode(source.slice(cursor, start)));
      const span = document.createElement('span'); span.className = `tok ${result.token_types[type]}`;
      span.textContent = source.slice(start, end); fragment.append(span); cursor = end;
    }
    if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
    code.replaceChildren(fragment); return true;
  } catch { return false; } // Plain text remains usable if loading or highlighting fails.
}

export function createCodeView(container, { language = 'json', label = 'JSON', disclosure } = {}) {
  container.classList.add('code-view');
  const heading = document.createElement('div'); heading.className = 'code-heading';
  const title = document.createElement('span'); title.textContent = label;
  const meta = document.createElement('span'); meta.className = 'code-meta';
  const hint = document.createElement('span'); hint.className = 'code-scroll-hint'; hint.textContent = 'Scroll to view →'; hint.hidden = true;
  heading.append(title, meta, hint);
  const pre = document.createElement('pre'); pre.className = 'code-scroll'; pre.tabIndex = 0;
  pre.setAttribute('role', 'region'); pre.setAttribute('aria-label', `${label} code. Scroll for more.`);
  const code = document.createElement('code'); code.className = 'twinkleplop'; pre.append(code);
  container.replaceChildren(heading, pre);
  let source = '', rendered, revision = 0;
  const measure = () => { hint.hidden = pre.scrollWidth <= pre.clientWidth + 1; };
  const render = async () => {
    if (disclosure && !disclosure.open || rendered === source) return;
    rendered = source; const current = ++revision;
    const lines = source.split('\n').length;
    meta.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
    const highlighted = await highlightCode(code, source, language);
    if (current !== revision) return;
    if (!highlighted) meta.textContent += ' · Plain text';
    measure();
  };
  disclosure?.addEventListener('toggle', () => { if (disclosure.open) { render(); measure(); } });
  // Only expanded blocks need an observer. Cached rows keep their scroll position.
  let observer;
  const observe = () => {
    if (!observer && typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(measure); observer.observe(pre); }
  };
  disclosure?.addEventListener('toggle', () => { if (disclosure.open) observe(); });
  if (!disclosure) observe();
  return text => {
    if (source === text && rendered !== undefined) return;
    source = text; render();
  };
}

export function highlightConnectionCommand(root) {
  const code = root.querySelector('.wt-command code'), dialog = root.querySelector('dialog');
  if (!code || !dialog) return;
  // Keep the optional SDK independent of the demo's highlighter.
  const observer = new MutationObserver(() => {
    if (!dialog.open) return;
    observer.disconnect(); code.classList.add('twinkleplop');
    highlightCode(code, code.textContent, 'bash');
  });
  observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
}
