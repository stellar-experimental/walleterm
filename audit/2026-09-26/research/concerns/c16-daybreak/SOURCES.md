# C16 Daybreak primary sources

Access date: 2026-09-26.

## Apple sources

- [Apple `fsync(2)` manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html)
  states that ordinary `fsync` does not guarantee results after an operating-system crash or power loss.
- [Apple `fcntl(2)` manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fcntl.2.html)
  describes `F_FULLFSYNC` and warns that hardware can ignore the flush request.
- [Apple APFS crash protection](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/Features/Features.html)
  describes copy-on-write metadata and crash protection.
  It does not define persistence for a newly created file after file-only `fsync`.
- [Apple APFS reference](https://developer.apple.com/support/downloads/Apple-File-System-Reference.pdf)
  describes checkpoints, directory records, and container crash protection.
  It does not define the application-level `fsync` contract.
- [Apple XNU `fsync_common`](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/vfs/vfs_syscalls.c#L8308-L8401)
  sends the descriptor vnode to `VNOP_FSYNC` without a regular-file restriction.
  Its comments describe file-integrity metadata reaching stable storage.

## Bun sources

- [Bun Node.js compatibility](https://bun.sh/docs/runtime/nodejs-compat)
  reports that `node:fs` is implemented.
- [Bun v1.4.2 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)
  identifies commit `744846f`.

The local Bun probe provides the version-specific capability evidence.
The current Bun documentation can change after Bun 1.4.2.

## Research tools

- Parallel Search MCP returned Apple, XNU, and Bun primary-source candidates.
- The MCP call exposed no dollar charge.
- `parallel-cli` failed with `APIConnectionError` after two automatic retries.
- The failed CLI call created no output file.
- Any CLI provider charge is unknown.
- Jev was not used because this question is not a Stellar source question.
- Visible Jev cost was `$0`.
- Raven and Perplexity were not needed after primary sources resolved the question.
- No deep-research processor ran.
