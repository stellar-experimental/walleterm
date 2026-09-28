# Tool traps

## Browser

- `agent-browser screenshot` resolves a relative path against its daemon, not your shell. Pass absolute paths.
- `agent-browser` can hang on `open`. Run `agent-browser close`, then retry. `artcheck.py` retries once this way.
- Wrap an SVG in a small HTML page to render it at an exact size. Chromium's own screenshot is the source of truth for the site.

## Shell

- zsh does not split an unquoted `$var` into words. Write `${=spec}`, or call each case on its own line.
- zsh has `pipestatus`, not `PIPESTATUS`. Save `$?` before a pipe to keep a command's exit code.
- macOS has no `timeout` command.
- `bunx prettier --write` can reflow a file. Read it again before a string replacement that must match exactly.

## Measuring

- `artcheck.py` runs with `uv run`. Its dependencies are inline in the script, and its cache folder is ignored.
- A render is identical from run to run, because every drawing has a fixed seed. A changed number means the drawing changed.
- Compare full-page renders pixel by pixel only where the layout did not move. A text change above a picture shifts every pixel below it.

## Git

- Other sessions may share the main checkout. Work in a worktree under `walleterm-v2-worktrees/`.
- A merged pull request's branch is deleted on GitHub. A later push to that name creates it again with old history.
  Check `gh pr view` before a push, and start follow-up work on a new branch from `origin/main`.
