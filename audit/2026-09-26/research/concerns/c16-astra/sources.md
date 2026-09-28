# C16 primary-source record

Access date: 2026-09-26, America/New_York.
Target: Bun `1.4.2`, macOS, and APFS.
Observed host: Bun `1.4.2+744846f84`, macOS `26.7` build `25G229`, Darwin `25.6.0`.

## Sources and applicability

1. [Apple fsync manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html).
   The installed manual gives the same host/device distinction.
   It states that device caching can leave data vulnerable to power loss or an OS crash.
   It recommends `F_FULLFSYNC` for stronger persistence requirements.
   It does not specify the parent-entry effect of synchronizing a new APFS file.
   The archived page carries a 1993 manual date; it is not an APFS implementation contract.
   Evidence: `local-fsync.2.txt`, `web-discovery.txt`.

2. Installed Apple `fcntl(2)`, obtained with `MANPAGER=cat man 2 fcntl | col -bx`.
   Lines 112–135 describe `F_BARRIERFSYNC`; it orders writes without promising persistence when the call returns.
   Lines 137–148 describe `F_FULLFSYNC`; it flushes the device queue and explicitly includes APFS support.
   The manual also notes hardware that ignores flush requests.
   This local primary source supplies modern APFS coverage missing from the older online manual.
   The SDK defines `F_FULLFSYNC` as `51` in `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/sys/fcntl.h:260`.
   Evidence: `local-fcntl.2.txt` and the API probe records under `checks/concerns/c16-astra/`.

3. [Apple File System Guide: Features](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/Features/Features.html).
   Apple updated this retired guide on 2018-06-04.
   It describes metadata crash protection through copy-on-write.
   It does not guarantee persistence of this application's latest gate after each successful `fsyncSync` call.
   Crash-consistent metadata can still leave the question of latest-state persistence unanswered.
   Evidence: `web-apfs-and-bun.txt`.

4. [Apple Developer Forums: Lock Contention in APFS/Kernel?](https://developer.apple.com/forums/thread/800906).
   Apple DTS engineer Kevin Elliott explains `fsync`, `F_FULLFSYNC`, device caches, and APFS performance.
   Relevant staff replies date from September and November 2025.
   The staff explanation supports separate process, kernel, and device-persistence boundaries.
   It does not establish the disputed newly created parent-entry failure.
   Non-staff questions and linked third-party opinions do not establish platform guarantees.
   Evidence: `web-apple-and-bun.txt`.

## Discovery and excluded conclusions

The original verification reports supplied Linux/POSIX references and a prior explicit macOS verification limit.
I read their source records; neither supplied APFS power-loss evidence.
Parallel returned an unofficial article claiming automatic directory durability on APFS.
I excluded that claim because it lacked primary support and conflated `fsync` with stronger synchronization calls.
The Apple guides describe metadata design, but I did not infer an unconditional persistence guarantee from them.
Node/libuv source appeared in web discovery. It cannot establish Bun's implementation.

I attempted Bun `bun-v1.4.2` source retrieval for `src/sys.zig` and `src/bun.js/node/node_fs.zig`.
Raw and GitHub web retrieval failed; GitHub MCP also could not return `src/sys.zig` at that tag.
These errors establish retrieval limits, not missing runtime functionality or a specific Bun implementation.
The current Apple Foundation page returned a JavaScript shell; its Markdown link returned an unsupported-content error.
I used the retained Apple guide and local manuals instead.

## Research usage

| Provider | Calls and outcome | Visible dollar cost |
| --- | --- | --- |
| `parallel-cli` | One scoped search; two automatic retries; exit 4, `APIConnectionError` | Unknown |
| Parallel MCP | One successful scoped search; no returned usage or charge field | Unknown |
| Web | Two discovery queries; primary-page and versioned-source retrieval attempts | Unknown |
| GitHub MCP | One read-only Bun source request; failed | Unknown |
| Jev | Not used; no unresolved Stellar source question | $0 |
| Raven / Perplexity | Not used; further search would not change the bounded decision | $0 new calls |

No rate-limit response appeared. No manual retry followed the failed CLI search.
No provider exposed a dollar charge. An aggregate invoice total remains unavailable.
The total allocation was $1; Jev's maximum was $0.25.
No deep-research processor ran. No further allocation is required.
The retained CLI output is `parallel-cli.stdout`; no `parallel-cli.json` result file was created.
Parallel's result is `parallel-mcp.json`; failed GitHub retrieval is `github-bun-source.json`.
All web outputs use the `web-*.txt` filenames in this directory.
