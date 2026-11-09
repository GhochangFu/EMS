// Condensing unit / heat-pump outdoor unit (split AC, VRF): the casing on two feet, the fan grille
// (ring, hub and four guard bars) on the front face, the coil fins on the side, the service panel,
// and the two service valves.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Condensing unit (isometric)";
const X = 9;
const Y = 18;
const Z0 = 3;
const H = 30;
export const extent = boxExtent(-X, -Y, 0, X + 4, Y, H);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const centre = [X, -3, (Z0 + H) / 2];
  const fins = [];
  for (let x = -X + 2; x < X - 1; x += 2) fins.push(s.poly([[x, Y, Z0 + 3], [x, Y, H - 3]]));
  const panel = s.poly([[X, Y - 2, H - 4], [X, Y - 9, H - 4], [X, Y - 9, Z0 + 4], [X, Y - 2, Z0 + 4]], true);
  return [
    { name: "foot-back", solid: s.box(-X + 1, -Y + 2, 0, X - 1, -Y + 5, Z0) },
    { name: "foot-front", solid: s.box(-X + 1, Y - 5, 0, X - 1, Y - 2, Z0) },
    { name: "casing", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "fins", lines: fins.join("") },
    { name: "panel", lines: panel },
    { name: "grille", lines: s.circle(centre, [1, 0, 0], 11) + s.circle(centre, [1, 0, 0], 7) + s.spokes(centre, [1, 0, 0], 2.2, 11, 4, Math.PI / 4) },
    { name: "hub", solid: s.xcyl(-3, (Z0 + H) / 2, 2.2, X, X + 1.5) },
    { name: "valve-a", solid: s.xcyl(Y - 5.5, Z0 + 6, 1.2, X, X + 4) },
    { name: "valve-b", solid: s.xcyl(Y - 5.5, Z0 + 10, 1.2, X, X + 4) },
  ];
}
