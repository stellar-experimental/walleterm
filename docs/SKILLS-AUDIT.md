# Walleterm skill audit

Checked on 2026-09-26 against the current source and installed tools.
The repository was clean before this task. This task changes skills and documentation only.
Skill revision, installation, and validation are complete.

## Findings and changes

Both skills already had global source links. They had no `npx skills` remote update records.
The signing skill matched the raw 32-byte digest interface and its 1Password boundary.
Its references correctly kept the historical CLI, SDK, protocol, and contract versions explicit.
One reference described a CLI 27.1.0 limitation as an installed-CLI limitation. The installed CLI is now 28.0.0.
The revision limits that claim to CLI 27.1.0 and requires a current command check.

The website skill described manual Freighter interception but omitted the public service that now exists.
Its browser-signer prohibition conflicted with the supported tunnel endpoint.
Its offer wording also implied that creating an offer could not execute a trade.
A historical evidence link escaped the portable skill directory and failed in a copied installation.

The revised website skill routes ordinary service work to a bundled service reference.
It covers the tunnel, independent demo, browser SDK, vault filtering, wallet grants, selection revisions, and cancellation.
It states the actual transaction limits and the absence of terminal transaction approval.
Manual interception keeps its own reference and existing tested helpers.
The revision fixes the offer guidance and removes the broken portable evidence link.
Both skills distinguish local execution from a cloud environment without the Mac's 1Password socket.

## Installation

`npx skills@1.7.0` installed both skills globally from this checkout's `.agents/skills` directory.
The command used explicit skill and agent flags. It did not target retired tools or use `--all`.

```sh
npx --yes skills@1.7.0 add /Users/kalepail/Desktop/walleterm-v2/.agents/skills -g \
  -s walleterm -s walleterm-site-bridge \
  -a claude-code -a codex -a opencode -a grok -y --json
```

The installer returned `installed` for both skills and all four selected tools.
The installed copies matched every source file byte for byte.
The shared directories then returned to source links so new local sessions read source edits automatically.
Claude Code, Codex, and Grok links resolve through that shared directory.
OpenCode discovers the shared directory directly.
Local-path installation does not create remote update records. `npx skills update -g` cannot update these local sources.

Backups, installer results, runtime discovery records, and uploaded archives remain in:

```text
/Users/kalepail/.agents/backups/walleterm-skills-20260926-112254/
```

## Verified coverage

| Tool | Version | Evidence for both skills |
| --- | --- | --- |
| Claude Code | 2.1.283 | `/skills` outside the project showed both user skills enabled. |
| Codex CLI | 0.157.1 | `codex debug prompt-input` outside the project included both revised descriptions. |
| OpenCode | 1.18.32 | `opencode debug skill` outside the project resolved both shared skill paths. |
| Grok Build | 1.0.41 | `grok inspect --json` outside the project resolved both global skill paths. |
| Claude Desktop | 2.9939.2 | Both uploaded archives passed installation and showed `Enable skill: on`, version `v1`. |

The Codex desktop app uses the same local skill host as its CLI.
CodexBar monitors usage and has no skill installation target.
Cursor remains an IDE-only tool. No Cursor, Orca, Conductor, or retired-tool directories were added.
`npx skills ls -g` reports some universal consumers automatically. That list does not prove those tools are active.

Claude Desktop installation used its signed-in **Customize → Skills → Add skill → Upload skill** interface.
It required no credential change or model conversation.
The installed entries are:

- `walleterm`: `skill_01LqRdhipNh394fMwWQn6sDF`, seven bundled files.
- `walleterm-site-bridge`: `skill_01GGFdCVVt15eHQ9rGBse9A5`, eight bundled files.

Desktop uploads are snapshots. Source links and `npx skills` do not update those account copies.
Upload a new archive after skill edits.
Claude Code also discovers these account skills as `anthropic-skills:walleterm` and `anthropic-skills:walleterm-site-bridge`.
Its local `/walleterm` and `/walleterm-site-bridge` commands keep priority over the synced account commands.
The synced copies matched this task's local content at installation. They can become stale after later source edits.

## Validation and limits

- Both skills passed `skill-creator/scripts/quick_validate.py`.
- Every local Markdown link resolved after copying both skill directories into an unrelated temporary directory.
- `bun test tests/site-bridge.test.ts bridge/server.test.ts` passed: 45 tests, zero failures.
- A copied `classic-attach.py` verified an isolated mock signature from an unrelated caller directory.
  It preserved the transaction hash with installed Stellar CLI 28.0.0.
- `git diff --check` passed.
- Final integration included the existing tunnel startup fixes from remote `main`.
  `make test` passed with 198 Bun tests, Go tests, Go vet, type checking, and offline contract checks.
- `bun run format:check` passed. The final commit passed the redacted Gitleaks scan.

The tests used isolated mock keys. This task requested no live signatures or Stellar submissions.
It did not read 1Password items or private key fields.
No fresh model-based behavior evaluation or live testnet acceptance ran for the revised prose.
The prior acceptance reference remains a dated snapshot, not a claim about a new live run.

## Sources

- [Skills CLI source and installation guide](https://github.com/vercel-labs/skills), checked with installed package version 1.7.0.
- [Claude skill installation](https://support.claude.com/en/articles/12512180-use-skills-in-claude), checked on 2026-09-26.
- [OpenAI skill documentation](https://learn.chatgpt.com/docs/build-skills), checked against the local Codex runtime.
- `docs/INTERFACE.md`, `docs/PLAN.md`, `bridge/PROTOCOL.md`, and `docs/WEB-BRIDGE.md`.
- `bridge/transaction.ts`, `bridge/server.ts`, `sdk/walleterm.ts`, `sdk/connect.ts`, and `package.json`.

The installation research output remains at `/tmp/walleterm-skill-install-search.json`.
