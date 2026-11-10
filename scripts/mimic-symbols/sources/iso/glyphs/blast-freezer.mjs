// Blast freezer (WBLDC meat plants): a long insulated tunnel on a plinth, a 2 × 2 wall of
// evaporator fans (guard ring and blades) on its long face, the panel joints, and the door seam
// and handle on its end.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Blast freezer (isometric)";
const X = 22;
const Y = 10;
const Z0 = 2;
const H = 26;
export const extent = boxExtent(-X - 1, -Y - 1, 0, X + 1, Y + 1, H);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const fan = (x, z) => {
    const c = [x, Y, z];
    return s.circle(c, [0, 1, 0], 4.6) + s.spokes(c, [0, 1, 0], 1, 4.6, 4, Math.PI / 4) + s.circle(c, [0, 1, 0], 1);
  };
  const fans = [-5, 4.5].flatMap((x) => [Z0 + 6.5, Z0 + 16.5].map((z) => fan(x, z))).join("");
  const door = s.poly([[X, Y - 2.5, Z0], [X, Y - 2.5, H - 3], [X, -Y + 2.5, H - 3], [X, -Y + 2.5, Z0]]);
  const handle = s.poly([[X, Y - 5, Z0 + 8], [X, Y - 5, Z0 + 14]]);
  return [
    { name: "plinth", solid: s.box(-X - 1, -Y - 1, 0, X + 1, Y + 1, Z0) },
    { name: "tunnel", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "fans", lines: fans },
    { name: "joints", lines: [-16, 10, 16].map((x) => s.poly([[x, -Y, H], [x, Y, H], [x, Y, Z0]])).join("") },
    { name: "door", lines: door + handle },
  ];
}
