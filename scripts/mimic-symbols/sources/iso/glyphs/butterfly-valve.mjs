// Butterfly valve in a pipe run: pipe stubs, flanges, the wafer body with the disc seen edge-on
// through it, the stem, the gearbox and the handwheel with spokes.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Butterfly valve (isometric)";
const R = 4.5;
export const extent = boxExtent(-24, -10, -10, 24, 10, 26);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  return [
    { name: "stub-left", solid: s.xcyl(0, 0, R, -24, -6) },
    { name: "flange-left", solid: s.xcyl(0, 0, 9, -6, -3.5) },
    { name: "body", solid: s.xcyl(0, 0, 8, -3.5, 3.5) },
    { name: "disc", lines: s.circle([3.5, 0, 0], [1, 0, 0], 5.5) + s.poly([[3.5, 0, -5.5], [3.5, 0, 5.5]]) },
    { name: "neck", solid: s.vcyl(0, 0, 2.5, 7, 14, 20) },
    { name: "gearbox", solid: s.box(-4, -4, 14, 4, 6, 24) },
    { name: "wheel-shaft", solid: s.ycyl(0, 21, 1, 6, 8.5) },
    { name: "handwheel", solid: s.ycyl(0, 21, 6, 8.5, 10) },
    { name: "spokes", lines: G.spokesOf(G.frameAlong([0, 10, 21], [0, 1, 0]), 0, 1.2, 4.5, 3, P) + s.circle([0, 10, 21], [0, 1, 0], 4.5) },
    { name: "flange-right", solid: s.xcyl(0, 0, 9, 3.5, 6) },
    { name: "stub-right", solid: s.xcyl(0, 0, R, 6, 24) },
  ];
}
