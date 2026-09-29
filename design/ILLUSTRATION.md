# Illustration standard

This standard describes the walleterm illustration style and how to keep new art at parity with it.
The source is the image set in [`reference/`](reference/README.md).
The style comes from mid-century picture books: Clement Hurd's *Goodnight Moon* and early Dr. Seuss.
Hurd printed the first edition in four flat inks. Seuss picked a few saturated inks from numbered charts.

## The picture

- One mascot and one idea in each picture. A large simple shape faces a small mascot: a moon, a door, a keyhole, a bar.
- Shapes are flat color with no outline, gradient, or shadow. Only the mascot and scene lines have ink.
- Most of the picture is empty ground. The ground is cream paper, moss, deep moss, tomato, or black.
- Tomato belongs to the mascot. A tomato field or bar is a rare, deliberate exception (07, 12).
- On black, the black ink disappears and leaves only a thin gap between flap and panel. The legs turn thin and cream (11) or dark (13).
- On deep moss, the mascot keeps its black ink (10). The eye is black on every ground.

## The mascot

A folded wallet with one round eye and two thin legs. [`art/mascot.ts`](art/mascot.ts) holds the construction, traced from seven references.
The front panel is a skewed quadrilateral, about 1.1 times as wide as it is tall. Its top and bottom edges slope down to the right.
The back flap is a triangle that rises from the front panel's top-left corner.
The eye sits at 85% across and 32% down the front panel. Its diameter is about 10% of the panel height.
The legs stand 19% of the panel width apart. Feet are short ticks: the left foot points left, the right foot points right.
Legs hang from the panel, so they move with its width.
The walking pose (08) has straight diagonal legs. The back foot lies flat and the front foot tips up. Its points are traced from 08 and do not scale.

## The line

The line is ink from a brush pen, not graphite. The references have almost no paper or fill texture (L\* standard deviation below 0.5).
The hand-drawn feel comes from the line itself. Five traits make it, and all five are measured:

| Trait | What the references do | Control |
| --- | --- | --- |
| Weight | Width is 2% to 3.5% of the panel height. It scales with the drawing. | `width` in [`hand.ts`](art/hand.ts) |
| Drift | Long lines bow a little. The right panel edge bends inward about 1% in the reference images, so its bottom corner flares. | `bow`, `drift`, `bias`; `bows` in [`mascot.ts`](art/mascot.ts) |
| Tilt | Nothing is exactly vertical or square. Legs are straight but splay outward by up to 6%. | `jitter`; `splay` in `mascot.ts` |
| Swell | Width changes slowly along a line, by 2% to 14%. Ink pools slightly at joins and ends. | `swell`; an 8% pool in `inkStroke` |
| Softness | The ink edge ramps over about a third of a stroke width. | `soften` in `mascot.ts` |

`artcheck.py baseline` records the exact bands in `reference/metrics.json`. The bands are the numbers to trust.
Short lines stay nearly straight, and long lines drift more. This follows the arm-trajectory model of AlMeraj et al. (2009).
Legs bow almost nothing. A bowed leg reads as a bent knee.
A bow is one smooth arc along the whole edge. An off-center peak reads as a hook at the corner.

Two traits in the references are artifacts of the image generator. Leave them out:

- A thin light halo along the outside of ink lines.
- Faint smears inside flat fills.

## Flat shapes

Moons, dots, fields, bars, and the keyhole are cut paper, not drawing. They have no outline.
Circles are very slightly out of round: a slow wobble of 0.2% to 0.5% of the radius. The keyhole top is 1.3%.
That is half a pixel on a 150-pixel circle and 1 to 2 pixels on the largest moon. It is felt more than seen.
Straight flat edges are ruler-straight. The red bar in 12 and the keyhole sides in 10 bow by 0.06% or less.
`cutCircle` in [`hand.ts`](art/hand.ts) draws the circles. Its wobble repeats around the circle, so it has no seam.

Excalidraw's hand-drawn look does not fit this style. It outlines fills, doubles strokes, and overshoots the start of a closed shape.
At its default roughness, a keyhole breaks into two separately outlined pieces. Keep one idea from it and rough.js: a seeded, slightly varied radius.

## Colors

Use the median of the references. A parity recreation may match the color of its one reference instead.

| Role | Hex | Source |
| --- | --- | --- |
| Tomato fill | `#e74d36` | median of 13 references, CIELAB |
| Cream paper | `#fbf6e6` | median of the cream grounds |
| Ink | `#0a0a09` | reference ink measures L\* 1 to 2 |
| Moss ground | `#758747` | reference 01 |
| Moss block | `#7b8d4f` | reference 08 |
| Moss dot | `#44592a` | reference 04 (15 uses `#48602d`) |
| Deep moss ground | `#2a4525` | reference 10 |
| Moon | `#f4eedc` | reference 01 (on black, 11 uses `#fbf4e4`) |

## Why the geometry is baked

The generator writes every wobble into the path coordinates. The same seed always gives the same file.
SVG displacement filters measure in absolute units, so the same filter looks different at each size ([Here Dragons Abound, 2020](https://heredragonsabound.blogspot.com/2020/02/creating-pencil-effect-in-svg.html)).
There are no filters. Safari draws SVG filters at 1x and scales them up, so a blur filter looks blurry on Retina screens.
Three faint strokes around each ink shape give the soft edge instead. Each is a `<use>` of the ink path, so the path data appears once.
The core ink is thinner by the ink those strokes add, so a line keeps the same total darkness, as it did with the blur.
Rough.js and xkcd-style jitter make sketchy, doubled lines. This style needs one confident stroke, so the generator uses a single stroke with low roughness.
The ink body follows perfect-freehand's method: a centerline, a width at each point, and midpoint quadratic smoothing.
Lines place a point every 1.25 line widths, at most 120 per line. Lines 10 units wide or more use whole-unit coordinates.
Denser output measured the same in every parity scene and looked the same at 8× zoom, but it was 2.5 to 4 times larger.
A spacing of 2 widths was too sparse: it thinned the legs by 8% and softened the edges of the finest line (01).

## Parity

Parity means a new drawing reads as the same hand as the references, at every size where people see it.
Two checks prove it, and both are required:

1. **Numbers.** `artcheck.py compare` measures the reference and the candidate the same way. Each metric must sit inside the reference band. For a recreation, it must also sit near its own reference.
2. **Eyes.** The compare sheet shows the mascot, three zoomed details, and an ink overlay. Numbers passed once while the right edge had a hook and the legs had knees. The sheet showed both at once.

The measures cover the mascot, circles, and straight flat edges. Composition and color fields need the sheet and a reviewer.
A perfect circle fails `circle_wobble`, because it sits below the reference band.
On a dark ground, the ink measures do not run. The sheet review carries those pictures alone.
At strokes under about 4 pixels, `edge_ramp` is noisy. Compare at the reference's full size.

Lessons from building the measures:

- Fit an edge only between its corners. A window that reaches a rounded corner reports a false bow.
- Measure widths with a subpixel method. Counting whole pixels made `edge_ramp` jump between runs.
- Trim the ends of a leg before measuring its width. The foot tick made one leg look 25% uneven.
- One drawing's random draws move `stroke_cv` noticeably. Judge a default against several scenes, not one.
- Change a measure only when it measures the wrong thing, and prove the change on the references first.
- `artcheck.py` renders with Chrome. Passing measures prove the drawing, not every browser. Check changed site art in Safari too (see the illustration skill, step 9).
- A soft edge must keep a line's total darkness. A halo that only adds ink outside the edge raises `stroke_h`.
  A blur moves ink from inside the edge to outside, so the replacement thins the core by the ink its halo adds.

## Site art

Every file in `site/art/` is generated. Change `art/build.ts`, then run the build. Hand edits to those files are lost.
The Paper designs are the official reference for the site layout. Place new art in Paper before you accept it on the site.
Each site file is a crop of a full recreation. The recreation's parity check therefore covers the site file.

| Site file | Section | Reference |
| --- | --- | --- |
| `hero.svg` | Hero | 01 |
| `request.svg` | How it works | 04 |
| `keyhole.svg` | Boundaries | 10 |
| `bridge.svg`, `bridge-narrow.svg` | Websites | 08 |
| `night-wallet.svg`, `horizon.svg`, `night-moon.svg` | Install | 11 |
| `favicon.svg` | Browser tab | 01, with heavier ink for 16 pixels |
| `../apple-touch-icon.png` | iOS home screen | the favicon, full bleed at 180 pixels. iOS rounds the corners. |

`site/og.png` is reference 01 itself, cropped to 1200 × 630. It keeps its hand-drawn wordmark.
Site art stays SVG: one file stays sharp at every width and pixel density. Use a raster only where a platform requires it, such as the social preview and the touch icon.

## Tools

- `bun design/art/build.ts` writes each scene to `design/art/out/` and each site crop to `site/art/`.
- `uv run design/tools/artcheck.py suite` compares every built scene with its same-named reference and writes each sheet. It exits 1 on any failure.
- `uv run design/tools/artcheck.py compare REF CANDIDATE --out SHEET` checks one scene: the mascot, its circles, and its flat edges. It renders an SVG with `agent-browser`. Add `--walk` for the walking pose.
- `uv run design/tools/artcheck.py trace REF` reports the corners and placement of the mascot in a reference.
- `uv run design/tools/artcheck.py measure IMAGE` prints every metric as JSON.
- `uv run design/tools/artcheck.py render SVG PNG` rasterizes an SVG at its own size, for the touch icon.

## Sources

Research with `parallel-cli` on 2026-09-28:

- AlMeraj, Wyvill, Isenberg, Gooch, Guy. [Mimicking Hand-Drawn Pencil Lines](https://www.researchgate.net/publication/220795335_Mimicking_Hand-Drawn_Pencil_Lines), CAe 2009. Path and texture as two layers. Longer lines deviate more.
- [Rough.js options](https://github.com/rough-stuff/rough/wiki): `roughness`, `bowing`, `seed`, `disableMultiStroke`.
- [perfect-freehand tutorial](https://github.com/steveruizok/perfect-freehand/blob/main/tutorial/script.md): `thinning`, `smoothing`, `streamline`, and the quadratic path method.
- [matplotlib xkcd](https://matplotlib.org/stable/api/_as_gen/matplotlib.pyplot.xkcd.html): wiggle `scale`, `length`, and `randomness`.
- [Simulating Hand-Drawn Motion with SVG Filters](https://camillovisini.com/coding/simulating-hand-drawn-motion-with-svg-filters): `feTurbulence` into `feDisplacementMap`, and "boiling" by changing the seed.
- NYPL, [10 Things About Goodnight Moon](https://www.nypl.org/blog/2022/09/30/goodnight-moon-margaret-wise-brown): the room darkens across the book.
- [The Art of Dr. Seuss](https://www.drseussart.com/illustration-art-description): numbered color charts and a limited palette.
- Excalidraw, MIT license. [`packages/element/src/shape.ts`](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/shape.ts): `generateRoughOptions`, with roughness 0 (architect), 1 (artist), or 2 (cartoonist) and a seed on each element.
- rough.js 4.6.6, MIT license. [`src/renderer.ts`](https://github.com/rough-stuff/rough/blob/master/src/renderer.ts): an ellipse is a ring of offset points with a radius varied by `curveFitting` (0.95 by default).
