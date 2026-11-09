// Electromagnetic flow meter (BCPL, PHE): the pipe spool with its two flanges, the meter body
// with its coil bands, the neck, the terminal box and the transmitter head with its display
// window and cable gland.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Flow meter (isometric)";
const AXIS_Z = 9;
const R = 4.5;
export const extent = boxExtent(-24, -9, 0, 24, 9, AXIS_Z + 22);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const HEAD_Z = AXIS_Z + 17;
  return [
    { name: "pipe-back", solid: s.xcyl(0, AXIS_Z, R, -24, -14) },
    { name: "flange-back", solid: s.xcyl(0, AXIS_Z, 8, -14, -11.5) },
    { name: "body", solid: s.xcyl(0, AXIS_Z, 7, -11.5, 11.5) },
    { name: "body-bands", lines: [-6, 6].map((x) => G.arcOf(G.frameAlong([0, 0, AXIS_Z], [1, 0, 0]), x, 7, P)).join("") },
    { name: "terminal-box", solid: s.box(-3, -3, HEAD_Z - 3, 3, 3, HEAD_Z - 1.5) },
    { name: "neck", solid: s.vcyl(0, 0, 2.2, AXIS_Z + 6, HEAD_Z - 5, 16) },
    { name: "head", solid: s.ycyl(0, HEAD_Z, 6, -4, 4) },
    { name: "window", lines: s.circle([0, 4, HEAD_Z], [0, 1, 0], 3.2) },
    { name: "gland", solid: s.xcyl(0, HEAD_Z - 1, 1.2, 5.5, 8.5) },
    { name: "flange-front", solid: s.xcyl(0, AXIS_Z, 8, 11.5, 14) },
    { name: "pipe-front", solid: s.xcyl(0, AXIS_Z, R, 14, 24) },
  ];
}
