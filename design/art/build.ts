// Write walleterm illustrations as static SVG files.
// Usage: bun design/art/build.ts
// Every scene is a recreation in its reference's own pixels, written to design/art/out
// for artcheck.py. A scene with `site` outputs also writes cropped files to site/art.
// See design/ILLUSTRATION.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Mascot, colors, mascot } from './mascot.ts';
import { type Hand, type Point, cutCircle, defaultHand, inkStroke, rng, wobblePolyline } from './hand.ts';

type SiteOutput = {
  file: string;
  /** viewBox in scene pixels: x, y, width, height. */
  crop: [number, number, number, number];
  /** Keep the scene background. Leave it out to let the page ground show through. */
  background?: boolean;
  /** SVG preserveAspectRatio, for art that fills a band. */
  fit?: string;
};

type Scene = {
  width: number;
  height: number;
  background: string;
  body: () => string;
  site?: SiteOutput[];
};

/** Place the mascot so its front panel's top-left ink corner is at (x, y) and the panel is h pixels tall. */
const place = (x: number, y: number, h: number, options: Mascot = {}) =>
  `<g transform="translate(${x} ${y}) scale(${h / 1000})">${mascot(options)}</g>`;

/**
 * Place the mascot from `artcheck.py trace` output, which reports the fill's top-left
 * corner and height. The ink centerline sits half a stroke outside the fill.
 */
const placeFromTrace = (origin: [number, number], fillH: number, options: Mascot = {}) => {
  const w = (options.hand?.width ?? defaultHand.width) / 1000;
  const h = fillH / (1 - w);
  return place(origin[0] - (w * h) / 2, origin[1] - (w * h) / 2, h, options);
};

/** A hand-drawn line through points, in scene pixels. */
const line = (points: Point[], width: number, seed: number, color = colors.ink, hand: Partial<Hand> = {}) => {
  const h: Hand = { ...defaultHand, seed, width, ...hand };
  const random = rng(seed);
  return `<path d="${inkStroke(wobblePolyline(points, h, random), h, random)}" fill="${color}"/>`;
};

/** A hand-drawn cubic curve. It drifts a little, like the straight lines. */
const curve = (p: [Point, Point, Point, Point], width: number, seed: number, color = colors.ink) => {
  const h: Hand = { ...defaultHand, seed, width };
  const random = rng(seed);
  const pts: Point[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const u = 1 - t;
    const c = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    pts.push([
      c[0] * p[0][0] + c[1] * p[1][0] + c[2] * p[2][0] + c[3] * p[3][0],
      c[0] * p[0][1] + c[1] * p[1][1] + c[2] * p[2][1] + c[3] * p[3][1],
    ]);
  }
  return `<path d="${inkStroke(pts, h, random)}" fill="${color}"/>`;
};

// Scene colors, measured in each reference.
const moss = '#768746';
const deepMoss = '#2a4525';
const blockMoss = '#7b8d4f';
const dotMoss = '#44592a';
const moon = '#f4eedc';
const moonNight = '#fbf4e4';
const night = '#050404';

// Reference 11, in its own pixels. On black, black ink leaves only the gap between flap
// and panel. Legs are thin and cream.
/** A flat, cut-paper disc. `wobble` defaults to the reference median of 0.3%. */
const disc = (c: Point, r: number, fill: string, seed: number, wobble?: number) =>
  `<path d="${cutCircle(c, r, rng(seed), wobble)}" fill="${fill}"/>`;

// The night moon is one shape at two sizes: in the recreation of 11, and as its own site file.
// Its visible arc in 11 measures 0.2% out of round; a 0.5% disc measures that on the same arc.
const nightMoon = (c: Point, r: number) => disc(c, r, moonNight, 111, 0.005);

const nightMascot = () =>
  placeFromTrace([344.5, 630], 120.5, {
    ink: night,
    legs: moonNight,
    legWeight: 0.64,
    ground: 1650,
    feet: 0.35,
  });
const horizonLine = () =>
  line(
    [
      [-50, 835.5],
      [700, 835],
      [1720, 835.5],
    ],
    4.5,
    71,
    moonNight,
    { bow: 0.0015 },
  );

export const scenes: Record<string, Scene> = {
  // Parity recreation of design/reference/15-moss-circle.png.
  '15-moss-circle': {
    width: 1672,
    height: 941,
    background: colors.paper,
    body: () =>
      [
        disc([836.5, 278.5], 156, '#48602d', 151),
        line(
          [
            [660, 806.5],
            [1011, 806.5],
          ],
          3.8,
          31,
        ),
        placeFromTrace([786.5, 498], 185.5, {
          ground: 1636,
          feet: 0.45,
          footWeight: 1.35,
          widen: 1.045,
          splay: 1.7,
          // This reference bends its right edge more than the median.
          bows: { right: -0.026 },
        }),
      ].join('\n'),
  },

  // Parity recreation of design/reference/16-hourglass.png, with default mascot options.
  '16-hourglass': {
    width: 1672,
    height: 941,
    background: colors.paper,
    body: () =>
      [
        `<path d="M371 796 L548 673 L711 796 Z" fill="#61703f"/>`,
        line(
          [
            [290, 147],
            [838, 147],
          ],
          4.2,
          41,
        ),
        line(
          [
            [290, 147],
            [817, 812],
          ],
          4.2,
          42,
        ),
        line(
          [
            [838, 147],
            [272, 812],
          ],
          4.2,
          43,
        ),
        line(
          [
            [272, 812],
            [817, 812],
          ],
          4.2,
          44,
        ),
        // Only the fill color is matched to this reference; its red is lighter than the median.
        placeFromTrace([1190.5, 414], 219.5, { ground: 1880, fill: '#f3563d' }),
      ].join('\n'),
  },

  // Hero: design/reference/01-moon-green-field.png without the wordmark.
  '01-moon-green-field': {
    width: 1672,
    height: 941,
    background: moss,
    body: () =>
      [
        disc([1350.5, 181], 79, moon, 11),
        // This reference's panel is narrower than the median, and its line is finer and less even.
        placeFromTrace([1191.5, 414], 219.5, {
          widen: 0.95,
          ground: 1870,
          hand: { width: 19, swell: 0.25 },
          // A finer line needs relatively more softness to read the same.
          soften: 0.12,
        }),
      ].join('\n'),
    site: [{ file: 'hero.svg', crop: [1130, 80, 360, 780] }],
  },

  // How it works: design/reference/04-request-line.png.
  '04-request-line': {
    width: 1672,
    height: 941,
    background: colors.paper,
    body: () =>
      [
        curve(
          [
            [521, 460],
            [800, 330],
            [1180, 290],
            [1424, 355],
          ],
          3.4,
          51,
        ),
        disc([1453.5, 361], 33, dotMoss, 41),
        // This reference's panel is wider than the median, and its legs are shorter.
        placeFromTrace([376.5, 444], 145.5, { widen: 1.055, ground: 1680 }),
      ].join('\n'),
    site: [{ file: 'request.svg', crop: [340, 280, 1180, 440] }],
  },

  // Boundaries: design/reference/10-keyhole.png.
  '10-keyhole': {
    width: 1672,
    height: 941,
    background: deepMoss,
    body: () =>
      [
        // This reference's keyhole top is further out of round: 1.3%.
        disc([638.5, 262], 223, '#f6f0da', 101, 0.012),
        `<path d="M524 420 L753 420 L887 888 L376 888 Z" fill="#f6f0da"/>`,
        // This reference's panel is wider than the median.
        placeFromTrace([1065.5, 568], 173.5, { widen: 1.07, ground: 1820 }),
      ].join('\n'),
    site: [{ file: 'keyhole.svg', crop: [340, 20, 980, 885] }],
  },

  // Websites: design/reference/08-bridge-walk.png. The blocks and line run far past the
  // canvas, so the site band can fill any width.
  '08-bridge-walk': {
    width: 1254,
    height: 1254,
    background: colors.paper,
    body: () =>
      [
        `<path d="M-3000 696 H311 V1260 H-3000 Z" fill="${blockMoss}"/>`,
        `<path d="M948 695 H4300 V1260 H948 Z" fill="${blockMoss}"/>`,
        line(
          [
            [-3000, 697],
            [-1200, 696],
            [311, 696],
            [948, 694],
            [2500, 695],
            [4300, 694],
          ],
          3.8,
          61,
          colors.ink,
          { bow: 0.0015 },
        ),
        line(
          [
            [313, 697],
            [313.5, 1300],
          ],
          3.8,
          62,
        ),
        line(
          [
            [947.5, 696],
            [946, 1300],
          ],
          3.8,
          63,
        ),
        // Walking pose, from this reference. Its panel is wider than the median.
        placeFromTrace([569.5, 450], 161.5, {
          pose: 'walk',
          widen: 1.08,
          // Held at the top of the brand band; the reference itself is a little heavier.
          hand: { width: 31 },
          // This reference has crisper ink edges than the median.
          soften: 0.07,
        }),
      ].join('\n'),
    site: [
      // Wide screens: the gap sits at 35% across, clear of the night moon below it.
      { file: 'bridge.svg', crop: [1, 380, 1794, 520], fit: 'xMidYMid slice' },
      // Phones: the gap is centered.
      { file: 'bridge-narrow.svg', crop: [-270, 380, 1794, 520], fit: 'xMidYMid slice' },
    ],
  },

  // Install: design/reference/11-horizon-moon.png. The site lays out the moon itself and
  // uses the two parts below, so each file holds one thing.
  '11-horizon-moon': {
    width: 1672,
    height: 941,
    background: night,
    body: () => [nightMoon([1310, 15], 535), horizonLine(), nightMascot()].join('\n'),
  },
  'night-wallet': {
    width: 1672,
    height: 941,
    background: night,
    body: nightMascot,
    site: [{ file: 'night-wallet.svg', crop: [318, 580, 170, 258] }],
  },
  'night-moon': {
    width: 1000,
    height: 1000,
    background: night,
    // The outline wobbles past r by up to about 1%, so r leaves that room inside the box.
    body: () => nightMoon([500, 500], 492),
    site: [{ file: 'night-moon.svg', crop: [0, 0, 1000, 1000] }],
  },
  'night-horizon': {
    width: 1672,
    height: 941,
    background: night,
    body: horizonLine,
    site: [{ file: 'horizon.svg', crop: [0, 830, 1672, 11], fit: 'none' }],
  },

  // Favicon. No reference shows the mascot this small, so the ink is heavier and the legs go.
  favicon: {
    width: 64,
    height: 64,
    background: moss,
    body: () =>
      `<rect width="64" height="64" rx="14" fill="${moss}"/>` +
      place(10, 19, 38, { legs: 'none', hand: { width: 70 }, soften: 0 }),
    site: [{ file: 'favicon.svg', crop: [0, 0, 64, 64] }],
  },

  // Apple touch icon, full bleed: iOS rounds the corners itself. Render it to PNG with
  // `uv run design/tools/artcheck.py render design/art/out/touch-icon.svg site/apple-touch-icon.png`.
  'touch-icon': {
    width: 180,
    height: 180,
    background: moss,
    body: () => place(34, 58, 96, { legs: 'none', hand: { width: 52 }, soften: 0 }),
  },
};

function svg(scene: Scene, viewBox: string, size: string, background: boolean, fit?: string) {
  const ratio = fit ? ` preserveAspectRatio="${fit}"` : '';
  const ground = background
    ? `<rect x="-5000" y="-5000" width="10000" height="10000" fill="${scene.background}"/>\n`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${size}${ratio}>\n${ground}${scene.body()}\n</svg>\n`;
}

/** The full recreation at the reference size, with its background. */
export const render = (scene: Scene) =>
  svg(scene, `0 0 ${scene.width} ${scene.height}`, ` width="${scene.width}" height="${scene.height}"`, true);

if (import.meta.main) {
  const out = 'design/art/out';
  const site = 'site/art';
  mkdirSync(out, { recursive: true });
  mkdirSync(site, { recursive: true });
  for (const [name, scene] of Object.entries(scenes)) {
    writeFileSync(join(out, `${name}.svg`), render(scene));
    console.log(join(out, `${name}.svg`));
    for (const o of scene.site ?? []) {
      const [x, y, w, h] = o.crop;
      writeFileSync(join(site, o.file), svg(scene, `${x} ${y} ${w} ${h}`, '', o.background ?? false, o.fit));
      console.log(join(site, o.file));
    }
  }
}
