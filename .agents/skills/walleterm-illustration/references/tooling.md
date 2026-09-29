# Tool traps

## Browser

- `agent-browser screenshot` resolves a relative path against its daemon, not your shell. Pass absolute paths.
- `agent-browser` can hang on `open`. Run `agent-browser close`, then retry. `artcheck.py` retries once this way.
- Wrap an SVG in a small HTML page to render it at an exact size.
- A Chrome render alone is not the source of truth for the site. Safari draws SVG filters at 1x and scales them up,
  so a blur that looked right in every Chrome check made the wallet blurry in Safari. Check changed art in Safari too.
- `agent-browser set viewport W H SCALE` sets the pixel ratio. A full-page screenshot at scale 2 is twice the CSS width.

## Safari

- `agent-browser -p ios` does not work in agent-browser 0.38.1, even with Appium and its XCUITest driver installed.
  It opens an Appium session but answers `open` and `screenshot` from Chrome: a 1280-pixel screenshot is Chrome, not Safari.
  Use the simulator commands below. Re-test after an agent-browser update.
- Without Appium, drive Mobile Safari with the simulator directly. Screenshots come at the device's own ratio:

  ```sh
  udid=$(xcrun simctl list devices available | grep 'iPhone 17 Pro (' | head -1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/')
  xcrun simctl boot "$udid"; xcrun simctl bootstatus "$udid" -b
  xcrun simctl openurl "$udid" http://127.0.0.1:8802/   # the simulator reaches the Mac's loopback
  xcrun simctl io "$udid" screenshot /absolute/path/safari-iphone.png
  xcrun simctl shutdown all
  ```

- Serve `site/` from each version with `python3 -m http.server PORT --bind 0.0.0.0` in a `git archive` copy, one port for before and one for after.
- The simulator cannot scroll without Appium. To see pictures below the fold, serve a small page that shows each `art/*.svg` at its site size.
- An iPad Pro simulator gives desktop-class Safari at 2x. Its first launch can show a system banner over the top of the page.
- Desktop Safari's `safaridriver` needs `safaridriver --enable` once, with an administrator password. Then try `agent-browser -p safari`.

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
