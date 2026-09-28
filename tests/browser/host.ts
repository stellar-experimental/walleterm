// The Rust bridge for SDK tests: `walleterm-test-host` with its dependencies served by these JS mocks.
// Build it first: cargo build --locked --features test-host --bin walleterm-test-host
// Offline only. Each host binds a new loopback port.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Signer } from '../../sdk/types.ts';

export const MARKER = 'WALLETERM_TEST_HOST_ONLY_V1';
const binary =
  process.env.WALLETERM_TEST_HOST ||
  fileURLToPath(new URL('../../target/debug/walleterm-test-host', import.meta.url));

type Options = { signal: AbortSignal };
export interface HostOptions {
  listSigners?: (options: Options) => Promise<Signer[]>;
  sign?: (publicKey: string, digest: string, options: Options) => Promise<string>;
  latestLedger?: (options: Options) => Promise<number>;
  /** Present: every request waits for this review. Absent: the bridge approves valid requests. */
  review?: (request: ReviewRequest, options: Options) => Promise<boolean>;
  log?: (line: string) => unknown;
  /** Also serve the embedded demo website. Its origin is `demoOrigin`. */
  demo?: boolean;
}
export interface ReviewRequest {
  origin: string;
  signer: Signer;
  details: Record<string, unknown>;
}
export interface Pairing {
  walleterm: number;
  url: string;
  code: string;
  expires_at: string;
}
export interface Host {
  origin: string;
  port: number;
  demoOrigin?: string;
  pairing(): Promise<Pairing>;
  code(): Promise<string>;
  /** Move the bridge clock. */
  advance(ms: number): Promise<void>;
  setPublicOrigin(origin: string): Promise<boolean>;
  close(): Promise<void>;
  onPairingChanged(callback: () => void): void;
}

// A thrown mock error becomes a bridge error code. Status 5xx and discovery failures are external errors.
function errorCode(error: unknown): { code: string; message: string } {
  const e = error as { ext?: string[]; status?: number; message?: string; name?: string };
  const message = e?.message ?? String(error);
  if (Array.isArray(e?.ext) && e.ext[0]) return { code: e.ext[0].replace('walleterm:', ''), message };
  if (e?.status && e.status >= 500) return { code: 'bridge_unavailable', message };
  return { code: 'internal', message };
}

export async function createHost(options: HostOptions = {}): Promise<Host> {
  const child = spawn(binary, [], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      PATH: process.env.PATH ?? '',
      ...(options.review ? { WALLETERM_TEST_HOST_REVIEW: '1' } : {}),
      ...(options.demo ? { WALLETERM_TEST_HOST_DEMO: '1' } : {}),
    },
  });
  const lines = createInterface({ input: child.stdout });
  const replies = new Map<number, (value: unknown) => void>();
  const aborts = new Map<number, AbortController>();
  let nextRequest = 1;
  let pairingChanged = () => {};
  const write = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
  const ready = Promise.withResolvers<{ marker: string; port: number; demo_port: number | null }>();
  child.once('exit', (code) =>
    ready.reject(Error(`The test host exited (${code}). Build it with the test-host feature.`)),
  );
  child.once('error', ready.reject);
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (message.ready) return ready.resolve(message.ready);
    if (message.reply !== undefined) return replies.get(message.reply)?.(message.value);
    if (message.log !== undefined) return options.log?.(message.log);
    if (message.pairing_changed) return pairingChanged();
    if (message.abort !== undefined) {
      const reason = Object.assign(Error(message.reason?.message ?? 'Aborted'), {
        code: message.reason?.code,
      });
      return aborts.get(message.abort)?.abort(reason);
    }
    if (message.call !== undefined) {
      const controller = new AbortController();
      aborts.set(message.call, controller);
      const signal = controller.signal;
      const run = async () => {
        const args = message.args ?? {};
        if (message.dep === 'list_signers') return (await options.listSigners?.({ signal })) ?? [];
        if (message.dep === 'sign') {
          if (!options.sign) throw Error('This test host has no signer.');
          return options.sign(args.public_key, args.digest, { signal });
        }
        if (message.dep === 'latest_ledger') return (await options.latestLedger?.({ signal })) ?? 100;
        if (message.dep === 'review') return options.review!(args, { signal });
        throw Error(`Unknown dependency ${message.dep}`);
      };
      run().then(
        (ok) => {
          aborts.delete(message.call);
          if (!signal.aborted) write({ result: message.call, ok });
        },
        (error) => {
          aborts.delete(message.call);
          if (!signal.aborted) write({ result: message.call, error: errorCode(error) });
        },
      );
    }
  });
  const started = await ready.promise;
  if (started.marker !== MARKER) throw Error('The process is not the Walleterm test host.');
  const request = (op: string, extra: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve) => {
      const id = nextRequest++;
      replies.set(id, (value) => {
        replies.delete(id);
        resolve(value);
      });
      write({ request: id, op, ...extra });
    });
  let closed: Promise<void> | undefined;
  return {
    origin: `http://127.0.0.1:${started.port}`,
    port: started.port,
    ...(started.demo_port ? { demoOrigin: `http://127.0.0.1:${started.demo_port}` } : {}),
    pairing: () => request('pairing') as Promise<Pairing>,
    code: async () => ((await request('pairing')) as Pairing).code,
    advance: async (ms) => {
      await request('advance', { ms });
    },
    setPublicOrigin: (origin) => request('set_public_origin', { origin }) as Promise<boolean>,
    onPairingChanged: (callback) => {
      pairingChanged = callback;
    },
    close() {
      closed ??= (async () => {
        if (child.exitCode !== null) return;
        const exited = new Promise((resolve) => child.once('exit', resolve));
        await Promise.race([request('close'), exited]);
        child.stdin.end();
        await exited;
      })();
      return closed;
    },
  };
}
