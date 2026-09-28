# C16: Directory durability on the actual supported platform

Read `CONCERN.md` and both `reports/07-verification-*.md` reports.
Source: `tests/submission.ts:146-153,230-234,275-277` and the documented recovery guarantee.

Resolve whether omitted directory synchronization establishes a defect on Bun 1.4.2 and macOS/APFS.
The original finding cites POSIX and Linux material. Check actual platform applicability with primary sources.
Separate process restart, operating-system crash, power loss, and hardware persistence guarantees.
Do not turn an untested durability assumption into a confirmed failure.
Do not propose a directory sync operation without checking whether macOS supports its required semantics.
Do not run destructive crash or power-loss tests.
If evidence cannot establish the claim, classify it as an unproven limit or optional verification work.

Write `reports/concerns/c16-directory-durability-MODEL.md`.
Use `checks/concerns/c16-MODEL/` and `research/concerns/c16-MODEL/` if needed.
Replace MODEL with the assigned `astra` or `daybreak` label.
