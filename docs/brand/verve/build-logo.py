"""Build the Verve logo SVG files (ADR 0142 Amendment 1) by tracing the owner's brand board.

Usage: build-logo.py <board-1 image> <Montserrat[wght].ttf> <out_dir>

The pulse V and the letters "erve" are traced from the board image, so the shapes and the spacing
are the board's own. Only the tagline is set from a font (Montserrat Medium, outlined).
"""
import os
import sys

import cv2
import numpy as np
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image

SRC, FONT, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)

# Where the logo sits on board 1 (2000 x 1116 px), and how much to enlarge it before tracing.
X0, Y0, X1, Y1 = 95, 80, 575, 295
UP = 8
SMOOTH = 1.1   # px of the board: removes the pixel steps, keeps the corners
EPS = 0.12     # px of the board: largest gap between the traced curve and its polygon
PAD = 8.0

NAVY = "#0F172A"
WHITE = "#FFFFFF"
# Measured on the board, foot of the V to the peak.
LIGHT = [(0.0, "#16405C"), (0.38, "#18576C"), (0.6, "#189E7F"), (0.8, "#14B088"), (1.0, "#1DAF86")]
DARK = [(0.0, "#38BDF8"), (0.38, "#22B5D4"), (0.6, "#14B8A6"), (0.8, "#2DD4A0"), (1.0, "#34D399")]
TAG = os.environ.get("VERVE_TAGLINE", "THE PULSE OF EVERY SITE")


def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def smooth_closed(pts, sigma):
    """Gaussian-smooth a closed curve sampled about once per enlarged pixel."""
    n = len(pts)
    r = int(sigma * 3)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    idx = (np.arange(n)[:, None] + np.arange(-r, r + 1)[None, :]) % n
    return (pts[idx] * k[None, :, None]).sum(axis=1)


def trace(mask):
    """Outer and inner outlines of one shape, as lists of points in board px."""
    cnts, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    rings = []
    for c in cnts:
        if cv2.contourArea(c) < 40 * UP * UP:
            continue
        pts = smooth_closed(c[:, 0, :].astype(float), SMOOTH * UP)
        poly = cv2.approxPolyDP(pts.astype(np.float32)[:, None, :], EPS * UP, True)[:, 0, :]
        rings.append(poly / UP)
    return rings


def clip_x(ring, lo, hi):
    """Sutherland-Hodgman clip of a polygon to lo <= x <= hi."""
    def cut(points, edge, keep_ge):
        out = []
        for i, a in enumerate(points):
            b = points[(i + 1) % len(points)]
            ina = (a[0] >= edge) if keep_ge else (a[0] <= edge)
            inb = (b[0] >= edge) if keep_ge else (b[0] <= edge)
            if ina:
                out.append(a)
            if ina != inb:
                t = (edge - a[0]) / (b[0] - a[0])
                out.append((edge, a[1] + t * (b[1] - a[1])))
        return out
    return np.array(cut(cut([tuple(p) for p in ring], lo, True), hi, False))


def path(rings, dx=0.0, dy=0.0):
    return "".join("M" + "L".join(f"{fmt(x + dx)} {fmt(y + dy)}" for x, y in r) + "Z" for r in rings)


img = np.array(Image.open(SRC).convert("RGB"))[Y0:Y1, X0:X1]
big = cv2.resize(img, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC)
bg = np.median(big[: 5 * UP, : 5 * UP].reshape(-1, 3), axis=0)
ink = (np.linalg.norm(big.astype(float) - bg, axis=2) > 110).astype(np.uint8)
n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
comps = sorted((i for i in range(1, n) if stats[i, 4] > 1500 * (UP / 4) ** 2 and stats[i, 1] > 5 * UP),
               key=lambda i: stats[i, 0])[:5]
pulse_rings = trace((labels == comps[0]).astype(np.uint8))
letter_rings = [r for i in comps[1:] for r in trace((labels == i).astype(np.uint8))]

allpts = np.vstack(pulse_rings + letter_rings)
px0, py0 = np.vstack(pulse_rings).min(axis=0)
px1, py1 = np.vstack(pulse_rings).max(axis=0)
DX, DY = PAD - allpts[:, 0].min(), PAD - allpts[:, 1].min()
W = round(allpts[:, 0].max() + DX + PAD)
H = round(allpts[:, 1].max() + DY + PAD)
PULSE, LETTERS = path(pulse_rings, DX, DY), path(letter_rings, DX, DY)

# Tagline: Montserrat Medium, outlined, centred under the logo.
medium = instantiateVariableFont(TTFont(FONT), {"wght": 500})


def outline(text, x, baseline, size, track):
    scale = size / medium["head"].unitsPerEm
    glyphs, cmap, hmtx = medium.getGlyphSet(), medium.getBestCmap(), medium["hmtx"]
    pen = SVGPathPen(glyphs, ntos=fmt)
    cx = x
    for ch in text:
        name = cmap[ord(ch)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cx, baseline)))
        cx += hmtx[name][0] * scale + track
    return pen.getCommands(), cx - track


TAG_SIZE, TAG_TRACK = 19.0, 3.4
_, tag_w = outline(TAG, 0, 0, TAG_SIZE, TAG_TRACK)
TAG_H = H + 36
TAGLINE, _ = outline(TAG, (W - tag_w) / 2, H + 20, TAG_SIZE, TAG_TRACK)


def grad(stops, y_foot, y_peak, x):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return ('<defs><linearGradient id="verve-pulse" gradientUnits="userSpaceOnUse" '
            f'x1="{fmt(x)}" y1="{fmt(y_foot)}" x2="{fmt(x)}" y2="{fmt(y_peak)}">{s}</linearGradient></defs>')


def write(name, body, w, h):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(w)} {fmt(h)}" role="img" '
           f'aria-label="Verve"><title>Verve</title>{body}</svg>\n')
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(svg)


def logo(name, stops, ink_fill, tag_ink=None, flat=None):
    fill = flat or "url(#verve-pulse)"
    body = "" if flat else grad(stops, py1 + DY, py0 + DY, 0)
    body += f'<path d="{PULSE}" fill="{fill}"/><path d="{LETTERS}" fill="{ink_fill}" fill-rule="evenodd"/>'
    if tag_ink:
        body += f'<path d="{TAGLINE}" fill="{tag_ink}"/>'
    write(name, body, W, TAG_H if tag_ink else H)


# The short mark: the same pulse with most of the lead-in and the tail cut off, in a square box.
m_lo, m_hi = px0 + 0.16 * (px1 - px0), px0 + 0.80 * (px1 - px0)
mark_ring = clip_x(pulse_rings[0], m_lo, m_hi)
mw, mh = m_hi - m_lo, py1 - py0
BOX = 256.0
ms = (BOX * 0.74) / max(mw, mh)
mdx, mdy = (BOX - mw * ms) / 2 - m_lo * ms, (BOX - mh * ms) / 2 - py0 * ms
MARK = path([mark_ring * ms], mdx, mdy)


def mark(name, stops, tile=None, flat=None):
    fill = flat or "url(#verve-pulse)"
    body = "" if flat else grad(stops, py1 * ms + mdy, py0 * ms + mdy, 0)
    if tile:
        body += f'<rect width="{fmt(BOX)}" height="{fmt(BOX)}" rx="{fmt(BOX * 0.23)}" fill="{tile}"/>'
    body += f'<path d="{MARK}" fill="{fill}"/>'
    write(name, body, BOX, BOX)


for f in os.listdir(OUT):
    if f.endswith(".svg") or f == "preview.html":
        os.remove(os.path.join(OUT, f))

logo("verve-logo-light.svg", LIGHT, NAVY)
logo("verve-logo-dark.svg", DARK, WHITE)
logo("verve-logo-tagline-light.svg", LIGHT, NAVY, tag_ink=NAVY)
logo("verve-logo-tagline-dark.svg", DARK, WHITE, tag_ink="#A7F3D0")
logo("verve-logo-flat-navy.svg", None, NAVY, flat=NAVY)
logo("verve-logo-flat-white.svg", None, WHITE, flat=WHITE)
mark("verve-mark-tile-navy.svg", DARK, tile=NAVY)
mark("verve-mark-tile-white.svg", LIGHT, tile=WHITE)
mark("verve-mark-dark.svg", DARK)
mark("verve-mark-light.svg", LIGHT)
mark("verve-mark-flat-navy.svg", None, flat=NAVY)
mark("verve-mark-flat-white.svg", None, flat=WHITE)

order = ["verve-logo-tagline-light.svg", "verve-logo-tagline-dark.svg", "verve-logo-light.svg",
         "verve-logo-dark.svg", "verve-logo-flat-navy.svg", "verve-logo-flat-white.svg",
         "verve-mark-tile-navy.svg", "verve-mark-tile-white.svg", "verve-mark-light.svg",
         "verve-mark-dark.svg", "verve-mark-flat-navy.svg", "verve-mark-flat-white.svg"]
cells = []
for i, name in enumerate(order):
    with open(os.path.join(OUT, name), encoding="utf-8") as fh:
        raw = fh.read()
    dark = "dark" in name or "flat-white" in name
    sizes = ["64px", "32px", "16px"] if "mark" in name else ["300px"]
    inner = "".join(f'<div style="width:{s}">' + raw.replace("verve-pulse", f"g{i}{k}") + "</div>"
                    for k, s in enumerate(sizes))
    cells.append(f'<figure style="background:{"#0F172A" if dark else "#E9F2F4"}">{inner}'
                 f'<figcaption style="color:{"#fff" if dark else "#0F172A"}">{name}</figcaption></figure>')
with open(os.path.join(OUT, "preview.html"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write('<!doctype html><meta charset="utf-8"><title>Verve logo files</title>'
             '<style>body{margin:12px;font:12px sans-serif;display:grid;'
             'grid-template-columns:repeat(2,1fr);gap:10px;background:#ccc}'
             'figure{margin:0;padding:16px;border-radius:10px;display:flex;flex-wrap:wrap;'
             'align-items:center;gap:14px}figcaption{flex-basis:100%}</style>' + "".join(cells))

print(f"size={W}x{H} pulse_pts={sum(len(r) for r in pulse_rings)} "
      f"letter_rings={len(letter_rings)} letter_pts={sum(len(r) for r in letter_rings)}")
for name in order[:1] + order[6:7]:
    print(name, os.path.getsize(os.path.join(OUT, name)))
