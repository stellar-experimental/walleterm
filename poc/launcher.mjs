import { spawn } from 'node:child_process';
import { resolve4 } from 'node:dns/promises';
import { get } from 'node:https';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { createDemo } from './server.mjs';

const tunnelPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;

function options(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--human') {
      if (values.human) throw Error('Use --human only once.');
      values.human = true;
      continue;
    }
    if (!['--signer', '--recipient', '--port', '--state-dir'].includes(name) || values[name]) {
      throw Error(`Unknown or repeated web option: ${name}`);
    }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Set a value for ${name}.`);
    values[name] = args[++i];
  }
  if (!values['--signer'] || !values['--recipient'] || !values['--state-dir']) {
    throw Error('Set --signer, --recipient, and --state-dir.');
  }
  const port = Number(values['--port'] || '8787');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('The port is invalid.');
  return { signer: values['--signer'], recipient: values['--recipient'], stateDir: values['--state-dir'], port,
    human: !!values.human };
}

export function tunnelOrigin(output) {
  const match = output.match(tunnelPattern);
  return match ? new URL(match[0]).origin : null;
}

export function waitForTunnel(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const settle = (error, origin) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(origin);
    };
    const onData = chunk => {
      output = (output + chunk.toString()).slice(-16384);
      const origin = tunnelOrigin(output);
      if (origin) settle(null, origin);
    };
    const onError = error => settle(error);
    const onExit = code => settle(Error(`The tunnel exited before startup (${code}).`));
    const timer = setTimeout(() => { child.kill('SIGTERM'); settle(Error('The tunnel did not return a URL within 30 seconds.')); }, timeoutMs);
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export async function publicProbe(origin, { resolveHost = resolve4, requestGet = get } = {}) {
  const host = new URL(origin).hostname;
  const [address] = await resolveHost(host);
  return new Promise((resolve, reject) => {
    const request = requestGet(`${origin}/api/session`, {
      timeout: 2500,
      lookup: (_hostname, options, callback) => {
        const done = typeof options === 'function' ? options : callback;
        done(null, options?.all ? [{ address, family: 4 }] : address, 4);
      },
    }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(Error('The response is too large.')); });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, paired: JSON.parse(body).paired }); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(Error('The public request timed out.')));
    request.on('error', reject);
  });
}

async function publicReady(origin) {
  const deadline = Date.now() + 45000;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await publicProbe(origin);
      lastStatus = `HTTP ${response.status}`;
      if (response.status === 200 && response.paired === false) return;
    } catch (error) { lastStatus = error.cause?.code || error.message; }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw Error(`The public site did not become ready (${lastStatus}).`);
}

export async function launch(args, { spawnTunnel = spawn, create = createDemo, ready = publicReady, output = process.stdout } = {}) {
  const config = options(args);
  let child;
  let demo;
  let stopping = false;
  async function stop(code) {
    if (stopping) return;
    stopping = true;
    child?.kill('SIGTERM');
    if (demo?.server.listening) await demo.close();
    process.exitCode = code;
  }
  process.once('SIGINT', () => { void stop(0); });
  process.once('SIGTERM', () => { void stop(0); });
  try {
    demo = create({ signer: config.signer, recipient: config.recipient, port: config.port,
      stateDir: config.stateDir });
    await demo.listen();
    child = spawnTunnel('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${config.port}`, '--no-autoupdate', '--protocol', 'http2'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const origin = await waitForTunnel(child);
    child.once('exit', () => { if (!stopping) void stop(1); });
    demo.setPublicOrigin(origin);
    await ready(origin);
    if (config.human) {
      output.write(`Walleterm web is ready on Stellar testnet.\n\nPair this browser:\n${demo.pairUrl}\n\n`);
      output.write(await QRCode.toString(demo.pairUrl, { type: 'terminal', small: true }));
      output.write(`\nThe pairing link expires at ${demo.pairExpiresAt}.\nKeep the link private. Press Ctrl+C to stop the site and tunnel.\n`);
    } else {
      output.write(`${JSON.stringify({ ok: true, event: 'web_ready', url: origin, pair_url: demo.pairUrl,
        expires_at: demo.pairExpiresAt, state_dir: config.stateDir })}\n`);
    }
    return { origin, demo, child, stop };
  } catch (error) {
    await stop(1);
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { await launch(process.argv.slice(2)); }
  catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'web_start_failed', message: error.message } })}\n`);
    process.exitCode = 1;
  }
}
