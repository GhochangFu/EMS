// Short helpers over the anatomy kit for glyph modules. World axes: x and y on the ground, z up.
// The viewer looks from +x +y (azimuth 45°), so the faces at the high x and high y sides show.

/** The eight corners of a box, for a glyph's `extent` (the camera fit). */
export function boxExtent(x0, y0, z0, x1, y1, z1) {
  const out = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([x, y, z]);
  return out;
}

export function shapesOf(k, G, P) {
  return {
    /** An axis-aligned box from corner to corner, with slightly rounded plan corners. */
    box: (x0, y0, z0, x1, y1, z1) => k.slabOf({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0.5 }, z0, z1 - z0, P, 2),
    /** An upright cylinder. */
    vcyl: (cx, cy, r, z0, z1, steps = 40) => k.cylinder(cx, cy, r, z0, z1 - z0, P, steps),
    /** A cylinder along x through (y, z). */
    xcyl: (y, z, r, x0, x1) => G.disc(x0, x1, r, G.frameAlong([0, y, z], [1, 0, 0]), P, { steps: 48 }),
    /** A cylinder along y through (x, z). */
    ycyl: (x, z, r, y0, y1) => G.disc(y0, y1, r, G.frameAlong([x, 0, z], [0, 1, 0]), P, { steps: 48 }),
    /** A turned solid along an axis: profile is [[s, r], …] from the origin along `axis`. */
    turned: (origin, axis, profile) => G.solidOf(profile, G.frameAlong(origin, axis), P),
    /** A flat closed face through world points (any plane): it hides the lines behind it. */
    flat: (points) => {
      const d = k.pathOf(k.pointsAt(points, P), true);
      return { fill: d, outline: d };
    },
    /** A polyline through world points. */
    poly: (points, closed = false) => k.pathOf(k.pointsAt(points, P), closed),
    /** A circle on a plane normal to `axis`, centred on `centre`. */
    circle: (centre, axis, r) => G.circleOf(G.frameAlong(centre, axis), 0, r, P),
    /** Spokes on a plane normal to `axis`, centred on `centre`. */
    spokes: (centre, axis, r0, r1, count, phase = 0) => G.spokesOf(G.frameAlong(centre, axis), 0, r0, r1, count, P, { phase }),
  };
}
