# C15 SDK distribution review — Daybreak

## Assignment

| Item | Value |
| --- | --- |
| Concern | C15, incomplete SDK distribution instructions |
| Model and effort | Daybreak, xhigh |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Baseline | Central Go, Bun, TypeScript, and Rust checks passed |
| Source scope | The named documents, product reports, build, package exports, installer, demo server, and existing reproduction |

I did not read the paired C15 report. I did not review another concern.

## Verdict

| Field | Decision |
| --- | --- |
| Verdict | **Confirmed documentation defect** |
| Priority | **P3 / Low** |
| Confidence | **High** |
| Affected users | Website integrators who follow `docs/CONNECTION-UI.md:19-20` and copy only SDK files |

The documented copy layout cannot load the current split browser build. The failure occurs before a wallet connection.
The defect does not affect `walleterm sign`, the complete package layout, or the installed demo.

## Reachable scenario

1. An integrator runs `bun run build`.
2. The integrator follows `docs/CONNECTION-UI.md:19-20`.
3. The integrator copies only `dist/sdk/` and adds a separate `jsqr.js` file.
4. The browser loads `dist/sdk/connect.js`.
5. That module requests `../chunk-zx43w6gh.js`, which the copied layout lacks.
6. Module loading fails, so the connection component never starts.

`scripts/build.ts:8-22` enables ESM splitting. `sdk/scan.ts:69` imports `jsqr` dynamically.
The build bundles that dependency into a shared chunk. It needs no separate `jsqr.js` beside `connect.js`.

## Evidence

The probe copies `dist/sdk/` into an unrelated directory. Its import fails with a missing parent chunk.
The same probe copies the complete `dist/` tree. That control import passes.

`package.json:30-44` exports modules within the complete package tree. Those exports retain access to root chunks.
The package remains private. Its exports do not repair a partial manual copy.

`scripts/install.ts:77-85` records the full recursive `dist/` output. `demo/server.ts:22-33` serves its root chunks.
The targeted demo test recursively checks import paths. The permitted rerun passed with zero failures.

Exact command results are in `checks/concerns/c15-daybreak/checks.md`.

## Counterevidence and limits

`README.md:167-171` already tells integrators to copy `dist/` and `sdk/connect.css`.
The site-bridge reference gives the same rule at `references/service.md:74-78`.
Therefore, the incorrect instructions are isolated to the connection guide.

The complete distribution works. The installation path retains all required files. I did not run the current installed release.
The frozen installer, server, preserved installation probe, and targeted server test provide the control evidence.

## Minimum mitigation

Replace only `docs/CONNECTION-UI.md:19-20` with this text:

> Run `bun run build`. Serve the complete `dist/` tree at the site root.
> Preserve its directory structure. Serve `sdk/connect.css` as `/sdk/connect.css`.
> The build includes `jsqr` in the shared `dist/` chunks.

Keep the existing HTML and JavaScript examples.
Do not change the build, package exports, installer, or demo server.

Separate SDK bundles would remove shared chunks. That change would increase duplicate code.
Moving chunks under `dist/sdk/` changes package and demo paths. Neither alternative is proportionate.

## Verification

Run this offline command from the caller repository:

```sh
python3 audit/2026-09-26/checks/08-product-astra/distribution-probe.py
```

The SDK-only countercontrol must fail. The complete `dist/` control must pass.
Then run the existing recursive demo check from the frozen source:

```sh
bun test bridge/code-view.test.ts --test-name-pattern 'demo serves the exact bundled assets'
```

The check must fetch every discovered JavaScript dependency with status 200.
No live network, 1Password, signing, or submission check is necessary.

## Sources, costs, and remaining limits

The frozen source and reproduction provide decisive primary evidence. No unresolved external fact required research tools.
New research cost was `$0.00`. Jev cost was `$0.00`.
Unknown provider charges were `$0.00` because no provider query ran.

Live installation and camera use remain `not_run`. They cannot change the confirmed missing-module failure.
