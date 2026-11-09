// UPS with its battery cabinet: the UPS tower with the display, the keypad, the status lamp, the
// air grille and the door handle on its front face; the battery cabinet beside it with its battery
// shelves and the vent; both on a plinth.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "UPS (isometric)";
const X = 9;
const Y = 10;
const Z0 = 2;
const H = 36;
const BACK = -Y - 18;
export const extent = boxExtent(-X - 1, BACK - 1, 0, X + 1.5, Y + 1, H);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const on = (y, z) => [X, y, z];
  const lines = [];
  lines.push(s.poly([on(Y - 4, H - 5), on(-Y + 4, H - 5), on(-Y + 4, H - 11), on(Y - 4, H - 11)], true));
  for (const y of [3, 0, -3]) lines.push(s.poly([on(y + 1, H - 14), on(y - 1, H - 14)]));
  for (const z of [6, 8.5, 11, 13.5]) lines.push(s.poly([on(Y - 3, z), on(-Y + 3, z)]));
  lines.push(s.poly([on(-Y + 1.5, 18), on(-Y + 1.5, 24)]));
  const shelves = [];
  for (const z of [10, 18, 26]) {
    shelves.push(s.poly([on(-Y - 3, z), on(BACK + 3, z)]));
    for (let y = -Y - 4.5; y > BACK + 3; y -= 4) shelves.push(s.poly([on(y, z - 5), on(y - 2.5, z - 5), on(y - 2.5, z - 1), on(y, z - 1)], true));
  }
  shelves.push(s.poly([on(-Y - 5, H - 7), on(BACK + 5, H - 7)]));
  return [
    { name: "plinth", solid: s.box(-X - 1, BACK - 1, 0, X + 1, Y + 1, Z0) },
    { name: "battery-cabinet", solid: s.box(-X, BACK, Z0, X, -Y - 1, H - 4) },
    { name: "shelves", lines: shelves.join("") },
    { name: "ups-cabinet", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "front", lines: lines.join("") },
    { name: "status-lamp", solid: s.xcyl(5.5, H - 14, 1.1, X, X + 1.2) },
  ];
}
