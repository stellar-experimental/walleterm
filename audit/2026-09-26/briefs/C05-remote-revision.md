# C05: Delayed signature result after an observed remote wallet revision change

Read `CONCERN.md` and the named original reports.

Original reports:

- `reports/04-sdk-astra.md`
- `reports/04-sdk-daybreak.md`

Source: `sdk/walleterm.ts:237-262,301-302,356-385; sdk/connect.ts:279-296`.

Evidence: checks/04-sdk-astra/remote-switch.test.ts; checks/coordinator-reproductions.txt.

Review A-B and A-B-A cases with copied same-origin sessions. Distinguish returning a valid old signature from signing an ungranted wallet or submission.

Write `reports/concerns/c05-remote-revision-MODEL.md`.
Use `checks/concerns/c05-MODEL/` and `research/concerns/c05-MODEL/` if needed.
Replace MODEL with your assigned `astra` or `daybreak` label.
