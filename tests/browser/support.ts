// Offline test support. Nothing here reads keys or reaches a live network.
import { readFileSync } from 'node:fs';

/** An `until` check returns a falsy value to wait, or its result to finish. */
export type Falsy<T> = T | false | null | undefined;

export function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** The SDK always sends an abort signal. A missing signal fails the test. */
export function requestSignal(options: RequestInit | undefined): AbortSignal {
  if (!options?.signal) throw Error('The request has no abort signal.');
  return options.signal;
}

const transpiler = new Bun.Transpiler({ loader: 'ts' });
/**
 * Browser tests run TypeScript sources as VM scripts. Transpile the source, then remove module syntax.
 * The VM context supplies each imported name.
 */
export function browserScript(url: URL): string {
  return transpiler
    .transformSync(readFileSync(url, 'utf8'))
    .replace(/^import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"];?\n/gm, '')
    .replace(/^export \* from .*\n/gm, '')
    .replace(/^export \{[^}]*\}(?: from ['"][^'"]+['"])?;?\n/gm, '')
    .replace(/^export (?=(?:async )?(?:class|function|const|let) )/gm, '');
}
