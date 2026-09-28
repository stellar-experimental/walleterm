# C20: Platform support wording

Read `CONCERN.md` and both `reports/08-product-*.md` reports.
Inspect README prerequisites, platform guards, pinned tools, CI architecture, and recorded build checks.

Determine whether any current promise falsely claims support for an untested macOS release or Intel runtime.
Separate compiling an architecture from testing that architecture.
Do not require an enterprise support matrix for a macOS-first companion.
If useful, recommend one small tested-platform statement instead of an unsupported compatibility claim.
Use primary version-specific sources for any stated operating-system floor.
Do not install tools, change system settings, or create virtual machines.

Write `reports/concerns/c20-platform-claims-MODEL.md`.
Use `checks/concerns/c20-MODEL/` and `research/concerns/c20-MODEL/` if needed.
Replace MODEL with the assigned `astra` or `daybreak` label.
