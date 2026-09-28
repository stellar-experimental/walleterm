// The walleterm mascot: a folded wallet with one eye and two thin legs.
// Construction units: the front panel is 1000 units tall. Its top-left corner is (0, 0).
// Every proportion here was traced from design/reference (see design/ILLUSTRATION.md).

import {
  type Hand,
  type Point,
  blob,
  defaultHand,
  inkStroke,
  jitter,
  rng,
  smoothPath,
  wobbleLine,
  wobblePolyline,
} from './hand.ts';

export type Mascot = {
  hand?: Partial<Hand>;
  /** Ink color. On black, black ink leaves only a thin gap between flap and panel (11). */
  ink?: string;
  /** Leg color, or "none" for no legs. The references use cream legs on black (11). */
  legs?: string;
  /** Leg and foot ink weight. Reference 11 draws thin cream legs at 0.64. */
  legWeight?: number;
  /** Standing is the default. Walking follows reference 08. */
  pose?: 'stand' | 'walk';
  fill?: string;
  /** Distance from the panel top to the ground, in units. References: 1630 to 1900. */
  ground?: number;
  /** Foot length multiplier. Reference 15 uses short feet on a ground line. */
  feet?: number;
  /** Signed bow for a front-panel edge, as a fraction of its length. Positive bows outward. */
  bows?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  /** Panel width multiplier. Standing references range from 0.96 to 1.06 of the median. */
  widen?: number;
  /** Foot ink weight, relative to the legs. Reference 15 uses 1.35; 16 uses 1. */
  footWeight?: number;
  /** Leg splay multiplier. */
  splay?: number;
  /** Soften the ink edge, in stroke widths. The references measure a 10%-90% ramp near 0.35 stroke widths. */
  soften?: number;
};

export const colors = {
  ink: '#0a0a09',
  // Medians across the cream-ground references, measured in CIELAB.
  tomato: '#e74d36',
  paper: '#fbf6e6',
};

// Traced from references 01, 04, 05, 12, 14, 15, 16 (medians, rounded).
const front: Point[] = [
  [0, 0],
  [1040, 120],
  [1090, 1000],
  [35, 880],
];
const flap: Point[] = [
  [6, -4],
  [860, -222],
  [872, 106],
];
const eye = { c: [905, 322] as Point, r: 50 };
const legs = {
  // Feet are short ticks, about 0.17h and 0.2h, slightly heavier than the legs.
  left: { top: [365, 917] as Point, splay: -12, foot: [-170, 8] as Point },
  right: { top: [566, 941] as Point, splay: 8, foot: [200, 3] as Point },
};
// Traced from reference 08: straight diagonal legs, a flat back foot, a front foot tipped up.
// Each leg is [top, bottom, toe]. The ground sits near 1490.
const walk: Point[][] = [
  [
    [292, 911],
    [120, 1480],
    [-50, 1478],
  ],
  [
    [722, 954],
    [935, 1450],
    [1070, 1385],
  ],
];

/** Return SVG markup for the mascot in construction units. */
export function mascot(options: Mascot = {}): string {
  const hand = { ...defaultHand, ...options.hand };
  const random = rng(hand.seed);
  const ink = options.ink ?? colors.ink;
  const legInk = options.legs ?? ink;
  const fill = options.fill ?? colors.tomato;
  const j = hand.width * 0.2;
  const ground = options.ground ?? 1900;
  const feet = options.feet ?? 1;

  const widen = options.widen ?? 1;
  const f = jitter(
    front.map(([x, y]) => [x * widen, y] as Point),
    j,
    random,
  );
  const b = jitter(
    flap.map(([x, y]) => [x * widen, y] as Point),
    j,
    random,
  );
  b[0] = [f[0][0] + 6, f[0][1] - 4];
  // The flap's inner corner rests on the front panel's top edge.
  const t = (b[2][0] - f[0][0]) / (f[1][0] - f[0][0]);
  b[2] = [b[2][0], f[0][1] + t * (f[1][1] - f[0][1]) - 2];

  // Per-edge bows replace the random bow for that edge. Order: top, right, bottom, left.
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  // Every reference bends the right edge inward by about 0.9% (median of 16), so the
  // bottom-right corner flares out. The left edge is close to straight.
  // Measured as one smooth arc. An off-center peak reads as a hook at the corner.
  const bows = { right: -0.018, left: -0.002, ...options.bows };
  const edgeHand = (i: number) => {
    const b = bows[sides[i] as keyof typeof bows];
    // The ring runs clockwise on screen, so the left of travel is inward.
    return b === undefined ? hand : { ...hand, bow: 0, bias: -b };
  };
  const edges = sides.map((_, i) => wobbleLine(f[i], f[(i + 1) % 4], edgeHand(i), random));
  const frontLine = edges.flatMap((e, i) => (i === 0 ? e : e.slice(1)));
  const flapLine = wobblePolyline(b, hand, random, false);

  const out: string[] = [];
  out.push(`<path d="${smoothPath(flapLine, true)}" fill="${fill}"/>`);
  out.push(`<path d="${smoothPath(frontLine, true)}" fill="${fill}"/>`);

  const strokes: string[] = [];
  {
    for (const e of edges) strokes.push(inkStroke(e, hand, random));
    strokes.push(inkStroke(wobblePolyline([b[0], b[1]], hand, random), hand, random));
    strokes.push(inkStroke(wobblePolyline([b[1], b[2]], hand, random), hand, random));
  }
  // Soft ink edges come from a faint stroke around each ink shape, not from an SVG blur.
  // Safari draws filters at 1x and scales them up, which blurs the whole mascot on Retina screens.
  const soft = options.soften ?? 0.1;
  const halo = (color: string, width: number) =>
    soft > 0
      ? ` stroke="${color}" stroke-opacity="0.3" stroke-width="${(width * soft * 1.5).toFixed(2)}" stroke-linejoin="round"`
      : '';
  if (strokes.length) out.push(`<path d="${strokes.join('')}" fill="${ink}"${halo(ink, hand.width)}/>`);

  const legPaths: string[] = [];
  const weight = options.legWeight ?? 1;
  const stance =
    options.pose === 'walk'
      ? // Traced from reference 08 with its own panel width, so no widening.
        walk
      : [legs.left, legs.right].map((leg) => {
          // Legs hang from the panel, so they move with its width.
          const x = leg.top[0] * widen;
          const bottom: Point = [
            x + leg.splay * (options.splay ?? 1) + (random() * 2 - 1) * 4,
            ground + (random() * 2 - 1) * 3,
          ];
          return [
            [x, leg.top[1]] as Point,
            bottom,
            [bottom[0] + leg.foot[0] * feet, bottom[1] + leg.foot[1] * feet] as Point,
          ];
        });
  for (const [legTop, bottom, foot] of legInk === 'none' ? [] : stance) {
    const top: Point = [legTop[0], legTop[1] - hand.width * 0.3];
    // Legs are straight lines that splay. A bowed leg reads as bent knees.
    const legHand = { ...hand, bow: 0.0015, width: hand.width * weight };
    legPaths.push(inkStroke(wobblePolyline([top, bottom], legHand, random), legHand, random));
    // Feet are ticks that sit on the ground, not in it.
    const lift = hand.width * 0.2;
    legPaths.push(
      inkStroke(
        wobblePolyline(
          [
            [bottom[0], bottom[1] - lift],
            [foot[0], foot[1] - lift],
          ],
          legHand,
          random,
        ),
        legHand,
        random,
        options.footWeight ?? 1.1,
      ),
    );
  }
  if (legPaths.length) out.push(`<path d="${legPaths.join('')}" fill="${legInk}"${halo(legInk, hand.width * weight)}/>`);
  out.push(`<path d="${blob([eye.c[0] * widen, eye.c[1]], eye.r, random)}" fill="${colors.ink}"/>`);
  return out.join('\n');
}

/** The mascot's extent in construction units, with room for ink. */
export const mascotBox = { x: -200, y: -270, w: 1520, h: 2240 };
