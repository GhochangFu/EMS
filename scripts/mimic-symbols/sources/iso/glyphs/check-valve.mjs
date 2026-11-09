// Swing check valve in a pipe run: pipe stubs, flanges, the body with its bolted cover and hinge
// boss on top, and the flow arrow on the cover.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Check valve (isometric)";
const R = 4.5;
export const extent = boxExtent(-24, -10, -10, 24, 10, 16);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const axis = G.frameAlong([0, 0, 0], [1, 0, 0]);
  const arrow = s.poly([[-6, 0, 13.5], [5, 0, 13.5]]) + s.poly([[2, -2.5, 13.5], [5, 0, 13.5], [2, 2.5, 13.5]]);
  return [
    { name: "stub-left", solid: s.xcyl(0, 0, R, -24, -14) },
    { name: "flange-left", solid: s.xcyl(0, 0, 8.5, -14, -11.5) },
    { name: "body", solid: s.xcyl(0, 0, 8, -11.5, 11.5) },
    { name: "body-seams", lines: G.arcOf(axis, -6, 8, P) + G.arcOf(axis, 6, 8, P) },
    { name: "cover-neck", solid: s.box(-9, -6, 5, 9, 6, 10) },
    { name: "cover", solid: s.box(-10, -7, 10, 10, 7, 12.5) },
    { name: "hinge-boss", solid: s.ycyl(-6, 8, 2, 6, 8) },
    { name: "arrow", lines: arrow },
    { name: "flange-right", solid: s.xcyl(0, 0, 8.5, 11.5, 14) },
    { name: "stub-right", solid: s.xcyl(0, 0, R, 14, 24) },
  ];
}
