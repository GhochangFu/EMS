// Turns anatomy-kit solids into a stroke-only glyph that the TRINETRA mimic symbol upload accepts.
//
// The upload (apps/api/src/mimic-symbol-libraries/svg-symbol-parser.ts) keeps geometry only:
// no class, fill, stroke or style, at most 200 shapes, path data of M/L/Z and numbers. A "stroke"
// library draws every shape with fill="none", so nothing hides what is behind it. This module does
// the hidden-line removal at build time: each solid's outline and crease lines are cut where a
// solid painted later (nearer the viewer) covers them.

/** Parses kit path data (M, L, Z only, absolute) into subpaths of [x, y] points. */
export function parsePath(d) {
  const subpaths = [];
  let current = null;
  const re = /([MLZ])([^MLZ]*)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    const [cmd, args] = [m[1], m[2].trim()];
    if (cmd === "Z") {
      if (current && current.points.length) current.closed = true;
      continue;
    }
    const nums = args.split(/[\s,]+/).filter(Boolean).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const point = [nums[i], nums[i + 1]];
      if (cmd === "M" && i === 0) {
        current = { points: [point], closed: false };
        subpaths.push(current);
      } else {
        current.points.push(point);
      }
    }
  }
  return subpaths;
}

/** Closed polygons of a fill path, for the inside test. */
function polygonsOf(d) {
  return parsePath(d).map((s) => s.points).filter((p) => p.length >= 3);
}

function insideEvenOdd(point, polygons) {
  let inside = false;
  const [x, y] = point;
  for (const poly of polygons) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function distanceToEdges(point, polygons) {
  let best = Infinity;
  const [px, py] = point;
  for (const poly of polygons) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j];
      const [bx, by] = poly[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
  }
  return best;
}

/**
 * A point is hidden when it is inside an occluder and more than `margin` from its edge, so a line
 * that runs along an occluder's own silhouette (two parts that touch) stays drawn.
 */
function hidden(point, occluders, margin) {
  for (const polygons of occluders) {
    if (insideEvenOdd(point, polygons) && distanceToEdges(point, polygons) > margin) return true;
  }
  return false;
}

/** Splits polylines into the runs no occluder hides, sampled every `step` screen units. */
function visibleRuns(polylines, occluders, { step, margin }) {
  const runs = [];
  for (const { points, closed } of polylines) {
    const pts = closed ? [...points, points[0]] : points;
    let run = [];
    const flush = () => {
      if (run.length >= 2) runs.push(run);
      run = [];
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let s = i === 0 ? 0 : 1; s <= n; s++) {
        const p = [ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n];
        if (hidden(p, occluders, margin)) flush();
        else run.push(p);
      }
    }
    flush();
  }
  return runs;
}

/** Drops points that sit on the straight line between their neighbours (within `tolerance`). */
function simplify(run, tolerance) {
  if (run.length <= 2) return run;
  const out = [run[0]];
  for (let i = 1; i < run.length - 1; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = run[i + 1];
    const [px, py] = run[i];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const off = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (off > tolerance) out.push(run[i]);
  }
  out.push(run[run.length - 1]);
  return out;
}

const fmt = (n) => {
  const v = Math.round(n * 10) / 10;
  return Object.is(v, -0) ? "0" : String(v);
};

/**
 * `parts` in paint order, back to front: `{ name, solid }` with a kit `SolidPaths`, or
 * `{ name, lines }` with extra path data that hides nothing. Returns one path `d` per part that
 * keeps at least one visible line.
 */
export function hiddenLineGlyph(parts, { step = 0.2, margin = 0.35, tolerance = 0.05 } = {}) {
  const fills = parts.map((p) => (p.solid ? polygonsOf(p.solid.fill) : null));
  const out = [];
  parts.forEach((part, index) => {
    const source = part.solid ? [part.solid.outline, part.solid.crease].filter(Boolean).join("") : part.lines;
    const occluders = fills.slice(index + 1).filter(Boolean);
    const runs = visibleRuns(parsePath(source), occluders, { step, margin })
      .map((run) => simplify(run, tolerance))
      .filter((run) => Math.hypot(run.at(-1)[0] - run[0][0], run.at(-1)[1] - run[0][1]) > 0.3 || run.length > 2);
    if (runs.length === 0) return;
    const d = runs.map((run) => "M" + run.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")).join("");
    out.push({ name: part.name, d });
  });
  return out;
}

/** The glyph as an SVG file in the upload grammar: a viewBox and bare `<path d>` shapes only. */
export function glyphSvg(paths, viewBox) {
  const body = paths.map((p) => `  <path d="${p.d}"/>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(" ")}">\n${body}\n</svg>\n`;
}
