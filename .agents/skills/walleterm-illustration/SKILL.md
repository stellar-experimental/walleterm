---
name: walleterm-illustration
description: Draw or change walleterm illustrations and the wallet mascot at parity with the reference images, and keep the Paper designs current. Use for a new scene, a site or social image, a change to the hand-drawn line or flat shapes, a parity check of art against design/reference, or any Paper or site layout change.
metadata:
  internal: true
---

# Walleterm illustration

Read [the illustration standard](../../../design/ILLUSTRATION.md) first. It defines the style, the line, flat shapes, and **parity**.
Work from the repository root. Scenes live in `design/art/build.ts`. The mascot and the line live beside it.
When a browser, shell, or Git step fails in a strange way, read [the tool traps](references/tooling.md).

## Loop

1. **Pick the reference.** Choose the image in `design/reference/` nearest to the picture: same ground, same pose. The [index](../../../design/reference/README.md) lists each one.
   For a new feature picture, start from its composition in the index's feature studies, then take the style from a reference.
   Done when you can name one reference file and the idea the picture carries.
2. **Construct.** Add or edit a scene in `design/art/build.ts`. For a recreation, place the mascot with `placeFromTrace` and the output of `uv run design/tools/artcheck.py trace REF`.
   Use mascot defaults. Draw circles with `disc`. Set an option only for a trait the reference shows, and write that reason in a comment.
3. **Build.** Run `bun design/art/build.ts`.
4. **Measure.** Run `uv run design/tools/artcheck.py compare REF design/art/out/NAME.svg --out design/art/out/NAME-sheet.png`.
   Add `--bands-only` for a new picture, where no single reference matches. Add `--walk` for the walking pose.
   Done when the command exits 0.
5. **Look.** Open the sheet with your image reader. Judge each row against the reference: mascot, fold corner, eye and right edge, legs and feet, ink overlay.
   Name every difference you see, in words, even when the numbers pass.
   Done when each row has a verdict: "matches" or a named difference.
6. **Fix.** Change the construction or the hand, then go back to step 3. Change a measure only when it measures the wrong thing, and prove that on the references first.
   Done when steps 4 and 5 are clean in the same pass.
7. **Guard the suite.** After a change to `hand.ts`, `mascot.ts`, or a shared helper, run `uv run design/tools/artcheck.py suite`.
   Done when it exits 0 and you have read the sheet of every scene the change touched.
8. **Place in Paper.** When `site/art/` changed, put the new art in the Paper designs before you accept it on the site. Paper is the official reference for the site. Read [the Paper workflow](references/paper.md) first.
   Done when every changed image layer serves the same bytes as its site file, and both artboard screenshots look right.
9. **Check the site.** Render the page with `agent-browser` at each Paper artboard width, and 1 pixel on each side of every `@media` width in `site/index.html`. Compare it with the Paper artboards and with a render from before the change.
   Done when no width scrolls sideways, no cream shape touches another across a section edge, and every changed picture sits where Paper puts it.
   When `site/art/` or the page styles changed, also compare before and after in Chrome and Safari at several pixel ratios.
   Chrome: `agent-browser set viewport` at 390×844 at 3x, 768×1024 at 2x, and 1440×900 at 1x and 2x.
   Safari: Mobile Safari in the iOS Simulator on an iPhone (3x) and an iPad (2x). [The tool traps](references/tooling.md) give the commands.
   Done when each changed picture looks the same in both browsers at every ratio, with no blur, gap, or shift in either.
10. **Record.** A new trait or lesson goes in the standard. A new reference goes in the index, then run `uv run design/tools/artcheck.py baseline`. A new tool trap goes in the traps file.

## Report

Show the sheet image and the compare table. Name the reference and the tier of proof: numbers and eyes, or eyes only for a dark ground.
