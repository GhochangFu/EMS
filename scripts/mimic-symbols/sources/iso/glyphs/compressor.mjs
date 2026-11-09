// Air compressor: a horizontal receiver tank on two saddles with its end cap and weld seams, the
// drain valve below, the safety valve and pressure gauge on top; the compressor block with its
// cooling fins and head, the belt guard and the motor with its fan cowl mounted on the tank.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Air compressor (isometric)";
const R = 9;
const AXIS_Z = R + 3;
const TOP = AXIS_Z + R;
export const extent = boxExtent(-21, -R, 0, 21, R, TOP + 11);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const axis = G.frameAlong([0, 0, AXIS_Z], [1, 0, 0]);
  const fins = [TOP + 2, TOP + 4, TOP + 6].map((z) => s.poly([[-4, 5, z], [-14, 5, z], [-14, -5, z]])).join("");
  return [
    { name: "saddle-back", solid: s.box(-15, -6, 0, -11, 6, AXIS_Z) },
    { name: "receiver", solid: s.xcyl(0, AXIS_Z, R, -20, 17) },
    { name: "seams", lines: G.arcOf(axis, -8, R, P) + G.arcOf(axis, 6, R, P) },
    { name: "end-cap", solid: s.xcyl(0, AXIS_Z, R - 2.5, 17, 20) },
    { name: "drain", solid: s.vcyl(4, 0, 1.2, 0.5, 3.5, 16) },
    { name: "saddle-front", solid: s.box(9, -6, 0, 13, 6, AXIS_Z - R + 1) },
    { name: "block", solid: s.box(-14, -5, TOP - 1, -4, 5, TOP + 8) },
    { name: "fins", lines: fins },
    { name: "head", solid: s.box(-15, -6, TOP + 8, -3, 6, TOP + 10.5) },
    { name: "belt-guard", solid: s.box(-4, -6, TOP - 1, -1.5, 6, TOP + 8) },
    { name: "motor", solid: s.xcyl(0, TOP + 4, 4.5, -1.5, 9) },
    { name: "motor-cowl", solid: s.xcyl(0, TOP + 4, 3.5, 9, 12) },
    { name: "safety-valve", solid: s.vcyl(15, -4, 1.2, TOP - 1.5, TOP + 4, 16) },
    { name: "gauge-stem", solid: s.vcyl(15, 3, 0.8, TOP - 1.5, TOP + 1.5, 12) },
    { name: "gauge", solid: s.ycyl(15, TOP + 3.5, 2.4, 2.2, 3.8) },
  ];
}
