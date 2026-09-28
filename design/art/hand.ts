// Hand-drawn ink lines for walleterm illustrations.
// Two layers, after AlMeraj et al. (2009): a path that drifts like an arm movement,
// and an ink body whose width varies along that path. All geometry is baked into
// the SVG, so the look does not change with display size. See design/ILLUSTRATION.md.

export type Point = [number, number];

// Deterministic PRNG (mulberry32). The same seed always draws the same picture.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 1D value noise in [-1, 1] with cosine interpolation.
function noise1d(random: () => number, cells: number) {
  const lattice = Array.from({ length: cells + 2 }, () => random() * 2 - 1);
  return (t: number) => {
    const x = t * cells;
    const i = Math.floor(x);
    const f = (1 - Math.cos((x - i) * Math.PI)) / 2;
    return lattice[i] * (1 - f) + lattice[i + 1] * f;
  };
}

export type Hand = {
  seed: number;
  /** Ink width in drawing units. */
  width: number;
  /** Largest bow of a whole line, as a fraction of its length. Reference: 0.002 to 0.008. */
  bow: number;
  /** Slow drift along a line, as a fraction of its length. */
  drift: number;
  /** Width variation along a line, as a fraction of the width. Reference CV: 0.04 to 0.2. */
  swell: number;
  /** Fine edge roughness, as a fraction of the width. */
  grain: number;
  /** A fixed, signed bow in place of the random one, as a fraction of the length. Positive bows left of travel. */
  bias?: number;
};

export const defaultHand: Hand = {
  seed: 7,
  width: 26,
  bow: 0.005,
  drift: 0.0018,
  swell: 0.1,
  grain: 0.015,
};

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const len = (a: Point) => Math.hypot(a[0], a[1]);

/** Resample a straight line into a slightly bowed, drifting centerline. */
export function wobbleLine(a: Point, b: Point, hand: Hand, random: () => number): Point[] {
  const d = sub(b, a);
  const L = len(d);
  const n: Point = [-d[1] / L, d[0] / L];
  // A point every 1.25 widths keeps every measured trait; denser points only add bytes.
  const steps = Math.min(120, Math.max(4, Math.ceil(L / (hand.width * 1.25))));
  const r = random() * 2 - 1;
  const bow = hand.bias !== undefined ? hand.bias * L : r * hand.bow * L;
  const drift = noise1d(random, 2 + Math.floor(random() * 2));
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Ends stay on their vertices so that joins meet.
    const off = bow * 4 * t * (1 - t) + hand.drift * L * drift(t) * Math.sin(Math.PI * t);
    pts.push([a[0] + d[0] * t + n[0] * off, a[1] + d[1] * t + n[1] * off]);
  }
  return pts;
}

/** Join the wobbly lines through a list of vertices. */
export function wobblePolyline(vertices: Point[], hand: Hand, random: () => number, closed = false): Point[] {
  const out: Point[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const seg = wobbleLine(vertices[i], vertices[(i + 1) % vertices.length], hand, random);
    out.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return out;
}

/** Move each vertex a little, so no angle is exact. */
export function jitter(vertices: Point[], amount: number, random: () => number): Point[] {
  return vertices.map(([x, y]) => [x + (random() * 2 - 1) * amount, y + (random() * 2 - 1) * amount]);
}

/**
 * Turn a centerline into a filled ink body. The width swells and thins slowly, grows
 * a little at the ends where ink pools, and has fine edge roughness. Ends are round.
 */
export function inkStroke(pts: Point[], hand: Hand, random: () => number, widthScale = 1): string {
  const w0 = hand.width * widthScale;
  const swell = noise1d(random, 3);
  const grainL = noise1d(random, Math.max(4, Math.floor(pts.length / 2)));
  const grainR = noise1d(random, Math.max(4, Math.floor(pts.length / 2)));
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const tan = sub(next, prev);
    const tl = len(tan) || 1;
    const n: Point = [-tan[1] / tl, tan[0] / tl];
    const pool = 1 + 0.08 * Math.pow(Math.abs(2 * t - 1), 6);
    const half = (w0 / 2) * pool * (1 + hand.swell * swell(t));
    const hl = half * (1 + hand.grain * grainL(t));
    const hr = half * (1 + hand.grain * grainR(t));
    left.push([p[0] + n[0] * hl, p[1] + n[1] * hl]);
    right.push([p[0] - n[0] * hr, p[1] - n[1] * hr]);
  }
  // A half circle around `center` that starts at `from` and bulges toward `outward`.
  const cap = (center: Point, from: Point, outward: Point): Point[] => {
    const r = len(sub(from, center));
    const a0 = Math.atan2(from[1] - center[1], from[0] - center[0]);
    const dir = Math.atan2(outward[1], outward[0]);
    const s = Math.cos(a0 + Math.PI / 2 - dir) > 0 ? 1 : -1;
    const out: Point[] = [];
    for (let k = 1; k < 8; k++) {
      const a = a0 + (s * Math.PI * k) / 8;
      out.push([center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r]);
    }
    return out;
  };
  const last = pts.length - 1;
  const ring: Point[] = [
    ...left,
    ...cap(pts[last], left[last], sub(pts[last], pts[last - 1])),
    ...[...right].reverse(),
    ...cap(pts[0], right[0], sub(pts[0], pts[1])),
  ];
  // Whole units are fine once a line is 10 units wide: the error stays under 5% of its width.
  return smoothPath(ring, true, hand.width >= 10 ? 1 : 10);
}

/**
 * Quadratic smoothing through midpoints (the perfect-freehand path method).
 * `scale` sets the coordinate precision: 10 keeps one decimal, 1 keeps whole units.
 */
export function smoothPath(ring: Point[], closed: boolean, scale = 10): string {
  const f = (v: number) => Math.round(v * scale) / scale;
  const p = closed ? [...ring, ring[0]] : ring;
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[i + 1];
    d += `Q${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)}`;
  }
  d += `L${f(p[p.length - 1][0])} ${f(p[p.length - 1][1])}`;
  return closed ? d + 'Z' : d;
}

/**
 * A cut-paper circle: flat, no outline, and very slightly out of round.
 * The references measure a slow wobble of 0.2% to 0.5% of the radius (harmonics 2 to 5),
 * and 1.3% on the keyhole top. `wobble` is that rms, as a fraction of `r`. The harmonics
 * repeat around the circle, so the outline closes without a seam.
 */
export function cutCircle(c: Point, r: number, random: () => number, wobble = 0.003): string {
  const waves = [2, 3, 4, 5].map((k) => ({ k, a: random() * 2 - 1, phase: random() * Math.PI * 2 }));
  const rms = Math.sqrt(waves.reduce((s, w) => s + w.a * w.a, 0) / 2) || 1;
  const pts: Point[] = [];
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    const offset = waves.reduce((s, w) => s + w.a * Math.cos(w.k * t + w.phase), 0) / rms;
    const rr = r * (1 + wobble * offset);
    pts.push([c[0] + Math.cos(t) * rr, c[1] + Math.sin(t) * rr]);
  }
  return smoothPath(pts, true);
}

/** A slightly irregular filled disc for eyes and dots. */
export function blob(c: Point, r: number, random: () => number, irregularity = 0.025): string {
  const wob = noise1d(random, 5);
  const pts: Point[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rr = r * (1 + irregularity * wob(i / 28));
    pts.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]);
  }
  return smoothPath(pts, true);
}
