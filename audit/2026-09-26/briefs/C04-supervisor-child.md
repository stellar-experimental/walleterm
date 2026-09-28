# C04: Tunnel child survival after supervisor SIGKILL

Read `CONCERN.md` and the named original reports.

Original reports:

- `reports/03-runtime-astra.md`
- `reports/03-runtime-daybreak.md`

Source: `bridge/launch.ts; bridge/tunnel-child.ts`.

Evidence: checks/03-runtime-daybreak/.

Distinguish a mock process result from real cloudflared behavior. Assess the accepted main-parent crash promise. No public tunnel is permitted.

Write `reports/concerns/c04-supervisor-child-MODEL.md`.
Use `checks/concerns/c04-MODEL/` and `research/concerns/c04-MODEL/` if needed.
Replace MODEL with your assigned `astra` or `daybreak` label.
