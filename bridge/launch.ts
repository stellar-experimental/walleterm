import { requestError } from '../sdk/errors.ts';
import { spawn } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { get } from 'node:https';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { bounded, stopChild } from './runtime.ts';
import QRCode from 'qrcode';

import type { ChildProcessByStdio, SpawnOptions } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { SignalOptions } from '../sdk/types.ts';

export interface ServiceConfig {
  port: number;
  label: string;
}
export interface Service {
  service: string;
  listen(): Promise<void>;
  close(): Promise<void>;
  setPublicOrigin(origin: string): void;
  pairing?: { walleterm: number; url: string; code: string; expires_at: string };
  onPairingChanged?(callback: () => void): void;
}
type TunnelChild = ChildProcessByStdio<null | import('node:stream').Writable, Readable, Readable>;
interface Output {
  write(value: string): unknown;
  columns?: number;
  on?(event: 'error', listener: () => void): unknown;
  off?(event: 'error', listener: () => void): unknown;
}
interface ProbeResult {
  status?: number;
  service?: string;
}
interface ProbeOptions extends SignalOptions {
  resolveHost?: (host: string) => Promise<string[]>;
  requestGet?: (
    url: string,
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => ClientRequest;
}
interface ReadyOptions extends SignalOptions {
  service?: string;
  probe?: (origin: string, options: SignalOptions) => Promise<ProbeResult>;
}
export interface LaunchOptions extends SignalOptions {
  create: (config: ServiceConfig) => Service;
  spawnTunnel?: (command: string, args: string[], options: SpawnOptions) => TunnelChild;
  ready?: (origin: string, options: ReadyOptions) => Promise<void>;
  output?: Output;
  environment?: NodeJS.ProcessEnv;
  probe?: typeof publicProbe;
  healthIntervalMs?: number;
  recoveryDelayMs?: number;
}

const tunnelPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;

export function tunnelOrigin(output: string) {
  const match = output.match(tunnelPattern);
  return match ? new URL(match[0]).origin : null;
}

export function waitForTunnel(child: TunnelChild, timeoutMs = 30000, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let output = '';
    let settled = false;
    const settle = (error: unknown, origin?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else if (origin) resolve(origin);
    };
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16384);
      const origin = tunnelOrigin(output);
      if (origin) settle(null, origin);
    };
    const onAbort = () => settle(signal?.reason);
    const onError = (error: Error) => settle(error);
    const onExit = (code: number | null) => settle(Error(`The tunnel exited before startup (${code}).`));
    const timer = setTimeout(
      () => settle(Error('The tunnel did not return a URL within 30 seconds.')),
      timeoutMs,
    );
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else if (child.exitCode != null || child.signalCode != null) onExit(child.exitCode);
  });
}

export async function publicProbe(
  origin: string,
  {
    // A shared resolver can retain NXDOMAIN while a new tunnel's DNS record propagates.
    resolveHost = (host) => new Resolver().resolve4(host),
    requestGet = get,
    signal,
  }: ProbeOptions = {},
): Promise<ProbeResult> {
  const host = new URL(origin).hostname;
  const [address] = await bounded(resolveHost(host), 2500, signal, 'The tunnel DNS lookup timed out.');
  if (!address) throw Error('The tunnel DNS lookup returned no address.');
  return new Promise<ProbeResult>((resolve, reject) => {
    const request = requestGet(
      `${origin}/api/session`,
      {
        signal,
        lookup: (_hostname, options, callback) => {
          const done = typeof options === 'function' ? options : callback;
          done(null, options?.all ? [{ address, family: 4 }] : address, 4);
        },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          if (Buffer.byteLength(body) + chunk.length > 4096)
            return request.destroy(Error('The response is too large.'));
          body += chunk;
        });
        response.on('end', () => {
          clearTimeout(timer);
          try {
            resolve({ status: response.statusCode, service: JSON.parse(body).service });
          } catch (errorValue) {
            const error = requestError(errorValue);
            reject(error);
          }
        });
        response.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );
    const timer = setTimeout(() => request.destroy(Error('The public request timed out.')), 2500);
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function publicReady(
  origin: string,
  { signal, service, probe = publicProbe }: ReadyOptions = {},
) {
  const deadline = Date.now() + 45000;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const response = await probe(origin, { signal });
      lastStatus = `HTTP ${response.status}`;
      if (response.status === 200 && response.service === service) return;
    } catch (errorValue) {
      const error = requestError(errorValue);
      lastStatus = requestError(error.cause).code || error.message;
    }
    await delay(350, undefined, { signal });
  }
  throw Error(
    `The public site did not become ready (${lastStatus}). Check the Internet connection and run the command again.`,
  );
}

function startTunnel(_command: string, args: string[], options: SpawnOptions) {
  // The supervisor leads a new process group. Cloudflared inherits it.
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./tunnel-child.ts', import.meta.url)), ...args],
    {
      ...options,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  // A supervisor killed before cleanup leaves cloudflared in its group. Stop that group once, at supervisor exit.
  // macOS does not reuse a group ID while the group has a member, and it assigns new PIDs in sequence.
  const group = child.pid;
  if (group)
    child.once('exit', () => {
      try {
        process.kill(-group, 'SIGKILL');
      } catch {
        // ESRCH: the group has no member.
      }
    });
  return child;
}
function qrForTerminal(qr: string, output: Output) {
  const width = Math.max(...qr.split('\n').map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').length));
  return output.columns && output.columns < width
    ? `This QR code needs ${width} terminal columns. Widen this terminal or use the printed URL and code.\n`
    : qr;
}

export async function launchService(
  config: ServiceConfig,
  {
    spawnTunnel = startTunnel,
    create,
    ready = publicReady,
    output = process.stdout,
    signal,
    environment = process.env,
    probe = publicProbe,
    healthIntervalMs = 15000,
    recoveryDelayMs = 2000,
  }: LaunchOptions,
) {
  const controller = new AbortController();
  let child: TunnelChild | undefined,
    demo: Service | undefined,
    temporary: string | undefined,
    stopping: Promise<number> | undefined;
  let origin = '',
    lost = false,
    started = false;
  const { promise: done, resolve: complete } = Promise.withResolvers<number>();
  function stop(code: number): Promise<number> {
    if (stopping) return stopping;
    const reason = Object.assign(Error('The service stopped.'), { code: 'service_stopped' });
    controller.abort(reason);
    stopping = Promise.resolve().then(async () => {
      let result = code;
      try {
        await Promise.all([
          stopChild(child, 3000),
          bounded(
            demo?.close(),
            3500,
            undefined,
            'The server did not stop within 3.5 seconds. The process exits now.',
          ),
        ]);
      } catch {
        result = 1;
      } finally {
        process.off('SIGINT', interrupted);
        process.off('SIGTERM', interrupted);
        signal?.removeEventListener('abort', interrupted);
        output.off?.('error', outputFailed);
        if (temporary) rmSync(temporary, { recursive: true, force: true });
        complete(result);
      }
      return result;
    });
    return stopping;
  }
  const interrupted = () => {
    void stop(0);
  };
  const outputFailed = () => {
    void stop(1);
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  signal?.addEventListener('abort', interrupted, { once: true });
  output.on?.('error', outputFailed);
  if (signal?.aborted) interrupted();
  try {
    controller.signal.throwIfAborted();
    demo = create(config);
    const listening = demo.listen();
    listening.then(
      () => {
        if (controller.signal.aborted) void demo?.close();
      },
      () => {},
    );
    await bounded(listening, 15000, controller.signal, 'The local service did not start. Try again.');
    controller.signal.throwIfAborted();
    temporary = mkdtempSync(join(tmpdir(), 'walleterm-tunnel-'));
    const configFile = join(temporary, 'config.yml');
    writeFileSync(configFile, '{}\n', { mode: 0o600 });
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG']) if (environment[key]) env[key] = environment[key];
    const connectTunnel = async () => {
      lost = false;
      child = spawnTunnel(
        'cloudflared',
        [
          'tunnel',
          '--config',
          configFile,
          '--url',
          `http://127.0.0.1:${config.port}`,
          '--no-autoupdate',
          '--protocol',
          'http2',
          '--metrics',
          '127.0.0.1:0',
          '--grace-period',
          '1s',
          '--management-diagnostics=false',
        ],
        { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      child.once('exit', () => {
        if (!stopping) {
          lost = true;
          if (!started) void stop(1);
        }
      });
      child.once('error', () => {
        lost = true;
      });
      origin = await waitForTunnel(child, 30000, controller.signal);
      child.stdout.resume();
      child.stderr.resume();
      controller.signal.throwIfAborted();
      demo!.setPublicOrigin(origin);
      await bounded(
        ready(origin, { signal: controller.signal, service: demo!.service }),
        45000,
        controller.signal,
        'The public tunnel did not become ready. Check the Internet connection and try again.',
      );
      controller.signal.throwIfAborted();
      if (lost) throw Error('The public tunnel stopped during startup.');
    };
    await connectTunnel();
    const printConnection = async () => {
      output.write(`${config.label} is ready on Stellar testnet.\n`);
      if (demo!.pairing) {
        const printPairing = async () => {
          const pairing = demo?.pairing;
          if (!pairing) return;
          const qr = await QRCode.toString(JSON.stringify(pairing), { type: 'terminal', small: true });
          if (!controller.signal.aborted)
            output.write(
              `\nTunnel URL: ${pairing.url}\nConnection code: ${pairing.code}\nScan this QR code with the website's Scan tunnel button, not the phone camera:\n${qrForTerminal(qr, output)}\nThis code expires at ${pairing.expires_at}. It works once.\n`,
            );
        };
        await printPairing();
        demo!.onPairingChanged?.(() => printPairing().catch(() => stop(1)));
      } else {
        output.write(
          `\nPublic URL: ${origin}\nScan this QR code with your phone camera to open the site:\n${qrForTerminal(await QRCode.toString(origin, { type: 'terminal', small: true }), output)}\n`,
        );
      }
    };
    await printConnection();
    controller.signal.throwIfAborted();
    output.write('Press Ctrl+C to stop this service.\n');
    started = true;
    const monitor = async () => {
      let failures = 0,
        lastStatus = Date.now(),
        paused = false,
        needsConnection = false;
      const connectionMessage = () =>
        demo!.pairing
          ? 'Use the new public URL. Reconnect the website with the current code.'
          : 'Open the new public URL. Keep the previous page open if it has an unresolved transaction.';
      const restarts: number[] = [];
      const report = (message: string) => {
        output.write(`[${new Date().toISOString()}] ${config.label}: ${message}\n`);
        lastStatus = Date.now();
      };
      while (!controller.signal.aborted) {
        await delay(healthIntervalMs, undefined, { signal: controller.signal });
        try {
          if (lost) throw Error('The tunnel process stopped.');
          const result = await probe(origin, { signal: controller.signal });
          if (result.status !== 200 || result.service !== demo!.service)
            throw Error('The public service did not respond correctly.');
          if (needsConnection) {
            await printConnection();
            report(connectionMessage());
            needsConnection = false;
          }
          if (failures) report('The public connection recovered.');
          failures = 0;
          continue;
        } catch {
          controller.signal.throwIfAborted();
          failures++;
          if (failures === 1 || Date.now() - lastStatus >= 60000)
            report('The public connection is unavailable. Checking again.');
        }
        // Let cloudflared recover transient network failures before replacing its process.
        if (!lost && failures < 6) continue;
        for (;;) {
          controller.signal.throwIfAborted();
          while (restarts.length && Date.now() - restarts[0] >= 600000) restarts.shift();
          if (restarts.length >= 3) {
            if (!paused)
              report(
                'Tunnel recovery is paused until the restart limit clears. The local service stays available.',
              );
            paused = true;
            break;
          }
          paused = false;
          restarts.push(Date.now());
          report('Restarting the public tunnel. The public URL will change.');
          await stopChild(child, 3000);
          await delay(recoveryDelayMs * 2 ** (restarts.length - 1), undefined, { signal: controller.signal });
          controller.signal.throwIfAborted();
          try {
            needsConnection = true;
            await connectTunnel();
            controller.signal.throwIfAborted();
            await printConnection();
            report(connectionMessage());
            needsConnection = false;
            failures = 0;
            break;
          } catch {
            controller.signal.throwIfAborted();
            report('The replacement tunnel did not become ready.');
          }
        }
      }
    };
    void monitor().catch(() => {
      if (!stopping) void stop(1);
    });
    return {
      get origin() {
        return origin;
      },
      demo,
      get child() {
        return child;
      },
      stop,
      done,
    };
  } catch (errorValue) {
    const error = requestError(errorValue);
    const result = await stop(error.code === 'service_stopped' ? 0 : 1);
    error.exitCode = result;
    throw error;
  }
}

export async function runService(config: ServiceConfig, options: LaunchOptions) {
  let exitCode = 1;
  try {
    const running = await launchService(config, options);
    exitCode = await running.done;
  } catch (errorValue) {
    const error = requestError(errorValue);
    exitCode = error.exitCode ?? 1;
    if (error.code !== 'service_stopped') {
      const message =
        error.code === 'EADDRINUSE' ? 'The local port is in use. Choose another --port.' : error.message;
      process.stdout.write(`${message}\n`);
    }
  }
  const timer = setTimeout(() => process.exit(exitCode), 250);
  process.stdout.on('error', () => {
    clearTimeout(timer);
    process.exit(1);
  });
  process.stdout.write('', () => {
    clearTimeout(timer);
    process.exit(exitCode);
  });
}
