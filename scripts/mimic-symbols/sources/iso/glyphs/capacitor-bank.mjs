// Capacitor bank (power-factor correction): the panel on a plinth with its door, vent louvres and
// PF controller on the front, and the rack of six cylindrical capacitor cans on top beside the
// busbar.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Capacitor bank (isometric)";
const X = 16;
const Y = 8;
const Z0 = 2.5;
const H = 22;
export const extent = boxExtent(-X - 1, -Y - 1, 0, X + 1, Y + 1, H + 12);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const on = (x, z) => [x, Y, z];
  const door = s.poly([on(-X + 2, Z0 + 2), on(-X + 2, H - 2), on(X - 2, H - 2), on(X - 2, Z0 + 2)], true);
  const louvres = [Z0 + 4, Z0 + 6, Z0 + 8].map((z) => s.poly([on(-X + 5, z), on(-X + 13, z)])).join("");
  const controller = s.poly([on(4, H - 5), on(11, H - 5), on(11, H - 10), on(4, H - 10)], true) + s.circle(on(7.5, H - 7.5), [0, 1, 0], 1.4);
  const cans = [];
  for (const y of [-3.5, 3.5]) for (const x of [-10, -3, 4]) cans.push({ name: `can-${x}-${y}`, solid: s.vcyl(x, y, 2.6, H, H + 9, 24) }, { name: `can-cap-${x}-${y}`, solid: s.vcyl(x, y, 1, H + 9, H + 11, 12) });
  return [
    { name: "plinth", solid: s.box(-X - 1, -Y - 1, 0, X + 1, Y + 1, Z0) },
    { name: "panel", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "front", lines: door + louvres + controller },
    { name: "busbar", solid: s.box(9.5, -6, H, 13, 6, H + 7) },
    ...cans,
  ];
}
