// Deep freezer (walk-in, −20 °C and below): an insulated room with its panel joints, a thick
// sliding door standing proud of its face on a top rail, three frost stars on the door, the
// door's pull handle and a step at its foot.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Deep freezer (isometric)";
const X = 16;
const Y = 14;
const H = 28;
export const extent = boxExtent(-X, -Y, 0, X, Y + 6, H + 1);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const D0 = Y + 1; // the door's back face
  const D1 = Y + 3.5; // its front face
  const star = (x, z) => {
    const c = [x, D1, z];
    return s.spokes(c, [0, 1, 0], 0, 2.6, 6, Math.PI / 2);
  };
  const joints = [-8, 0, 8].map((v) => s.poly([[X, v, 0], [X, v, H]])).join("");
  return [
    { name: "room", solid: s.box(-X, -Y, 0, X, Y, H) },
    { name: "joints", lines: joints + s.poly([[-X + 2, Y, H - 2], [-X + 2, Y, 0]]) },
    { name: "rail", solid: s.box(-X + 1, Y, H - 4, X - 1, D0 + 0.5, H - 2) },
    { name: "step", solid: s.box(-12, Y, 0, 6, Y + 6, 1.5) },
    { name: "door", solid: s.box(-11, D0, 1.5, 5, D1, H - 4.5) },
    { name: "frost", lines: star(-6.5, 19) + star(0, 14) + star(-6.5, 9) },
    { name: "pull", solid: s.box(2, D1, 9, 3.2, D1 + 1, 17) },
  ];
}
