// Offline test support. Nothing here reads keys or reaches a live network.
import { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Server } from 'node:http';

/** An `until` check returns a falsy value to wait, or its result to finish. */
export type Falsy<T> = T | false | null | undefined;

export function listeningPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('The server is not listening on a TCP port.');
  return address.port;
}

export function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** The SDK always sends an abort signal. A missing signal fails the test. */
export function requestSignal(options: RequestInit | undefined): AbortSignal {
  if (!options?.signal) throw Error('The request has no abort signal.');
  return options.signal;
}

/** A child process with in-memory pipes. `kill` records the call and closes with `closeCode`. */
export class MockChild extends ChildProcess implements ChildProcessWithoutNullStreams {
  override stdin = new PassThrough();
  override stdout = new PassThrough();
  override stderr = new PassThrough();
  override readonly stdio: ChildProcessWithoutNullStreams['stdio'] = [
    this.stdin,
    this.stdout,
    this.stderr,
    undefined,
    undefined,
  ];
  override killed = false;
  override exitCode: number | null = null;
  readonly closeCode: number | null;
  constructor(closeCode: number | null = null) {
    super();
    this.closeCode = closeCode;
  }
  override kill() {
    this.killed = true;
    this.exitCode = this.closeCode;
    this.emit('close', this.closeCode, null);
    return true;
  }
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
