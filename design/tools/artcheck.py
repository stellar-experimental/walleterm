# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "scipy", "scikit-image"]
# ///
"""Measure and compare walleterm mascot drawings against the reference images.

  uv run design/tools/artcheck.py measure IMAGE...          # JSON metrics
  uv run design/tools/artcheck.py trace IMAGE...            # construction corners
  uv run design/tools/artcheck.py compare REF CANDIDATE [--out sheet.png] [--bands-only] [--walk]
  uv run design/tools/artcheck.py baseline                  # rebuild reference bands
  uv run design/tools/artcheck.py render SVG PNG            # rasterize at the SVG's own size

CANDIDATE may be a PNG or an SVG. An SVG is rendered with agent-browser at the
reference size. The compare command exits 1 when a metric leaves its band, or
differs from REF by more than its tolerance. --bands-only skips the second test,
for a new picture that no single reference matches. --walk skips the standing-leg
bands for a walking pose; its legs still compare with REF. The fill color passes
when it matches REF or the reference median, since the site uses the median.
See design/ILLUSTRATION.md for what each metric means.
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from skimage.color import deltaE_ciede2000, rgb2lab
from skimage.measure import approximate_polygon, find_contours

HERE = os.path.dirname(os.path.abspath(__file__))
REF_DIR = os.path.join(HERE, "..", "reference")
BANDS = os.path.join(REF_DIR, "metrics.json")


def tomato_mask(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (r > 0.72) & (g < 0.45) & (g > 0.15) & (b < 0.35) & (r - g > 0.35)


def components(mask):
    """Tomato components that do not touch the image edge, largest first (front panel, then flap)."""
    lbl, n = ndi.label(mask)
    edge = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
    sizes = ndi.sum(mask, lbl, range(1, n + 1))
    return [lbl == k + 1 for k in np.argsort(sizes)[::-1] if k + 1 not in edge]


def line_fit(t, v):
    """Sag: largest distance of the quadratic from the chord, over length. Wobble: rms after the quadratic."""
    t, v = np.asarray(t, float), np.asarray(v, float)
    L = float(np.hypot(t[-1] - t[0], v[-1] - v[0]))
    lin, quad = np.polyfit(t, v, 1), np.polyfit(t, v, 2)
    sag = np.polyval(quad, t) - np.polyval(lin, t)
    k = int(np.argmax(np.abs(sag)))
    return {"slope": float(lin[0]), "sag": float(sag[k] / L),
            "wobble_rms": float(np.sqrt(np.mean((v - np.polyval(quad, t)) ** 2)))}


def load(path):
    img = Image.open(path).convert("RGB")
    rgb = np.asarray(img).astype(np.float64) / 255.0
    return img, rgb, rgb2lab(rgb)


def rise(row, center):
    """Mean 10%-90% rise distance of the two sides of one ink run, with linear interpolation."""
    c = int(round(center))
    seg = row[max(0, c - 12):c + 13]
    seg = seg / max(seg.max(), 1e-6)
    peak = int(np.argmax(seg))

    def cross(values, level):
        for i in range(len(values) - 1):
            a, b = values[i], values[i + 1]
            if a < level <= b:
                return i + (level - a) / (b - a)
        return np.nan

    left = seg[:peak + 1]
    right = seg[peak:][::-1]
    d = [cross(v, 0.9) - cross(v, 0.1) for v in (left, right)]
    return float(np.nanmean(d))


def measure(path):
    img, rgb, lab = load(path)
    H, W = rgb.shape[:2]
    paper_L = float(np.median(lab[5:60, 5:60, 0]))
    front = components(tomato_mask(rgb))[0]
    ys, xs = np.nonzero(front)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    bh, bw = y1 - y0, x1 - x0
    m = {"file": os.path.basename(path), "box": [x0, y0, x1, y1], "fill_h": bh, "aspect": bw / bh}

    # Each window avoids that edge's corners: the right edge runs 0.12 to 1.0, the left 0 to 0.88.
    rows = [y for y in range(y0 + int(0.25 * bh), y0 + int(0.92 * bh)) if front[y].any()]
    m["edge_right"] = line_fit(rows, [np.nonzero(front[y])[0].max() for y in rows])
    rows = [y for y in range(y0 + int(0.10 * bh), y0 + int(0.78 * bh)) if front[y].any()]
    m["edge_left"] = line_fit(rows, [np.nonzero(front[y])[0].min() for y in rows])
    cols = [x for x in range(x0 + int(0.15 * bw), x1 - int(0.15 * bw)) if front[:, x].any()]
    m["edge_bottom"] = line_fit(cols, [np.nonzero(front[:, x])[0].max() for x in cols])

    holes = ndi.binary_fill_holes(front) & ~front
    lbl, n = ndi.label(holes)
    if n:
        sizes = ndi.sum(holes, lbl, range(1, n + 1))
        k = int(np.argmax(sizes)) + 1
        ey, ex = ndi.center_of_mass(holes, lbl, k)
        m["eye_diam"] = float(2 * np.sqrt(sizes[k - 1] / np.pi) / bh)
        m["eye_x"] = float((ex - x0) / bw)
        m["eye_y"] = float((ey - y0) / bh)

    fill = ndi.binary_erosion(front, iterations=max(2, bh // 25))
    m["lab_fill"] = [float(v) for v in np.median(lab[fill], axis=0)]
    m["lab_paper"] = [float(v) for v in np.median(lab[5:60, 5:60].reshape(-1, 3), axis=0)]
    if paper_L < 50:
        m["dark_ground"] = True
        return m

    # Legs: two ink runs below the panel. The darkness integral gives a subpixel width.
    dark = np.clip((paper_L - lab[..., 0]) / paper_L, 0, 1)
    ink = lab[..., 0] < 45
    lx0, lx1 = max(0, x0 - int(0.1 * bw)), min(W, x1 + int(0.1 * bw))
    pts = [[], []]
    for y in range(y1 + int(0.10 * bh), min(H - 1, y1 + int(1.3 * bh))):
        lbl, n = ndi.label(ink[y, lx0:lx1])
        if n != 2:
            if pts[0]:
                break
            continue
        runs = [np.nonzero(lbl == i)[0] for i in (1, 2)]
        if any(len(r) > 0.12 * bw for r in runs):
            break
        # A run much longer than the leg so far is a foot, not a leg.
        if pts[0] and any(len(r) > 2.5 * np.median([p[2] for p in pts[i]]) for i, r in enumerate(runs)):
            break
        for i, r in enumerate(runs):
            a, b = r.min() - 2 + lx0, r.max() + 3 + lx0
            seg = dark[y, a:b]
            pts[i].append((y, float((seg * np.arange(a, b)).sum() / seg.sum()), len(r), float(seg.sum())))
    if len(pts[0]) > 10:
        m["legs"] = [line_fit([p[0] for p in q], [p[1] for p in q]) for q in pts]
        m["leg_gap"] = float((pts[1][0][1] - pts[0][0][1]) / bw)
        # Width: the middle 80% of each leg, clear of the panel line and the foot.
        k = len(pts[0]) // 10
        w = np.array([p[3] for q in pts for p in q[k:len(q) - k]])
        m["stroke_h"] = float(np.median(w) / bh)
        m["stroke_cv"] = float(np.std(w) / np.mean(w))
        # Edge softness: the 10% to 90% rise across each side of a leg, interpolated, in stroke widths.
        m["edge_ramp"] = float(np.median([rise(dark[p[0]], p[1]) for q in pts for p in q[k:len(q) - k]]) / np.median(w))
    inkpx = ink & (np.abs(np.arange(H)[:, None] - (y0 + y1) / 2) < 2 * bh) & (lab[..., 0] < 20)
    if inkpx.any():
        m["lab_ink"] = [float(v) for v in np.median(lab[inkpx], axis=0)]
    return m


def trace(path):
    _, rgb, _ = load(path)
    comps = components(tomato_mask(rgb))

    def corners(mask, n):
        c = max(find_contours(ndi.binary_fill_holes(mask).astype(float), 0.5), key=len)
        for tol in np.linspace(1, 30, 120):
            p = approximate_polygon(c, tolerance=tol)
            if len(p) - 1 <= n:
                break
        return p[:-1][:, ::-1]

    fp, bp = corners(comps[0], 4), corners(comps[1], 3)
    x0, y0 = fp[:, 0].min(), fp[:, 1].min()
    h = fp[:, 1].max() - y0
    norm = lambda p: [[round(float((x - x0) / h * 1000)), round(float((y - y0) / h * 1000))] for x, y in p]
    return {"file": os.path.basename(path), "origin": [float(x0), float(y0)], "h": float(h),
            "front": norm(fp), "flap": norm(bp)}


# Metrics checked by `compare`. Each has a reference band (from `baseline`) and a pairwise tolerance.
CHECKS = [
    # name, getter, pairwise tolerance, rule
    ("aspect", lambda m: m["aspect"], 0.06, "band"),
    ("eye_diam", lambda m: m.get("eye_diam"), 0.015, "band"),
    ("eye_x", lambda m: m.get("eye_x"), 0.03, "band"),
    ("eye_y", lambda m: m.get("eye_y"), 0.04, "band"),
    ("stroke_h", lambda m: m.get("stroke_h"), 0.008, "band"),
    ("stroke_cv", lambda m: m.get("stroke_cv"), 0.08, "band"),
    ("leg_gap", lambda m: m.get("leg_gap"), 0.03, "band"),
    ("leg_splay", lambda m: m["legs"][1]["slope"] - m["legs"][0]["slope"] if "legs" in m else None, 0.03, "band"),
    ("edge_sag_max", lambda m: max(abs(m["edge_right"]["sag"]), abs(m["edge_left"]["sag"])), 0.008, "band"),
    ("edge_ramp", lambda m: m.get("edge_ramp"), 0.06, "band"),
]


# References left out of the standing-mascot bands, and why.
EXCLUDE = {
    "02-request-line-draft.png": "superseded draft",
    "07-balance-scale.png": "tomato ground hides the fill edge",
    "08-bridge-walk.png": "walking pose, legs are not standing",
}


def baseline():
    files = sorted(f for f in os.listdir(REF_DIR) if f.endswith(".png") and f not in EXCLUDE)
    ms = []
    for f in files:
        try:
            ms.append(measure(os.path.join(REF_DIR, f)))
        except Exception as e:  # scenes without a separable mascot
            print("skip", f, e, file=sys.stderr)
    bands = {}
    for name, get, _, _ in CHECKS:
        vals = [v for v in (get(m) for m in ms if not m.get("dark_ground") or name.startswith(("aspect", "eye"))) if v is not None]
        lo, hi = float(np.min(vals)), float(np.max(vals))
        pad = 0.1 * (hi - lo)
        bands[name] = {"min": lo - pad, "max": hi + pad, "median": float(np.median(vals)), "n": len(vals)}
    fills = np.array([m["lab_fill"] for m in ms])
    papers = np.array([m["lab_paper"] for m in ms if m["lab_paper"][0] > 90])
    bands["lab_fill"] = [float(v) for v in np.median(fills, axis=0)]
    bands["lab_paper"] = [float(v) for v in np.median(papers, axis=0)]
    json.dump({"bands": bands, "references": ms}, open(BANDS, "w"), indent=1)
    print(BANDS)


def render_svg(svg, size):
    out = tempfile.NamedTemporaryFile(suffix=".png", delete=False).name
    run = lambda *a: subprocess.run(["agent-browser", *a], check=True, capture_output=True, timeout=90)
    for attempt in (1, 2):
        try:
            run("set", "viewport", str(size[0]), str(size[1]))
            run("open", "file://" + os.path.abspath(svg))
            run("screenshot", out)
            return out
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            if attempt == 2:
                raise
            # A stuck browser session is the usual cause. Start a fresh one.
            subprocess.run(["agent-browser", "close"], capture_output=True, timeout=30)


def sheet(ref_path, cand_path, rm, cm, out):
    ra, ca = Image.open(ref_path).convert("RGB"), Image.open(cand_path).convert("RGB")

    def crop(img, m, box_rel, size):
        x0, y0, x1, y1 = m["box"]
        h = y1 - y0
        bx = (x0 + box_rel[0] * h, y0 + box_rel[1] * h, x0 + box_rel[2] * h, y0 + box_rel[3] * h)
        return img.crop(tuple(int(v) for v in bx)).resize(size, Image.LANCZOS)

    W = 1640
    rows = []
    rows.append((crop(ra, rm, (-0.4, -0.5, 1.5, 2.1), (800, 1095)), crop(ca, cm, (-0.4, -0.5, 1.5, 2.1), (800, 1095)), "mascot"))
    for label, box in [("fold corner", (-0.12, -0.3, 0.3, 0.14)), ("eye and right edge", (0.62, 0.05, 1.18, 0.61)),
                       ("legs and feet", (0.1, 1.0, 0.8, 1.7))]:
        size = (800, int(800 * (box[3] - box[1]) / (box[2] - box[0])))
        rows.append((crop(ra, rm, box, size), crop(ca, cm, box, size), label))
    # Overlay: reference ink in red, candidate ink in blue, overlap black.
    ro = np.asarray(crop(ra, rm, (-0.4, -0.5, 1.5, 2.1), (800, 1095)).convert("L")) < 90
    co = np.asarray(crop(ca, cm, (-0.4, -0.5, 1.5, 2.1), (800, 1095)).convert("L")) < 90
    ov = np.full(ro.shape + (3,), 255, np.uint8)
    ov[ro & ~co] = (220, 40, 40); ov[co & ~ro] = (40, 90, 220); ov[ro & co] = (0, 0, 0)
    height = sum(r[0].height + 40 for r in rows) + 1095 + 40
    s = Image.new("RGB", (W, height), "white")
    d = ImageDraw.Draw(s)
    font = ImageFont.load_default(size=26)
    y = 0
    for a, b, label in rows:
        d.text((10, y + 6), f"{label}: reference (left), candidate (right)", fill=(0, 0, 0), font=font)
        y += 40
        s.paste(a, (0, y)); s.paste(b, (840, y))
        y += a.height
    d.text((10, y + 6), "ink overlay: red = reference only, blue = candidate only, black = both", fill=(0, 0, 0), font=font)
    s.paste(Image.fromarray(ov), (420, y + 40))
    s.save(out)


LEG_CHECKS = {"leg_gap", "leg_splay"}


def compare(ref, cand, out, bands_only=False, walk=False):
    if cand.endswith(".svg"):
        cand = render_svg(cand, Image.open(ref).size)
    rm, cm = measure(ref), measure(cand)
    bands = json.load(open(BANDS))["bands"] if os.path.exists(BANDS) else {}
    fails = 0
    print(f"{'metric':14} {'reference':>10} {'candidate':>10} {'band':>17}  result")
    for name, get, tol, _ in CHECKS:
        r, c = get(rm), get(cm)
        if c is None:
            print(f"{name:14} {'-':>10} {'-':>10} {'':>17}  not measured")
            continue
        b = bands.get(name)
        ok_band = b is None or (walk and name in LEG_CHECKS) or b["min"] <= c <= b["max"]
        ok_pair = bands_only or tol is None or r is None or abs(c - r) <= tol
        ok = ok_band and ok_pair
        fails += not ok
        bs = f"[{b['min']:.4f}, {b['max']:.4f}]" if b else ""
        why = "" if ok else (" outside band" if not ok_band else f" differs by more than {tol}")
        rs = f"{r:10.4f}" if r is not None else f"{'-':>10}"
        print(f"{name:14} {rs} {c:10.4f} {bs:>17}  {'pass' if ok else 'FAIL' + why}")
    for key, limit in (("lab_fill", 3.0), ("lab_paper", 2.0)):
        mine = key == "lab_fill" and not bands_only or key == "lab_paper" and rm[key][0] > 90
        target = rm[key] if mine else bands.get(key)
        if target is None or (key == "lab_paper" and cm[key][0] < 90):
            continue
        de = float(deltaE_ciede2000(np.array(target), np.array(cm[key])))
        if key == "lab_fill" and "lab_fill" in bands:
            de = min(de, float(deltaE_ciede2000(np.array(bands["lab_fill"]), np.array(cm[key]))))
        fails += de > limit
        print(f"{key:14} {'':>10} {de:10.2f} {'dE2000 <= ' + str(limit):>17}  {'pass' if de <= limit else 'FAIL'}")
    if out:
        sheet(ref, cand, rm, cm, out)
        print("sheet:", out)
    return fails


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "measure":
        print(json.dumps([measure(p) for p in args], indent=1))
    elif cmd == "trace":
        print(json.dumps([trace(p) for p in args], indent=1))
    elif cmd == "baseline":
        baseline()
    elif cmd == "render":
        import re, shutil
        head = open(args[0]).read(400)
        size = tuple(int(v) for v in re.search(r'width="(\d+)" height="(\d+)"', head).groups())
        shutil.move(render_svg(args[0], size), args[1])
        print(args[1], size)
    elif cmd == "compare":
        out = args[args.index("--out") + 1] if "--out" in args else None
        sys.exit(1 if compare(args[0], args[1], out, "--bands-only" in args, "--walk" in args) else 0)
    else:
        print(__doc__); sys.exit(2)
