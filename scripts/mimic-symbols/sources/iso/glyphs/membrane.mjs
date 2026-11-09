// Membrane (RO / UF) skid: two pressure tubes, one above the other, with end caps, on two
// stands and a base frame; the front header with its stubs and a pressure gauge, and the
// control panel at the back.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Membrane skid (isometric)";
const LOW = 9;
const HIGH = 22;
const R = 4;
const HEADER_X = 27;
export const extent = boxExtent(-30, -8, 0, 30, 8, HIGH + 10);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const axis = (z) => G.frameAlong([0, 0, z], [1, 0, 0]);
  const tube = (z) => [
    { name: `tube-${z}`, solid: s.xcyl(0, z, R, -20, 20) },
    { name: `clamps-${z}`, lines: [-6, 6].map((x) => G.arcOf(axis(z), x, R, P)).join("") },
    { name: `cap-${z}`, solid: s.xcyl(0, z, R + 1.5, 20, 23) },
    { name: `stub-${z}`, solid: s.xcyl(0, z, 1.6, 23, HEADER_X) },
  ];
  return [
    { name: "base", solid: s.box(-30, -8, 0, 30, 8, 2.5) },
    { name: "panel", solid: s.box(-29, -6, 2.5, -24, 6, HIGH + 2) },
    { name: "panel-door", lines: s.poly([[-26.5, 6, 6], [-26.5, 6, HIGH - 1]]) + s.poly([[-24, 4, HIGH - 3], [-24, -4, HIGH - 3], [-24, -4, HIGH - 7], [-24, 4, HIGH - 7]], true) },
    { name: "stand-back", solid: s.box(-15, -2, 2.5, -11, 2, HIGH) },
    { name: "back-cap-low", solid: s.xcyl(0, LOW, R + 1.5, -23, -20) },
    { name: "back-cap-high", solid: s.xcyl(0, HIGH, R + 1.5, -23, -20) },
    ...tube(LOW),
    ...tube(HIGH),
    { name: "stand-front", solid: s.box(11, -2, 2.5, 15, 2, HIGH) },
    { name: "header", solid: s.vcyl(HEADER_X, 0, 2.2, 2.5, HIGH + 4, 20) },
    { name: "gauge", solid: s.ycyl(HEADER_X, HIGH + 7, 3, -1, 1) },
  ];
}
