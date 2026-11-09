// Equipment rack (19-inch): a cabinet on a plinth with the door frame, the equipment units
// with their status lights and the door handle on the front face, two roof fans and a cable tray on top.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Equipment rack (isometric)";
const X = 10;
const Y = 11;
const Z0 = 2.5;
const H = 42;
export const extent = boxExtent(-X - 1, -Y - 1, 0, X + 1, Y + 1, H + 4);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const frame = [[X, Y - 3, Z0 + 3], [X, Y - 3, H - 3], [X, -Y + 3, H - 3], [X, -Y + 3, Z0 + 3]];
  const bays = [];
  for (let z = Z0 + 6.5; z < H - 4; z += 3.5) bays.push(s.poly([[X, Y - 3, z], [X, -Y + 5.5, z]]));
  for (let z = Z0 + 8.25; z < H - 4; z += 7) bays.push(s.poly([[X, Y - 4.5, z], [X, Y - 5.5, z]]));
  const handle = s.poly([[X, -Y + 1.5, 18], [X, -Y + 1.5, 25]]);
  return [
    { name: "plinth", solid: s.box(-X - 1, -Y - 1, 0, X + 1, Y + 1, Z0) },
    { name: "cabinet", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "front", lines: s.poly(frame, true) + bays.join("") + handle },
    { name: "cable-tray", solid: s.box(-X + 1, -Y + 2, H, -X + 6, Y - 2, H + 4) },
    { name: "fan-a", lines: s.circle([3, -5, H], [0, 0, 1], 3.2) },
    { name: "fan-b", lines: s.circle([3, 5, H], [0, 0, 1], 3.2) },
  ];
}
