# Paper workflow

The Paper file "walleterm — marketing site" mirrors the site. Its file ID is `01M3M7H27MGXYTYMGYZP9PJJF7`.
It has two artboards side by side: "Home — desktop" at 1440 pixels and "Home — phone" at 390 pixels.
Node IDs change when layers are replaced. Look them up with `get_tree_summary` or `find_nodes`. Do not store them.

## Update art

1. Build the site art with `bun design/art/build.ts`.
2. Copy each changed site file to a content-named path, such as `hero-<first 8 hex of its sha256>.svg`, in the scratchpad.
   Paper caches an upload by its local path. A changed file at an old path keeps serving the old upload.
3. Read the old layer with `get_computed_styles`. Replace it with `write_html` in `replace` mode:
   `<img layer-name="..." src="paper-asset:///absolute/path.svg" style="...">`, with the same size and position.
4. Verify. `get_computed_styles` shows the new asset URL. Fetch that URL and compare it with the site file byte for byte.
5. Export both artboards and compare them with browser renders of the site at 1440 and 390 pixels.
   Exports land in `~/Downloads`. Move them to the scratchpad after use.

## Fonts

- The site uses Atkinson Hyperlegible Next for text and Atkinson Hyperlegible Mono for code and eyebrows.
- `get_font_family_info` must list families before you write text. If it returns `{}` for every family, even Arial, the font list for that tab never loaded.
  This happens when an agent creates or opens the file in a hidden tab. Ask the user to bring Paper to the front and reload the tab (Cmd+R).
  A font installed while Paper runs also needs that reload.
- `write_html` replaces an unknown family with `system-ui` and reports no error. After the first write, check with `get_computed_styles`.
  `find_nodes` with the filter `fontFamily` = `*system-ui*` lists every layer that fell back.
- Paper has no `text-wrap: balance`. Where the site balances a heading, put the same line break in the Paper text.

## Quirks

- `update_styles` does not change the `paddingInline` that an artboard received at creation, even to 1 pixel.
  Create artboards without padding and put padding on the section frames.
- Paper renders imported SVG color slightly duller than a browser does. The files are the same. Judge color in the browser.
- A free Paper plan has a weekly MCP call limit. When a call reports the limit, stop and tell the user.
