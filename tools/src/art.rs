//! `art`: the walleterm illustrations as static SVG files. See design/ILLUSTRATION.md.
//! Every scene is a recreation in its reference's own pixels, written to design/art/out for artcheck.py.
//! A scene with site outputs also writes cropped files to site/art. Sections: the hand-drawn line, the
//! mascot, and the scenes.
//!
//! This port of the former TypeScript generator writes the same bytes. That needs three JavaScript rules:
//! `Math.round` rounds halves up, numbers print as `Number#toString` does, and an integer power multiplies.

use std::f64::consts::PI;
use std::path::Path;

use crate::Result;

type Point = [f64; 2];

/// JavaScript `Math.round`: the nearest integer, with halves toward positive infinity.
fn js_round(v: f64) -> f64 {
    // `v - floor(v)` is exact in binary, unlike `v + 0.5`.
    let floor = v.floor();
    if v - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// JavaScript `Number#toString` for the finite values these scenes print.
/// Both languages print the shortest digits that read back exactly. When the value lies exactly halfway
/// between two such readings, JavaScript picks the one with the even last digit.
fn js(v: f64) -> String {
    if v == 0.0 {
        return "0".into();
    }
    let short = format!("{v}");
    let Some(point) = short.find('.') else { return short };
    let digits = short.len() - point - 1;
    let sign = if v < 0.0 { "-" } else { "" };
    let exact = format!("{:.*}", digits + 60, v.abs());
    let cut = exact.find('.').expect("a decimal point") + 1 + digits;
    let (truncated, rest) = exact.split_at(cut);
    if !(rest.starts_with('5') && rest[1..].bytes().all(|b| b == b'0')) {
        return short;
    }
    let last = truncated.as_bytes()[truncated.len() - 1] - b'0';
    let even = if last.is_multiple_of(2) {
        truncated.to_owned()
    } else if last < 9 {
        format!("{}{}", &truncated[..truncated.len() - 1], last + 1)
    } else {
        return short;
    };
    let candidate = format!("{sign}{even}");
    if candidate.parse::<f64>() == Ok(v) { candidate } else { short }
}

/// Deterministic PRNG (mulberry32). The same seed always draws the same picture.
struct Rng(u32);

impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

/// Smooth 1D value noise in [-1, 1] with cosine interpolation.
struct Noise {
    lattice: Vec<f64>,
    cells: f64,
}

impl Noise {
    fn new(random: &mut Rng, cells: usize) -> Self {
        Noise { lattice: (0..cells + 2).map(|_| random.next() * 2.0 - 1.0).collect(), cells: cells as f64 }
    }

    fn at(&self, t: f64) -> f64 {
        let x = t * self.cells;
        let i = x.floor();
        let f = (1.0 - ((x - i) * PI).cos()) / 2.0;
        let i = i as usize;
        self.lattice[i] * (1.0 - f) + self.lattice[i + 1] * f
    }
}

#[derive(Clone, Copy)]
struct Hand {
    seed: u32,
    /// Ink width in drawing units.
    width: f64,
    /// Largest bow of a whole line, as a fraction of its length. Reference: 0.002 to 0.008.
    bow: f64,
    /// Slow drift along a line, as a fraction of its length.
    drift: f64,
    /// Width variation along a line, as a fraction of the width. Reference CV: 0.04 to 0.2.
    swell: f64,
    /// Fine edge roughness, as a fraction of the width.
    grain: f64,
    /// A fixed, signed bow in place of the random one, as a fraction of the length. Positive bows left of travel.
    bias: Option<f64>,
}

const DEFAULT_HAND: Hand =
    Hand { seed: 7, width: 26.0, bow: 0.005, drift: 0.0018, swell: 0.1, grain: 0.015, bias: None };

fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

fn len(a: Point) -> f64 {
    a[0].hypot(a[1])
}

/// Resample a straight line into a slightly bowed, drifting centerline.
fn wobble_line(a: Point, b: Point, hand: &Hand, random: &mut Rng) -> Vec<Point> {
    let d = sub(b, a);
    let l = len(d);
    let n = [-d[1] / l, d[0] / l];
    let steps = 4f64.max((l / (hand.width * 0.5)).ceil()) as usize;
    let r = random.next() * 2.0 - 1.0;
    let bow = match hand.bias {
        Some(bias) => bias * l,
        None => r * hand.bow * l,
    };
    let cells = 2 + (random.next() * 2.0).floor() as usize;
    let drift = Noise::new(random, cells);
    (0..=steps)
        .map(|i| {
            let t = i as f64 / steps as f64;
            // Ends stay on their vertices so that joins meet.
            let off = bow * 4.0 * t * (1.0 - t) + hand.drift * l * drift.at(t) * (PI * t).sin();
            [a[0] + d[0] * t + n[0] * off, a[1] + d[1] * t + n[1] * off]
        })
        .collect()
}

/// Join the wobbly lines through a list of vertices.
fn wobble_polyline(vertices: &[Point], hand: &Hand, random: &mut Rng, closed: bool) -> Vec<Point> {
    let mut out = Vec::new();
    let count = if closed { vertices.len() } else { vertices.len() - 1 };
    for i in 0..count {
        let seg = wobble_line(vertices[i], vertices[(i + 1) % vertices.len()], hand, random);
        out.extend(if i == 0 { &seg[..] } else { &seg[1..] });
    }
    out
}

/// Move each vertex a little, so no angle is exact.
fn jitter(vertices: &[Point], amount: f64, random: &mut Rng) -> Vec<Point> {
    vertices
        .iter()
        .map(|&[x, y]| {
            let x = x + (random.next() * 2.0 - 1.0) * amount;
            [x, y + (random.next() * 2.0 - 1.0) * amount]
        })
        .collect()
}

/// Turn a centerline into a filled ink body. The width swells and thins slowly, grows
/// a little at the ends where ink pools, and has fine edge roughness. Ends are round.
fn ink_stroke(pts: &[Point], hand: &Hand, random: &mut Rng, width_scale: f64) -> String {
    let w0 = hand.width * width_scale;
    let swell = Noise::new(random, 3);
    let grain_cells = 4.max(pts.len() / 2);
    let grain_l = Noise::new(random, grain_cells);
    let grain_r = Noise::new(random, grain_cells);
    let mut left = Vec::with_capacity(pts.len());
    let mut right = Vec::with_capacity(pts.len());
    for i in 0..pts.len() {
        let t = i as f64 / (pts.len() - 1) as f64;
        let p = pts[i];
        let tan = sub(pts[(i + 1).min(pts.len() - 1)], pts[i.saturating_sub(1)]);
        let tl = match len(tan) {
            0.0 => 1.0,
            tl => tl,
        };
        let n = [-tan[1] / tl, tan[0] / tl];
        // JavaScriptCore computes an integer power by multiplication.
        let e = (2.0 * t - 1.0).abs();
        let e2 = e * e;
        let pool = 1.0 + 0.08 * (e2 * e2 * e2);
        let half = (w0 / 2.0) * pool * (1.0 + hand.swell * swell.at(t));
        let hl = half * (1.0 + hand.grain * grain_l.at(t));
        let hr = half * (1.0 + hand.grain * grain_r.at(t));
        left.push([p[0] + n[0] * hl, p[1] + n[1] * hl]);
        right.push([p[0] - n[0] * hr, p[1] - n[1] * hr]);
    }
    // A half circle around `center` that starts at `from` and bulges toward `outward`.
    let cap = |center: Point, from: Point, outward: Point| -> Vec<Point> {
        let r = len(sub(from, center));
        let a0 = (from[1] - center[1]).atan2(from[0] - center[0]);
        let dir = outward[1].atan2(outward[0]);
        let s = if (a0 + PI / 2.0 - dir).cos() > 0.0 { 1.0 } else { -1.0 };
        (1..8)
            .map(|k| {
                let a = a0 + (s * PI * f64::from(k)) / 8.0;
                [center[0] + a.cos() * r, center[1] + a.sin() * r]
            })
            .collect()
    };
    let last = pts.len() - 1;
    let mut ring = left.clone();
    ring.extend(cap(pts[last], left[last], sub(pts[last], pts[last - 1])));
    ring.extend(right.iter().rev());
    ring.extend(cap(pts[0], right[0], sub(pts[0], pts[1])));
    smooth_path(&ring, true)
}

/// Quadratic smoothing through midpoints (the perfect-freehand path method).
fn smooth_path(ring: &[Point], closed: bool) -> String {
    let f = |v: f64| js(js_round(v * 10.0) / 10.0);
    let mut p = ring.to_vec();
    if closed {
        p.push(ring[0]);
    }
    let mut d = format!("M{} {}", f(p[0][0]), f(p[0][1]));
    for i in 1..p.len() - 1 {
        let [x0, y0] = p[i];
        let [x1, y1] = p[i + 1];
        d += &format!("Q{} {} {} {}", f(x0), f(y0), f((x0 + x1) / 2.0), f((y0 + y1) / 2.0));
    }
    let end = p[p.len() - 1];
    d += &format!("L{} {}", f(end[0]), f(end[1]));
    if closed {
        d.push('Z');
    }
    d
}

/// A slightly irregular filled disc for eyes and dots.
fn blob(c: Point, r: f64, random: &mut Rng) -> String {
    let wob = Noise::new(random, 5);
    let pts: Vec<Point> = (0..28)
        .map(|i| {
            let a = (f64::from(i) / 28.0) * PI * 2.0;
            let rr = r * (1.0 + 0.025 * wob.at(f64::from(i) / 28.0));
            [c[0] + a.cos() * rr, c[1] + a.sin() * rr]
        })
        .collect();
    smooth_path(&pts, true)
}

// ---------- The mascot: a folded wallet with one eye and two thin legs ----------
// Construction units: the front panel is 1000 units tall. Its top-left corner is (0, 0).
// Every proportion here was traced from design/reference (see design/ILLUSTRATION.md).

const INK: &str = "#0a0a09";
// Medians across the cream-ground references, measured in CIELAB.
const TOMATO: &str = "#e74d36";
const PAPER: &str = "#fbf6e6";

// Traced from references 01, 04, 05, 12, 14, 15, 16 (medians, rounded).
const FRONT: [Point; 4] = [[0.0, 0.0], [1040.0, 120.0], [1090.0, 1000.0], [35.0, 880.0]];
const FLAP: [Point; 3] = [[6.0, -4.0], [860.0, -222.0], [872.0, 106.0]];
const EYE: (Point, f64) = ([905.0, 322.0], 50.0);
/// Feet are short ticks, about 0.17h and 0.2h, slightly heavier than the legs: (top, splay, foot).
const LEGS: [(Point, f64, Point); 2] =
    [([365.0, 917.0], -12.0, [-170.0, 8.0]), ([566.0, 941.0], 8.0, [200.0, 3.0])];
/// Traced from reference 08: straight diagonal legs, a flat back foot, a front foot tipped up.
/// Each leg is [top, bottom, toe]. The ground sits near 1490.
const WALK: [[Point; 3]; 2] =
    [[[292.0, 911.0], [120.0, 1480.0], [-50.0, 1478.0]], [[722.0, 954.0], [935.0, 1450.0], [1070.0, 1385.0]]];

#[derive(Clone, Copy)]
struct Mascot {
    /// Ink width and roughness. `None` fields keep the default hand.
    width: Option<f64>,
    swell: Option<f64>,
    /// Ink color. On black, black ink leaves only a thin gap between flap and panel (11).
    ink: &'static str,
    /// Leg color, or "none" for no legs. The references use cream legs on black (11).
    legs: Option<&'static str>,
    /// Leg and foot ink weight. Reference 11 draws thin cream legs at 0.64.
    leg_weight: f64,
    /// Standing is the default. Walking follows reference 08.
    walk: bool,
    fill: &'static str,
    /// Distance from the panel top to the ground, in units. References: 1630 to 1900.
    ground: f64,
    /// Foot length multiplier. Reference 15 uses short feet on a ground line.
    feet: f64,
    /// A signed bow for the right edge, as a fraction of its length. Positive bows outward.
    right_bow: f64,
    /// Panel width multiplier. Standing references range from 0.96 to 1.06 of the median.
    widen: f64,
    /// Foot ink weight, relative to the legs. Reference 15 uses 1.35; 16 uses 1.
    foot_weight: f64,
    /// Leg splay multiplier.
    splay: f64,
    /// Soften the ink edge, in stroke widths. The references measure a 10%-90% ramp near 0.35 stroke widths.
    soften: f64,
}

const MASCOT: Mascot = Mascot {
    width: None,
    swell: None,
    ink: INK,
    legs: None,
    leg_weight: 1.0,
    walk: false,
    fill: TOMATO,
    ground: 1900.0,
    feet: 1.0,
    // Every reference bends the right edge inward by about 0.9% (median of 16), so the
    // bottom-right corner flares out. Measured as one smooth arc.
    right_bow: -0.018,
    widen: 1.0,
    foot_weight: 1.1,
    splay: 1.0,
    soften: 0.1,
};

/// SVG markup for the mascot in construction units.
fn mascot(options: &Mascot) -> String {
    let hand = Hand {
        width: options.width.unwrap_or(DEFAULT_HAND.width),
        swell: options.swell.unwrap_or(DEFAULT_HAND.swell),
        ..DEFAULT_HAND
    };
    let random = &mut Rng(hand.seed);
    let leg_ink = options.legs.unwrap_or(options.ink);
    let j = hand.width * 0.2;
    let widen = options.widen;
    let f = jitter(&FRONT.map(|[x, y]| [x * widen, y]), j, random);
    let mut b = jitter(&FLAP.map(|[x, y]| [x * widen, y]), j, random);
    b[0] = [f[0][0] + 6.0, f[0][1] - 4.0];
    // The flap's inner corner rests on the front panel's top edge.
    let t = (b[2][0] - f[0][0]) / (f[1][0] - f[0][0]);
    b[2] = [b[2][0], f[0][1] + t * (f[1][1] - f[0][1]) - 2.0];

    // Per-edge bows replace the random bow for that edge. Order: top, right, bottom, left.
    // The ring runs clockwise on screen, so the left of travel is inward.
    let bows = [None, Some(options.right_bow), None, Some(-0.002)];
    let edges: Vec<Vec<Point>> = (0..4)
        .map(|i| {
            let edge_hand = match bows[i] {
                Some(bow) => Hand { bow: 0.0, bias: Some(-bow), ..hand },
                None => hand,
            };
            wobble_line(f[i], f[(i + 1) % 4], &edge_hand, random)
        })
        .collect();
    let front_line: Vec<Point> =
        edges.iter().enumerate().flat_map(|(i, e)| if i == 0 { &e[..] } else { &e[1..] }).copied().collect();
    let flap_line = wobble_polyline(&b, &hand, random, false);

    let mut out = vec![
        format!("<path d=\"{}\" fill=\"{}\"/>", smooth_path(&flap_line, true), options.fill),
        format!("<path d=\"{}\" fill=\"{}\"/>", smooth_path(&front_line, true), options.fill),
    ];
    let mut strokes = String::new();
    for e in &edges {
        strokes += &ink_stroke(e, &hand, random, 1.0);
    }
    for pair in [[b[0], b[1]], [b[1], b[2]]] {
        let line = wobble_polyline(&pair, &hand, random, false);
        strokes += &ink_stroke(&line, &hand, random, 1.0);
    }
    let soft = options.soften;
    let filter = if soft > 0.0 { format!(" filter=\"url(#ink-soft-{})\"", hand.seed) } else { String::new() };
    if soft > 0.0 {
        out.insert(
            0,
            format!(
                "<defs><filter id=\"ink-soft-{}\" x=\"-5%\" y=\"-5%\" width=\"110%\" height=\"110%\"><feGaussianBlur stdDeviation=\"{:.2}\"/></filter></defs>",
                hand.seed,
                hand.width * soft
            ),
        );
    }
    out.push(format!("<path d=\"{strokes}\" fill=\"{}\"{filter}/>", options.ink));

    // The stance draws random numbers even without legs, so later strokes keep their shape.
    let stance: Vec<[Point; 3]> = if options.walk {
        // Traced from reference 08 with its own panel width, so no widening.
        WALK.to_vec()
    } else {
        LEGS.iter()
            .map(|&(top, splay, foot)| {
                // Legs hang from the panel, so they move with its width.
                let x = top[0] * widen;
                let bx = x + splay * options.splay + (random.next() * 2.0 - 1.0) * 4.0;
                let bottom = [bx, options.ground + (random.next() * 2.0 - 1.0) * 3.0];
                [
                    [x, top[1]],
                    bottom,
                    [bottom[0] + foot[0] * options.feet, bottom[1] + foot[1] * options.feet],
                ]
            })
            .collect()
    };
    let mut leg_paths = String::new();
    if leg_ink != "none" {
        for [leg_top, bottom, foot] in stance {
            let top = [leg_top[0], leg_top[1] - hand.width * 0.3];
            // Legs are straight lines that splay. A bowed leg reads as bent knees.
            let leg_hand = Hand { bow: 0.0015, width: hand.width * options.leg_weight, ..hand };
            let leg = wobble_polyline(&[top, bottom], &leg_hand, random, false);
            leg_paths += &ink_stroke(&leg, &leg_hand, random, 1.0);
            // Feet are ticks that sit on the ground, not in it.
            let lift = hand.width * 0.2;
            let tick = wobble_polyline(
                &[[bottom[0], bottom[1] - lift], [foot[0], foot[1] - lift]],
                &leg_hand,
                random,
                false,
            );
            leg_paths += &ink_stroke(&tick, &leg_hand, random, options.foot_weight);
        }
        out.push(format!("<path d=\"{leg_paths}\" fill=\"{leg_ink}\"{filter}/>"));
    }
    out.push(format!("<path d=\"{}\" fill=\"{INK}\"/>", blob([EYE.0[0] * widen, EYE.0[1]], EYE.1, random)));
    out.join("\n")
}

// ---------- Scenes ----------

/// Place the mascot so its front panel's top-left ink corner is at (x, y) and the panel is h pixels tall.
fn place(x: f64, y: f64, h: f64, options: &Mascot) -> String {
    format!(
        "<g transform=\"translate({} {}) scale({})\">{}</g>",
        js(x),
        js(y),
        js(h / 1000.0),
        mascot(options)
    )
}

/// Place the mascot from `artcheck.py trace` output, which reports the fill's top-left
/// corner and height. The ink centerline sits half a stroke outside the fill.
fn place_from_trace(origin: Point, fill_h: f64, options: &Mascot) -> String {
    let w = options.width.unwrap_or(DEFAULT_HAND.width) / 1000.0;
    let h = fill_h / (1.0 - w);
    place(origin[0] - (w * h) / 2.0, origin[1] - (w * h) / 2.0, h, options)
}

/// A hand-drawn line through points, in scene pixels.
fn line(points: &[Point], width: f64, seed: u32, color: &str, bow: Option<f64>) -> String {
    let h = Hand { seed, width, bow: bow.unwrap_or(DEFAULT_HAND.bow), ..DEFAULT_HAND };
    let random = &mut Rng(seed);
    let centerline = wobble_polyline(points, &h, random, false);
    format!("<path d=\"{}\" fill=\"{color}\"/>", ink_stroke(&centerline, &h, random, 1.0))
}

/// A hand-drawn cubic curve. It drifts a little, like the straight lines.
fn curve(p: [Point; 4], width: f64, seed: u32, color: &str) -> String {
    let h = Hand { seed, width, ..DEFAULT_HAND };
    let random = &mut Rng(seed);
    let pts: Vec<Point> = (0..=120)
        .map(|i| {
            let t = f64::from(i) / 120.0;
            let u = 1.0 - t;
            let c = [u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t];
            [
                c[0] * p[0][0] + c[1] * p[1][0] + c[2] * p[2][0] + c[3] * p[3][0],
                c[0] * p[0][1] + c[1] * p[1][1] + c[2] * p[2][1] + c[3] * p[3][1],
            ]
        })
        .collect();
    format!("<path d=\"{}\" fill=\"{color}\"/>", ink_stroke(&pts, &h, random, 1.0))
}

// Scene colors, measured in each reference.
const MOSS: &str = "#768746";
const DEEP_MOSS: &str = "#2a4525";
const BLOCK_MOSS: &str = "#7b8d4f";
const DOT_MOSS: &str = "#44592a";
const MOON: &str = "#f4eedc";
const MOON_NIGHT: &str = "#fbf4e4";
const NIGHT: &str = "#050404";

// Reference 11, in its own pixels. On black, black ink leaves only the gap between flap
// and panel. Legs are thin and cream.
fn night_mascot() -> String {
    place_from_trace(
        [344.5, 630.0],
        120.5,
        &Mascot {
            ink: NIGHT,
            legs: Some(MOON_NIGHT),
            leg_weight: 0.64,
            ground: 1650.0,
            feet: 0.35,
            ..MASCOT
        },
    )
}

fn horizon_line() -> String {
    line(&[[-50.0, 835.5], [700.0, 835.0], [1720.0, 835.5]], 4.5, 71, MOON_NIGHT, Some(0.0015))
}

struct Site {
    file: &'static str,
    /// viewBox in scene pixels: x, y, width, height.
    crop: [i32; 4],
    /// SVG preserveAspectRatio, for art that fills a band.
    fit: Option<&'static str>,
}

struct Scene {
    name: &'static str,
    width: u32,
    height: u32,
    background: &'static str,
    body: fn() -> String,
    site: &'static [Site],
}

const SCENES: [Scene; 10] = [
    // Parity recreation of design/reference/15-moss-circle.png.
    Scene {
        name: "15-moss-circle",
        width: 1672,
        height: 941,
        background: PAPER,
        body: || {
            [
                "<circle cx=\"836.5\" cy=\"278.5\" r=\"156\" fill=\"#48602d\"/>".to_owned(),
                line(&[[660.0, 806.5], [1011.0, 806.5]], 3.8, 31, INK, None),
                place_from_trace(
                    [786.5, 498.0],
                    185.5,
                    // This reference bends its right edge more than the median.
                    &Mascot {
                        ground: 1636.0,
                        feet: 0.45,
                        foot_weight: 1.35,
                        widen: 1.045,
                        splay: 1.7,
                        right_bow: -0.026,
                        ..MASCOT
                    },
                ),
            ]
            .join("\n")
        },
        site: &[],
    },
    // Parity recreation of design/reference/16-hourglass.png, with default mascot options.
    Scene {
        name: "16-hourglass",
        width: 1672,
        height: 941,
        background: PAPER,
        body: || {
            [
                "<path d=\"M371 796 L548 673 L711 796 Z\" fill=\"#61703f\"/>".to_owned(),
                line(&[[290.0, 147.0], [838.0, 147.0]], 4.2, 41, INK, None),
                line(&[[290.0, 147.0], [817.0, 812.0]], 4.2, 42, INK, None),
                line(&[[838.0, 147.0], [272.0, 812.0]], 4.2, 43, INK, None),
                line(&[[272.0, 812.0], [817.0, 812.0]], 4.2, 44, INK, None),
                // Only the fill color is matched to this reference; its red is lighter than the median.
                place_from_trace(
                    [1190.5, 414.0],
                    219.5,
                    &Mascot { ground: 1880.0, fill: "#f3563d", ..MASCOT },
                ),
            ]
            .join("\n")
        },
        site: &[],
    },
    // Hero: design/reference/01-moon-green-field.png without the wordmark.
    Scene {
        name: "01-moon-green-field",
        width: 1672,
        height: 941,
        background: MOSS,
        body: || {
            [
                format!("<circle cx=\"1350.5\" cy=\"181\" r=\"79\" fill=\"{MOON}\"/>"),
                // This reference's panel is narrower than the median, and its line is finer and less even.
                // A finer line needs relatively more softness to read the same.
                place_from_trace(
                    [1191.5, 414.0],
                    219.5,
                    &Mascot {
                        widen: 0.95,
                        ground: 1870.0,
                        width: Some(19.0),
                        swell: Some(0.25),
                        soften: 0.12,
                        ..MASCOT
                    },
                ),
            ]
            .join("\n")
        },
        site: &[Site { file: "hero.svg", crop: [1130, 80, 360, 780], fit: None }],
    },
    // How it works: design/reference/04-request-line.png.
    Scene {
        name: "04-request-line",
        width: 1672,
        height: 941,
        background: PAPER,
        body: || {
            [
                curve([[521.0, 460.0], [800.0, 330.0], [1180.0, 290.0], [1424.0, 355.0]], 3.4, 51, INK),
                format!("<circle cx=\"1453.5\" cy=\"361\" r=\"33\" fill=\"{DOT_MOSS}\"/>"),
                // This reference's panel is wider than the median, and its legs are shorter.
                place_from_trace([376.5, 444.0], 145.5, &Mascot { widen: 1.055, ground: 1680.0, ..MASCOT }),
            ]
            .join("\n")
        },
        site: &[Site { file: "request.svg", crop: [340, 280, 1180, 440], fit: None }],
    },
    // Boundaries: design/reference/10-keyhole.png.
    Scene {
        name: "10-keyhole",
        width: 1672,
        height: 941,
        background: DEEP_MOSS,
        body: || {
            [
                "<circle cx=\"638.5\" cy=\"262\" r=\"223\" fill=\"#f6f0da\"/>".to_owned(),
                "<path d=\"M524 420 L753 420 L887 888 L376 888 Z\" fill=\"#f6f0da\"/>".to_owned(),
                // This reference's panel is wider than the median.
                place_from_trace([1065.5, 568.0], 173.5, &Mascot { widen: 1.07, ground: 1820.0, ..MASCOT }),
            ]
            .join("\n")
        },
        site: &[Site { file: "keyhole.svg", crop: [340, 20, 980, 885], fit: None }],
    },
    // Websites: design/reference/08-bridge-walk.png. The blocks and line run far past the
    // canvas, so the site band can fill any width.
    Scene {
        name: "08-bridge-walk",
        width: 1254,
        height: 1254,
        background: PAPER,
        body: || {
            [
                format!("<path d=\"M-3000 696 H311 V1260 H-3000 Z\" fill=\"{BLOCK_MOSS}\"/>"),
                format!("<path d=\"M948 695 H4300 V1260 H948 Z\" fill=\"{BLOCK_MOSS}\"/>"),
                line(
                    &[
                        [-3000.0, 697.0],
                        [-1200.0, 696.0],
                        [311.0, 696.0],
                        [948.0, 694.0],
                        [2500.0, 695.0],
                        [4300.0, 694.0],
                    ],
                    3.8,
                    61,
                    INK,
                    Some(0.0015),
                ),
                line(&[[313.0, 697.0], [313.5, 1300.0]], 3.8, 62, INK, None),
                line(&[[947.5, 696.0], [946.0, 1300.0]], 3.8, 63, INK, None),
                // Walking pose, from this reference. Its panel is wider than the median.
                // Held at the top of the brand band; the reference itself is a little heavier.
                // This reference has crisper ink edges than the median.
                place_from_trace(
                    [569.5, 450.0],
                    161.5,
                    &Mascot { walk: true, widen: 1.08, width: Some(31.0), soften: 0.07, ..MASCOT },
                ),
            ]
            .join("\n")
        },
        site: &[
            // Wide screens: the gap sits at 35% across, clear of the night moon below it.
            Site { file: "bridge.svg", crop: [1, 380, 1794, 520], fit: Some("xMidYMid slice") },
            // Phones: the gap is centered.
            Site { file: "bridge-narrow.svg", crop: [-270, 380, 1794, 520], fit: Some("xMidYMid slice") },
        ],
    },
    // Install: design/reference/11-horizon-moon.png. The site lays out the moon itself and
    // uses the two parts below, so each file holds one thing.
    Scene {
        name: "11-horizon-moon",
        width: 1672,
        height: 941,
        background: NIGHT,
        body: || {
            [
                format!("<circle cx=\"1310\" cy=\"15\" r=\"535\" fill=\"{MOON_NIGHT}\"/>"),
                horizon_line(),
                night_mascot(),
            ]
            .join("\n")
        },
        site: &[],
    },
    Scene {
        name: "night-wallet",
        width: 1672,
        height: 941,
        background: NIGHT,
        body: night_mascot,
        site: &[Site { file: "night-wallet.svg", crop: [318, 580, 170, 258], fit: None }],
    },
    Scene {
        name: "night-horizon",
        width: 1672,
        height: 941,
        background: NIGHT,
        body: horizon_line,
        site: &[Site { file: "horizon.svg", crop: [0, 830, 1672, 11], fit: Some("none") }],
    },
    // Favicon. No reference shows the mascot this small, so the ink is heavier and the legs go.
    Scene {
        name: "favicon",
        width: 64,
        height: 64,
        background: MOSS,
        body: || {
            format!("<rect width=\"64\" height=\"64\" rx=\"14\" fill=\"{MOSS}\"/>")
                + &place(
                    10.0,
                    19.0,
                    38.0,
                    &Mascot { legs: Some("none"), width: Some(70.0), soften: 0.0, ..MASCOT },
                )
        },
        site: &[Site { file: "favicon.svg", crop: [0, 0, 64, 64], fit: None }],
    },
];

fn svg(scene: &Scene, view_box: &str, size: &str, background: bool, fit: Option<&str>) -> String {
    let ratio = fit.map(|f| format!(" preserveAspectRatio=\"{f}\"")).unwrap_or_default();
    let ground = if background {
        format!(
            "<rect x=\"-5000\" y=\"-5000\" width=\"10000\" height=\"10000\" fill=\"{}\"/>\n",
            scene.background
        )
    } else {
        String::new()
    };
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{view_box}\"{size}{ratio}>\n{ground}{}\n</svg>\n",
        (scene.body)()
    )
}

/// Every scene file and site file, as (path relative to the repository, contents).
pub fn files() -> Vec<(String, String)> {
    let mut files = Vec::new();
    for scene in &SCENES {
        let (w, h) = (scene.width, scene.height);
        files.push((
            format!("design/art/out/{}.svg", scene.name),
            svg(scene, &format!("0 0 {w} {h}"), &format!(" width=\"{w}\" height=\"{h}\""), true, None),
        ));
        for site in scene.site {
            let [x, y, w, h] = site.crop;
            files.push((
                format!("site/art/{}", site.file),
                svg(scene, &format!("{x} {y} {w} {h}"), "", false, site.fit),
            ));
        }
    }
    files
}

/// Write every illustration under `root`.
pub fn build(root: &Path) -> Result<String> {
    let mut written = Vec::new();
    for (path, contents) in files() {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().expect("a parent")).map_err(|e| e.to_string())?;
        std::fs::write(&path, contents).map_err(|e| format!("{}: {e}", path.display()))?;
        written.push(path.display().to_string());
    }
    Ok(written.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed site art is exactly what this generator writes.
    #[test]
    fn the_site_art_is_the_generated_bytes() {
        let root = crate::repository();
        let site: Vec<_> = files().into_iter().filter(|(path, _)| path.starts_with("site/art/")).collect();
        assert_eq!(site.len(), 8);
        for (path, contents) in site {
            assert_eq!(std::fs::read_to_string(root.join(&path)).unwrap(), contents, "{path} changed");
        }
    }

    #[test]
    // The tie value is written with all its exact binary digits on purpose.
    #[allow(clippy::excessive_precision)]
    fn numbers_print_as_javascript_prints_them() {
        assert_eq!(js(-0.0), "0");
        assert_eq!(js(1350.0), "1350");
        assert_eq!(js(0.2237512742099898), "0.2237512742099898");
        // An exact decimal tie takes the even last digit, as Number#toString does.
        assert_eq!(js(-91.327667236328125), "-91.32766723632812");
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(0.49999999999999994), 0.0);
    }
}
