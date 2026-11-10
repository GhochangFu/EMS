// Cold room (walk-in chiller room): an insulated panel room with its panel joints, a hinged door
// with its handle and a strip curtain behind it, and a small unit cooler on the roof edge.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Cold room (isometric)";
const X = 16;
const Y = 16;
const H = 28;
export const extent = boxExtent(-X, -Y, 0, X, Y, H + 6);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  // Panel joints on the +x face and the +y face.
  const joints = [-8, 0, 8].map((v) => s.poly([[X, v, 0], [X, v, H]]) + s.poly([[v, Y, 0], [v, Y, H]])).join("");
  // The door on the +y face, between the joints at x = -8 and x = 8, ajar on its hinge.
  const frame = s.poly([[-6.5, Y, 0], [-6.5, Y, 21], [6.5, Y, 21], [6.5, Y, 0]]);
  const strips = [-4.5, -2.25, 0, 2.25, 4.5].map((x) => s.poly([[x, Y, 2], [x, Y, 19.5]])).join("");
  return [
    { name: "room", solid: s.box(-X, -Y, 0, X, Y, H) },
    { name: "joints", lines: joints },
    { name: "frame", lines: frame + strips },
    { name: "door", solid: s.flat([[-6.5, Y, 0.5], [-6.5, Y, 20.5], [0, Y + 11.3, 20.5], [0, Y + 11.3, 0.5]]) },
    { name: "handle", solid: s.box(-1.2, Y + 9.2, 8, 0.2, Y + 10.2, 13) },
    { name: "cooler", solid: s.xcyl(-6, H + 3, 3, -X + 3, X - 6) },
  ];
}
