# C02: Demo request URL parsing

## Assignment and verdict

| Field | Result |
| --- | --- |
| Concern | C02; original finding R03-01 |
| Assigned reviewer | `gpt-6-astra`, `xhigh`, as requested |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Assigned scope | `demo/server.ts:35-47`; request parsing and its direct process consequences |
| Verdict | Confirmed local reliability defect; public Quick Tunnel reachability remains unverified |
| Priority | P3 / low |
| Confidence | High for loopback process exit; insufficient evidence for a public attack claim |
| Affected users | Demo users whose listener receives this request through an accepted Host value |
| Concern count | 1 confirmed; no additional candidates |

## Reachable scenario and impact

`demo/server.ts:35-47` accepts the Host value, then parses the request target without catching errors.
`demo/server.ts:84` binds the actual listener to `127.0.0.1`.
The existing reproduction configures a synthetic public origin and sends this request directly over loopback:

```http
GET //%25 HTTP/1.1
Host: audit-only.trycloudflare.com
Connection: close
```

Bun 1.4.2 throws `ERR_INVALID_URL` at `demo/server.ts:47` and exits with code 1.
The test uses the frozen handler without replacing its parser or simulating an exception.
The synthetic hostname exercises the allowed Host check; it does not demonstrate Cloudflare forwarding.
The demo stops serving requests until the user restarts it.
`service.go:80-99` selects the demo entry point and replaces the CLI process with Bun.
`demo/entry.ts:1-4` passes this handler to `runService`.
The recovery loop at `bridge/launch.ts:362-415` runs inside that process and replaces tunnel children only.
It cannot recover after the demo process exits.

## Evidence and counterevidence

The permitted independent rerun reproduced the preserved crash on macOS arm64, Bun 1.4.2 (`744846f84`).
The survival assertion failed at `checks/03-runtime-astra/targeted.test.ts:96`.
The following health request at line 97 did not run because that assertion failed.
The recorded `HTTP/1.1 200 OK` response header does not establish process survival.

Loopback access is the confirmed prerequisite; public access remains conditional on unchanged forwarding.
The Host check rejects unlisted values before this parsing step.
The demo needs no bridge session or signer call to reach the parsing step.
The interface documents separate demo and signing bridge processes at `docs/INTERFACE.md:28-30`.
This evidence establishes no key disclosure, signature, transaction submission, or bridge process exit.
A local process with the same user privileges can already stop the demo directly.
That existing local authority limits the security impact of the demonstrated attack.

Cloudflare documents slash merging and settings-dependent normalization. [Primary source](https://developers.cloudflare.com/rules/normalization/how-it-works/)
Slash merging could remove the triggering double slash before the origin receives it.
The preserved document does not establish Quick Tunnel settings or this request's actual forwarding behavior.
It therefore proves neither public reachability nor public protection.

## Minimum mitigation and verification

Catch failures from the request-target `new URL()` call and return HTTP 400 immediately.
Keep the change inside the demo handler; no signing policy or new configuration is necessary.
Strict request-target validation is an alternative, but it adds parsing rules beyond the demonstrated failure.
A global exception handler or automatic process restart adds scope without replacing request-level rejection.

After a separate fix, rerun the encoded request and require HTTP 400 with a surviving process.
Then require `GET /api/session` to return HTTP 200 from that same process.
Check that an unlisted Host still returns HTTP 403 and ordinary demo routes still work.
Only a separately authorized public forwarding check can establish the public attack path.
No feature expansion is necessary for C02.

## Exact checks and evidence

Paths below are relative to `audit/2026-09-26/`.
Exact commands and runtime details appear in `checks/concerns/c02-astra/commands.md`.

| Check | Outcome | Evidence |
| --- | --- | --- |
| Frozen source integrity | passed; 199 manifest files matched baseline blobs and SHA-256 values | `checks/concerns/c02-astra/source-verification.json` |
| Preserved reproduction inspection | passed; real loopback handler, no tunnel or signer | `checks/03-runtime-astra/targeted.test.ts:80-99` |
| Preserved crash evidence | confirmed child exit 1; supplied evidence | `checks/03-runtime-astra/malformed-encoded.log` |
| Sandbox rerun | inconclusive; 6000ms timeout, test exit 1 | `checks/concerns/c02-astra/malformed-rerun.log` |
| Permitted loopback rerun | failed survival assertion; confirmed C02, child exit 1 | `checks/concerns/c02-astra/malformed-permitted.log` |
| Public Quick Tunnel, browser, and live signing checks | not_run | Outside the authorized local checks |
| Mitigation implementation and post-fix checks | not_run | Review-only assignment |

## Sources, cost, and limits

I reused the Cloudflare primary excerpt at `research/03-runtime-astra/cloudflare-normalization.md`.
The page records an update date of 2026-04-16; the original review records access on 2026-09-27 UTC.
Its applicability concerns possible intermediary behavior, not verified Quick Tunnel configuration.
The frozen source and the reproduced Bun behavior supply the decisive local evidence.
I read the required project documents and only the assigned original report.
I did not read the paired concern report or delegate.
New research cost: **$0 total; $0 Jev**. No new provider calls or unknown new provider charges occurred.
Historical provider charges remain in the original report and do not represent this follow-up's spending.
No blocker prevents this bounded verdict; public reachability remains an explicit limit.
I changed only the assigned report and its named check files.
