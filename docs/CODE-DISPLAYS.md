# Demo code displays

The demo uses Twinkleplop for the activity JSON, transaction JSON, and connection command.
Code keeps its original lines. Each JSON panel scrolls horizontally and vertically within a fixed height.
A language label, line count, and conditional scroll hint identify each panel.
The scroll region accepts keyboard focus and arrow keys.

## Implementation

`demo/site/code-view.ts` owns rendering. Both JSON views use `createCodeView`.
The connection command receives Bash highlighting through a demo-only enhancement.
The connection SDK has no new dependency.

Twinkleplop returns token offsets. The renderer creates spans and text nodes from the original source.
It never inserts source through `innerHTML`.
HTML in a JSON response stays a JSON string, including script tags.
Hashes, signatures, and XDR stay strings. Highlighting does not validate them.
The raw SDK module route remains available for integration.

Closed disclosures defer highlighting. Opening a disclosure loads the local bundle once.
The bundle creates one tokenizer per language and reuses it.
Unchanged content keeps its DOM, expansion state, and scroll position.
Copy and export continue to use original event data.
Events without details remain plain rows.

Source above 50,000 UTF-16 units stays complete plain text.
Token streams above 12,000 tokens also stay plain text to bound DOM work.
The label shows “Plain text” for these cases and for loading failures.
These limits do not truncate the displayed, copied, or exported data.

## Dependencies and build

The build pins `@twinkleplop/json` and `@twinkleplop/bash` at `0.1.5`.
Their core dependency is `@twinkleplop/core` at `0.2.2`.
Bun builds `demo/site/syntax.ts` with the other browser entry points.
The browser loads its generated module only when highlighting starts.
The installer includes the generated modules and the MIT license.
Production installation does not need the development dependencies.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run test
```

Generated JavaScript stays under `dist/` and is not committed.
Tests compare the built tokenizer with its typed source and check all imported browser modules.

The implementation follows the official documentation, accessed on 2026-09-26:

- [Language reference](https://twinkleplop.pngwn.at/docs/languages-ref): separate JSON and Bash packages.
- [Getting started](https://twinkleplop.pngwn.at/docs/getting_started): reusable tokenizers and custom rendering.
- [Core API](https://twinkleplop.pngwn.at/docs/api): token types and UTF-16 source offsets.
- [Themes](https://twinkleplop.pngwn.at/docs/themes): CSS token colors.
- [Render options](https://twinkleplop.pngwn.at/docs/render_options): token classes and whitespace handling.

## Validation

The checks ran in the separate `feat/demo-code-display` worktree.
Before the TypeScript integration, the code-display suite passed 193 Node tests and three contract self-tests.
The fresh worktree first required its CAP-71 WASM fixtures:

```sh
cargo build --release --target wasm32v1-none --manifest-path fixtures/cap71/Cargo.toml
```

An isolated production installation served all four syntax assets with exact source matches.
The existing strict content security policy remained active.
The main runtime and tunnel remained unchanged.

Browser checks used isolated Chromium sessions and local sample data:

| Check | Result |
| --- | --- |
| Widths of 320, 390, 768, and 1440 pixels | No page overflow |
| Activity and transaction panels | Original lines and internal scrolling |
| Keyboard ArrowRight | Focused code region scrolled horizontally |
| Reopen unchanged event | Same token DOM and scroll offsets |
| Copy JSON and copy hash | Exact original values |
| Empty event data | No disclosure or code panel |
| HTML and script text | Inert text; no injected script elements |
| Blocked syntax bundle | Complete source with a plain-text label |
| 250,000-character source | Complete plain-text fallback; observed update took 0.1 ms |
| Activity accessibility scan | Zero violations; zero incomplete checks at 320 pixels |
| Transaction accessibility scan | Zero violations; zero incomplete checks |
| Connection command | Exact text; Continue stayed disabled with empty inputs |
| Browser errors during normal use | None |

The timing above is one local observation. It is not a device performance guarantee.
The viewport checks do not establish physical iPhone or Safari acceptance.
No live signatures, account funding, or transaction submission occurred.
The `requestSignature` function and `sdk/walleterm.js` (now `sdk/walleterm.ts`) remain unchanged.

## Screenshots

All images contain local sample data.

| View | Screenshot |
| --- | --- |
| Activity, desktop, 1440 × 1100 | [Desktop](screenshots/code-display/desktop.png) |
| Activity, tablet, 768 × 1024 | [Tablet](screenshots/code-display/tablet.png) |
| Activity, phone, 390 × 844 | [Phone](screenshots/code-display/mobile.png) |
| Activity, 320 × 740, keyboard scroll | [Small phone](screenshots/code-display/mobile-small-scrolled.png) |
| Transaction, desktop, 1440 × 1000 | [Desktop transaction](screenshots/code-display/transaction-desktop.png) |
| Transaction, tablet, 768 × 1024 | [Tablet transaction](screenshots/code-display/transaction-tablet.png) |
| Transaction, phone, 390 × 844 | [Phone transaction](screenshots/code-display/transaction-mobile.png) |
| Connection, phone, 390 × 844 | [Phone connection](screenshots/code-display/connection-mobile.png) |
