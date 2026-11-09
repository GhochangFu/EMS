// Horizontal storage tank (diesel day tank, air receiver): the shell with dished ends and weld
// seams on two saddles, the manhole and the vent pipe on top, the fill pipe, and the level gauge
// on the end.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Horizontal tank (isometric)";
const R = 9;
const AXIS_Z = R + 4;
const L = 18;
export const extent = boxExtent(-L - 4, -R, 0, L + 4, R, AXIS_Z + R + 8);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const axis = G.frameAlong([0, 0, AXIS_Z], [1, 0, 0]);
  const TOP = AXIS_Z + R;
  return [
    { name: "saddle-back", solid: s.box(-L + 3, -R + 2, 0, -L + 7, R - 2, AXIS_Z - 3) },
    { name: "end-back", solid: s.turned([-L, 0, AXIS_Z], [-1, 0, 0], [[0, R], [2.5, R - 2.5], [4, R - 6]]) },
    { name: "shell", solid: s.xcyl(0, AXIS_Z, R, -L, L) },
    { name: "seams", lines: [-6, 6].map((x) => G.arcOf(axis, x, R, P)).join("") },
    { name: "end-front", solid: s.turned([L, 0, AXIS_Z], [1, 0, 0], [[0, R], [2.5, R - 2.5], [4, R - 6]]) },
    { name: "gauge", solid: s.box(L + 3.5, -1, AXIS_Z - 6, L + 4.5, 1, AXIS_Z + 6) },
    { name: "saddle-front", solid: s.box(L - 7, -R + 2, 0, L - 3, R - 2, AXIS_Z - 3) },
    { name: "manhole", solid: s.vcyl(-4, 0, 4, TOP - 1, TOP + 2, 32) },
    { name: "manhole-cover", solid: s.vcyl(-4, 0, 5, TOP + 2, TOP + 3.5, 32) },
    { name: "vent", solid: s.vcyl(-13, 0, 1.2, TOP - 1, TOP + 7, 16) },
    { name: "vent-cap", solid: s.vcyl(-13, 0, 2.2, TOP + 7, TOP + 8, 16) },
    { name: "fill", solid: s.vcyl(8, 2, 1.6, TOP - 1, TOP + 4, 16) },
    { name: "fill-cap", solid: s.vcyl(8, 2, 2.4, TOP + 4, TOP + 5.5, 16) },
  ];
}
