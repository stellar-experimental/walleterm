// Phase 7a check 5: start the production test host, read the pairing code, GET /api/session, close.
// No /v1 route is called. Nothing lists signers or signs.
import { createHost } from '/Users/kalepail/Desktop/walleterm-v2-worktrees/rust-everywhere-test/tests/browser/host.ts';

const logs: string[] = [];
const host = await createHost({ production: true, log: (line) => logs.push(line) });
const pid = (await Bun.$`pgrep -f rust-everywhere-test/target/debug/walleterm-test-host`.nothrow().text()).trim();
const pairing = await host.pairing();
const code = await host.code();
const response = await fetch(host.origin + '/api/session');
const body = await response.text();
const sockets = pid ? await Bun.$`lsof -a -p ${pid} -U`.nothrow().text() : '';
const network = pid ? await Bun.$`lsof -a -p ${pid} -i`.nothrow().text() : '';
await host.close();
await Bun.sleep(300);
const after = (await Bun.$`pgrep -f rust-everywhere-test/target/debug/walleterm-test-host`.nothrow().text()).trim();
console.log(
  JSON.stringify(
    {
      origin: host.origin,
      pid,
      pairing: { ...pairing, code: pairing.code.replace(/\d/g, '#') },
      code_format_ok: /^\d{8}$/.test(code) && code === pairing.code,
      session_status: response.status,
      session_body: body,
      unix_sockets: sockets.split('\n').slice(1).filter(Boolean),
      inet: network.split('\n').slice(1).filter(Boolean),
      agent_socket_open: /1password|agent\.sock/i.test(sockets),
      logs,
      host_running_after_close: after,
    },
    null,
    1,
  ),
);
