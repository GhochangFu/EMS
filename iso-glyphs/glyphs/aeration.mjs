// Aeration basin: an open rectangular basin (its inner wall on the top face) with the water line, a
// walkway bridge along it with handrails carrying two surface aerators, and the air header along
// the front wall with its drop pipes.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Aeration basin (isometric)";
const X = 26;
const Y = 15;
const H = 9;
const WALL = 3;
export const extent = boxExtent(-X, -Y, 0, X, Y, H + 10);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const inner = [[-X + WALL, -Y + WALL, H], [X - WALL, -Y + WALL, H], [X - WALL, Y - WALL, H], [-X + WALL, Y - WALL, H]];
  const aerator = (x) => [
    { name: `aerator-${x}`, solid: s.turned([x, 0, H - 1], [0, 0, 1], [[0, 6.5], [2, 6.5], [3.5, 3]]) },
    { name: `aerator-motor-${x}`, solid: s.vcyl(x, 0, 3, H + 3.5, H + 9) },
    { name: `aerator-cap-${x}`, solid: s.vcyl(x, 0, 1.8, H + 9, H + 10.5, 16) },
  ];
  const rail = (y) => s.poly([[-X, y, H + 5], [X, y, H + 5]]) + [-X, -18, 18, X].map((x) => s.poly([[x, y, H + 2], [x, y, H + 5]])).join("");
  const drops = [-20, -6, 6, 20].map((x) => s.poly([[x, Y - 1.5, H + 1.5], [x, Y - 1.5, H - 4]])).join("");
  return [
    { name: "basin", solid: s.box(-X, -Y, 0, X, Y, H) },
    { name: "inner-wall", lines: s.poly(inner, true) },
    { name: "rail-back", lines: rail(-2.5) },
    { name: "bridge", solid: s.box(-X, -2.5, H, X, 2.5, H + 2) },
    ...aerator(-11),
    ...aerator(11),
    { name: "rail-front", lines: rail(2.5) },
    { name: "air-header", solid: s.xcyl(Y - 1.5, H + 1.5, 1.2, -X + 2, X - 2) },
    { name: "air-drops", lines: drops },
  ];
}
