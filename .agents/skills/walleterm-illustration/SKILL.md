---
name: walleterm-illustration
description: Draw or change walleterm illustrations and the wallet mascot at parity with the reference images. Use for a new scene, a site or social image, a change to the hand-drawn line, or a parity check of art against design/reference.
---

# Walleterm illustration

Read [the illustration standard](../../../design/ILLUSTRATION.md) first. It defines the style, the line, and **parity**.
Work from the repository root. Scenes, the mascot, and the hand-drawn line live in `tools/src/art.rs`.

## Loop

1. **Pick the reference.** Choose the image in `design/reference/` nearest to the picture: same ground, same pose. The [index](../../../design/reference/README.md) lists each one.
   Done when you can name one reference file and the idea the picture carries.
2. **Construct.** Add or edit a scene in `SCENES` in `tools/src/art.rs`. For a recreation, place the mascot with `place_from_trace` and the output of `uv run design/tools/artcheck.py trace REF`.
   Use mascot defaults. Set an option only for a trait the reference shows, and write that reason in a comment.
3. **Build.** Run `make art`.
4. **Measure.** Run `uv run design/tools/artcheck.py compare REF design/art/out/NAME.svg --out design/art/out/NAME-sheet.png`.
   Add `--bands-only` for a new picture, where no single reference matches. Add `--walk` for the walking pose.
   Done when the command exits 0.
5. **Look.** Open the sheet with your image reader. Judge each row against the reference: mascot, fold corner, eye and right edge, legs and feet, ink overlay.
   Name every difference you see, in words, even when the numbers pass.
   Done when each row has a verdict: "matches" or a named difference.
6. **Fix.** Change the construction or the hand, then go back to step 3. Change a measure only when it measures the wrong thing, and prove that on the references first.
   Done when steps 4 and 5 are clean in the same pass.
7. **Guard the suite.** After a change to the line or mascot defaults in `art.rs`, run step 4 for the parity scenes `15-moss-circle` and `16-hourglass`.
   Done when both exit 0.
8. **Record.** A new trait goes in the standard. A new reference goes in the index, then run `uv run design/tools/artcheck.py baseline`.

## Report

Show the sheet image and the compare table. Name the reference and the tier of proof: numbers and eyes, or eyes only for a dark ground.
