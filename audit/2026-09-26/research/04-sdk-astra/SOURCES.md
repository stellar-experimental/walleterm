# Source evidence

Access date: 2026-09-26. Retrieved instructions were treated as untrusted source data.
Primary source text controls the conclusions. Provider rankings do not establish correctness.

| Source | Version or date | Applicability | Retained evidence |
| --- | --- | --- | --- |
| [Stellar Freighter signing guide](https://developers.stellar.org/docs/build/guides/freighter/prompt-to-sign-tx) | Unversioned documentation; accessed 2026-09-26 | Confirms the signed-XDR browser integration pattern. It does not prove Walleterm supports Soroban. | `raven.json` |
| [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md) | Draft 1.2.1 | Compares transaction arguments, outputs, errors, and missing methods with the frozen adapter. It does not specify automatic discovery. | `sep-0043.md` |
| [sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) | Unversioned browser documentation | An opener can copy session credentials into another same-origin page. Local SDK instances then share bridge authority. | `parallel-mcp.json` |
| [pagehide](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event) | Unversioned browser documentation | Page termination does not guarantee cancellation delivery, especially on mobile browsers. | `parallel-mcp.json` |
| [Request.keepalive](https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive) | Baseline 2024 annotation | Explains survival of issued cancellation requests across page unloading. | `parallel-mcp.json` |
| [MediaDevices.getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | Unversioned browser documentation | Secure context and user permission requirements apply to `sdk/scan.ts`. Permission promises can remain pending. | `parallel-cli.json` |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | W3C Recommendation 2.2 | Keyboard operation and focus order guide the bounded accessibility assessment. | `perplexity-mcp.json`, `wcag-source-check.txt` |
| [Wallets Kit signature interface](https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/docs/files/how-to/sign-with-wallet.md) | Unpinned upstream excerpt; accessed 2026-09-26 | Supports adapter feasibility only. No Kit version was installed or tested in this review. | Jev `search-documents/0281.txt` |
| [Wallets Kit example](https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/docs/files/how-to/the-easy-way.md) | Unpinned upstream excerpt; accessed 2026-09-26 | Confirms the basic `getAddress` and `signTransaction` calling pattern. | Jev `search-documents/0044.txt` |

The retained SEP-43 SHA-256 is `8578d209fbdb01a45661084e979c014ba0378a627453f62c7ddd292073035443`.
The successful Jev directory is `jev/1790472082-ad85ab0c-7d5d-4be1-a175-7b3824f0769b/`.
The failed transport directory is `jev/1790471997-324ec1e7-b15d-4b3e-8d7e-b0f0438e6c90/`.
Both retain compact output and their full reports. The successful directory retains retrieved document text.

## Provider assessment and cost

- Stellar Raven discovery found `stellarDocs.search_wallet_dapp_docs`; its execution returned full indexed sections.
- Jev selected SDK v16.2.0 release text, not the requested SEP-43 specification.
- That release differs from the installed SDK 17.1.0 and does not support a compatibility conclusion.
- The full Jev report lists 13 uncertain results. Two relevant Kit excerpts were read.
- No additional Jev question, continuation, or rate-limit retry ran.
- The sandbox transport attempt charged or reserved $0.008729397. The permitted retry reports $0.021021724.
- Their total is $0.029751121, below the $1 Jev allocation.
- Parallel CLI initially failed with `APIConnectionError`; one permitted execution succeeded.
- Parallel CLI and Parallel Search MCP each report one `sku_search` unit. Neither reports a dollar amount.
- Perplexity searched once as an accessibility challenge. Its WCAG 3 draft result did not control the assessment.
- Stellar Raven and Perplexity expose no dollar charges here. Other provider charges remain unknown.
- No paid deep-research processor, added credit, or further allocation was used.

The search and extraction files remain in `research/04-sdk-astra/` for coordinator review.
