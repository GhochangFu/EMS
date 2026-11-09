// Centrifugal blower: the motor with its fan cowl and ribs on a pedestal, the volute casing with
// its seam, the inlet bell and flanged inlet on the front face, and the discharge duct with its
// flange rising from the volute, on one base.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Centrifugal blower (isometric)";
const AXIS_Z = 14;
const R = 11;
export const extent = boxExtent(-24, -12, 0, 12, 12, AXIS_Z + R + 6);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const axis = G.frameAlong([0, 0, AXIS_Z], [1, 0, 0]);
  return [
    { name: "base", solid: s.box(-24, -12, 0, 8, 12, 2.5) },
    { name: "pedestal", solid: s.box(-21, -5, 2.5, -9, 5, AXIS_Z - 5) },
    { name: "cowl", solid: s.xcyl(0, AXIS_Z, 4.2, -24, -21) },
    { name: "motor", solid: s.xcyl(0, AXIS_Z, 5.5, -21, -8) },
    { name: "motor-ribs", lines: G.ribsOf(axis, -19, -10, 5.5, 8, P, { seams: true }) },
    { name: "volute-foot", solid: s.box(-4, -8, 2.5, 4, 8, AXIS_Z - R + 2) },
    { name: "volute", solid: s.xcyl(0, AXIS_Z, R, -4, 4) },
    { name: "outlet", solid: s.box(-4, 2, AXIS_Z, 4, R, AXIS_Z + R + 4) },
    { name: "outlet-flange", solid: s.box(-5, 1, AXIS_Z + R + 4, 5, R + 1, AXIS_Z + R + 6) },
    { name: "inlet-ring", lines: s.circle([4, 0, AXIS_Z], [1, 0, 0], 7.5) },
    { name: "inlet", solid: s.xcyl(0, AXIS_Z, 4.5, 4, 9) },
    { name: "inlet-flange", solid: s.xcyl(0, AXIS_Z, 6, 9, 10.5) },
  ];
}
