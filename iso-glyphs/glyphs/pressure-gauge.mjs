// Pressure gauge on a pipe: the pipe run with flanges, the tapping and isolation cock, the
// siphon stem, and the gauge case with its bezel, scale ticks and needle.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Pressure gauge (isometric)";
const PIPE_Z = 5;
const DIAL_Z = 26;
const R = 9;
export const extent = boxExtent(-18, -8, 0, 18, 8, DIAL_Z + R);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const face = G.frameAlong([0, 3, DIAL_Z], [0, 1, 0]);
  const ticks = G.spokesOf(face, 0, R - 3.2, R - 1.8, 9, P, { from: Math.PI * 1.25, to: Math.PI * -0.25 });
  const needle = s.poly([[0, 3, DIAL_Z], [4.5, 3, DIAL_Z + 3.5]]);
  return [
    { name: "flange-back", solid: s.xcyl(0, PIPE_Z, 7, -18, -16) },
    { name: "pipe", solid: s.xcyl(0, PIPE_Z, 5, -16, 16) },
    { name: "tapping", solid: s.vcyl(0, 0, 1.8, PIPE_Z + 4, PIPE_Z + 8, 16) },
    { name: "cock", solid: s.box(-2.5, -2.5, PIPE_Z + 8, 2.5, 2.5, PIPE_Z + 12) },
    { name: "cock-handle", solid: s.box(2.5, -0.8, PIPE_Z + 9.5, 7, 0.8, PIPE_Z + 10.5) },
    { name: "stem", solid: s.vcyl(0, 0, 1.4, PIPE_Z + 12, DIAL_Z - R + 1, 16) },
    { name: "case", solid: s.ycyl(0, DIAL_Z, R, -3, 1.5) },
    { name: "bezel", solid: s.ycyl(0, DIAL_Z, R + 0.6, 1.5, 3) },
    { name: "ticks", lines: ticks },
    { name: "needle", lines: needle },
    { name: "flange-front", solid: s.xcyl(0, PIPE_Z, 7, 16, 18) },
  ];
}
