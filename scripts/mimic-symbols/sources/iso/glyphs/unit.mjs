// Generic package unit: a cabinet on a plinth; on the front face two doors with handles and the
// control display; on the side a louvred vent and two flanged pipe connections; on the roof a fan
// ring with its guard and blades, and the lifting lugs.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Package unit (isometric)";
const X = 18;
const Y = 12;
const Z0 = 3;
const H = 28;
export const extent = boxExtent(-X - 1, -Y - 1, 0, X + 6.5, Y + 1, H + 3);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const front = (x, z) => [x, Y, z];
  const side = (y, z) => [X, y, z];
  const door = (x0, x1) => s.poly([front(x0, Z0 + 3), front(x0, H - 4), front(x1, H - 4), front(x1, Z0 + 3)], true);
  const handle = (x) => s.poly([front(x, 13), front(x, 18)]);
  const display = s.poly([front(-X + 7, H - 8), front(-X + 13, H - 8), front(-X + 13, H - 12), front(-X + 7, H - 12)], true);
  const vent = s.poly([side(3, H - 5), side(-Y + 4, H - 5), side(-Y + 4, H - 15), side(3, H - 15)], true);
  const louvres = [H - 7, H - 9, H - 11, H - 13].map((z) => s.poly([side(2, z), side(-Y + 5, z)])).join("");
  const fanCentre = [-6, -2, H + 2.5];
  const pipe = (z) => [
    { name: `pipe-${z}`, solid: s.xcyl(7, z, 1.8, X, X + 5) },
    { name: `pipe-flange-${z}`, solid: s.xcyl(7, z, 2.8, X + 5, X + 6.5) },
  ];
  return [
    { name: "plinth", solid: s.box(-X - 1, -Y - 1, 0, X + 1, Y + 1, Z0) },
    { name: "cabinet", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "doors", lines: door(-X + 4, -2) + door(2, X - 4) + handle(-4) + handle(4) + display },
    { name: "vent", lines: vent + louvres },
    ...pipe(8),
    ...pipe(14),
    { name: "fan", solid: s.vcyl(-6, -2, 6, H, H + 2.5, 40) },
    { name: "fan-guard", lines: s.circle(fanCentre, [0, 0, 1], 3.5) + G.spokesOf(G.frameAlong(fanCentre, [0, 0, 1]), 0, 1, 5.2, 4, P, { phase: Math.PI / 4 }) },
    ...[[-X + 2, Y - 2], [X - 2, Y - 2], [X - 2, -Y + 2]].map(([x, y]) => ({ name: `lug-${x}-${y}`, solid: s.vcyl(x, y, 1, H, H + 1.5, 12) })),
  ];
}
