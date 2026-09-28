# C08 daybreak checks

Date: 2026-09-26, America/New_York.
Caller directory: `/Users/kalepail/Desktop/walleterm-v2`.
Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.

## Read checks

I read the three assigned briefs with `sed`.
I read the frozen `AGENTS.md`, `README.md`, `docs/PLAN.md`, and `docs/INTERFACE.md` with `sed`.
I read only `reports/05-demo-astra.md` among audit reports.
I read `checks/05-demo-astra/adversarial.test.ts.txt` and `checks/coordinator-reproductions.txt`.
I inspected `demo/site/app.ts` with `nl` and `sed`.
I searched the assigned recovery paths with `rg`.
I read the relevant recovery documentation with `nl` and `sed`.
I read preserved primary evidence in `research/05-demo-astra/`.
I did not read `reports/concerns/c08-confirmation-binding-astra.md`.

The first manifest read used the wrong snapshot path.
`sed` reported that `/private/tmp/walleterm-audit-40d6cca9db73/manifest.json` does not exist.
The follow-up found and read `audit/2026-09-26/manifest.json`.

## Frozen-file check

Command:

```sh
shasum -a 256 /private/tmp/walleterm-audit-40d6cca9db73/demo/site/app.ts
```

Result: passed.
The hash was `7b59656b9b06900054620024d52ac55a1e5789136741c0dae528ab4573b79218`.
This hash matches `audit/2026-09-26/manifest.json`.

## Targeted reproduction

Command:

```sh
bun test audit/2026-09-26/checks/05-demo-astra/adversarial.test.ts \
  -t 'malformed success JSON|different confirmed hash|normal reload submits'
```

Result: passed with three tests and zero failures.

- `{}` changed an `unknown` record to `failed`.
- A different successful hash changed the original record to `submitted`.
- A valid matching response completed the original record normally.

The tests use SDK 17.1.0 transaction bytes and isolated mock keys.
They replace all network requests with in-memory responses.

## Baseline evidence

I read `checks/baseline-permitted-results.json` and `checks/rust-summary.json`.
The permitted Go race and Bun baseline commands passed.
The four Rust fixture groups passed 30 tests and failed none.
I did not rerun the full baseline.

## Research usage

I made no new network or paid research call.
New total cost was `$0.00`.
New Jev cost was `$0.00`.
I reused preserved primary evidence from `research/05-demo-astra/`.
That evidence reports `$0.030209479` in prior visible Jev charges.
Other preserved provider charges remain unknown.
