# C15 — SDK distribution instructions

## Verdict and scope

| Field | Result |
| --- | --- |
| Verdict | **Confirmed documentation defect** |
| Priority / severity | **P3 / Low** |
| Confidence | High |
| Reviewer | Astra; requested effort: xhigh; fresh concern review |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Affected users | Website integrators who copy only the SDK directory under the connection guide's instructions. |
| Concern count | One confirmed concern; zero unresolved concerns. |

I read COMMON, CONCERN, C15, both original product reports, and the required source documents.
I inspected the preserved reproduction before adding focused checks. I did not read the paired concern report or delegate.
Coverage includes the connection guide, build script, package exports, SDK imports, installer asset collection, and demo asset handling.
The checks verified all 199 frozen files against both the manifest and baseline Git tree.

## Reachable failure and impact

`docs/CONNECTION-UI.md:19-20` directs users to serve SDK files together and supply a separate `jsqr.js`.
It omits the shared files outside `dist/sdk/`. Its `/sdk/connect.js` example therefore permits an incomplete deployment.
`scripts/build.ts:8-22` builds multiple browser entries with `splitting: true`.
The preserved `dist/sdk/connect.js:3` imports `../chunk-zx43w6gh.js`.
Copying only `dist/sdk/` removes that required parent file. Module loading fails before the component can connect a wallet.
The fresh build also failed for `walleterm.js` and `scan.js` under that incomplete layout.

`sdk/scan.ts:69` dynamically imports `jsqr`. The build supplies this dependency through another shared file.
Supplying the guide's separate `jsqr.js` cannot satisfy the generated imports.
This is an integration availability defect. The evidence shows no key access, unauthorized signing, submission, or public exposure.
The failure requires the incomplete copy. It does not affect every SDK integration.

## Counterevidence and boundaries

- `README.md:167-171` already describes copying `dist/` and the stylesheet. It states that the package remains private.
- `.agents/skills/walleterm-site-bridge/references/service.md:74-78` explicitly requires the complete distribution and preserved shared files.
- `package.json:30-43` exports generated JavaScript, declarations, and the source stylesheet. All seven export targets existed after rebuilding.
- `scripts/install.ts:77-85` builds inside the release stage and includes generated JavaScript recursively.
- `scripts/install.ts:58` includes the stylesheet. `demo/server.ts:22-33` serves SDK entries, the stylesheet, and shared files.
- The unchanged demo request handler returned all nine reachable JavaScript files and the stylesheet with correct bytes and media types.

The demo check called the handler directly with mock requests. It opened no listener and changed no installed files.
These controls narrow the defect to the connection guide. The digest signer and installer do not use its incomplete copy instructions.

## Minimum mitigation and alternatives

Replace `docs/CONNECTION-UI.md:19-20` with these instructions:

> Run `bun run build` in the source checkout.
> Copy the complete contents of `dist/` into the website's static root.
> Preserve all generated directories and shared JavaScript files.
> Copy `sdk/connect.css` into the website's `sdk/` directory. Load the stylesheet once.
> The build includes the scanner dependency. A separate `jsqr.js` file is unnecessary.

This preserves the existing `/sdk/connect.js` and `/sdk/connect.css` examples.
Package exports provide an alternative for integrations that already consume the private package through a bundler.
Disabling splitting or publishing a package adds unnecessary scope. The documentation change is sufficient.
No additional capability or signing-policy change is required.

## Exact checks and verification

Run this offline command from `/Users/kalepail/Desktop/walleterm-v2`:

```sh
python3 audit/2026-09-26/checks/concerns/c15-astra/check.py
```

| Check | Outcome | Evidence under `checks/concerns/c15-astra/` |
| --- | --- | --- |
| Frozen source comparison | passed; 199 files, zero mismatches | `results.json` |
| Preserved reproduction, unchanged | passed; incomplete copy failed; complete copy loaded | `preserved-probe-rerun.json` |
| Fresh offline build, Bun 1.4.2, macOS arm64 | passed; temporary source copy and existing dependencies | `build.log` |
| Fresh incomplete layout | expected failure; all three SDK imports failed | `results.json` |
| Fresh complete layout and stylesheet | passed; all three SDK imports loaded | `results.json`, `graph.json` |
| Static and dynamic dependency traversal | passed; nine modules, 16 references, zero missing files | `graph.json` |
| Decoder and export targets | passed; decoder exported a function; seven targets existed | `graph.json` |
| Demo handler, mock requests | passed; ten assets returned 200 with matching bytes | `graph.json` |

`check.py` records commands through explicit subprocess arguments. `graph.ts` contains the dependency and handler checks.
The fresh build used different shared filenames from the preserved build. Both independently reproduced the same distribution failure.
Byte-identical build reproduction was not established. The mitigation preserves filenames from each complete build without hardcoding them.
After the documentation change, repeat the complete-copy checks. Keep the incomplete-copy check as the negative control.

## Primary evidence, costs, and limits

Primary evidence comprises the frozen source and generated files, inspected on 2026-09-26.
Baseline links: [guide](https://github.com/stellar-experimental/walleterm/blob/40d6cca9db732a0db16d154c80d4a153bf33c6b7/docs/CONNECTION-UI.md#L19), [build](https://github.com/stellar-experimental/walleterm/blob/40d6cca9db732a0db16d154c80d4a153bf33c6b7/scripts/build.ts#L8), [exports](https://github.com/stellar-experimental/walleterm/blob/40d6cca9db732a0db16d154c80d4a153bf33c6b7/package.json#L30), [demo](https://github.com/stellar-experimental/walleterm/blob/40d6cca9db732a0db16d154c80d4a153bf33c6b7/demo/server.ts#L22).
These links identify locally verified baseline files. I did not fetch their remote pages.
I reused `checks/08-product-astra/distribution-probe.py` and `distribution-probe.json` as preserved primary evidence.
Raven, Parallel Search, and Perplexity tools were discoverable. No unresolved external fact required new research.
New research cost: **$0 total; $0 Jev**. New provider calls: zero; unknown new charges: none.
Earlier provider charges belong to the original reviews. This review incurred no additional retrieval charges.
Full baseline suites, real installation, browser execution, camera decoding, live signatures, transactions, and public tunnels remain `not_run`.
The checks removed temporary build files. No production source, dependency, configuration, Git state, or installed file changed.
Blockers: none. The evidence is decisive for C15; no further allocation is needed.
