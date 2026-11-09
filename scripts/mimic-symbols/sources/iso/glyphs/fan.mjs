// Axial fan: the round casing with its inlet bell and two flanges, the motor junction box on top,
// on two legs over a base; five blades, the hub and the nose cone seen on the front face, behind
// a guard ring.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Axial fan (isometric)";
const R = 12;
const AXIS_Z = R + 6;
export const extent = boxExtent(-10, -R - 2, 0, 13, R + 2, AXIS_Z + R + 5);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const centre = [7.5, 0, AXIS_Z];
  return [
    { name: "base", solid: s.box(-7, -11, 0, 7, 11, 2.5) },
    { name: "leg-back", solid: s.box(-2, -9, 2.5, 2, -6, AXIS_Z - 6) },
    { name: "inlet-bell", solid: s.turned([-6, 0, AXIS_Z], [-1, 0, 0], [[0, R], [2, R + 1.5], [4, R + 3]]) },
    { name: "flange-back", solid: s.xcyl(0, AXIS_Z, R + 1.5, -6, -5) },
    { name: "casing", solid: s.xcyl(0, AXIS_Z, R, -5, 6) },
    { name: "junction-box", solid: s.box(-3, -2.5, AXIS_Z + R - 1, 3, 2.5, AXIS_Z + R + 4) },
    { name: "flange-front", solid: s.xcyl(0, AXIS_Z, R + 1.5, 6, 7.5) },
    { name: "blades", lines: s.spokes(centre, [1, 0, 0], 3.5, R - 1, 5, Math.PI / 10) },
    { name: "guard", lines: s.circle(centre, [1, 0, 0], R - 4) },
    { name: "hub", solid: s.xcyl(0, AXIS_Z, 3.5, 7.5, 10) },
    { name: "nose", solid: s.turned([10, 0, AXIS_Z], [1, 0, 0], [[0, 3.5], [1.5, 2.5], [2.5, 1]]) },
    { name: "leg-front", solid: s.box(-2, 6, 2.5, 2, 9, AXIS_Z - 6) },
  ];
}
