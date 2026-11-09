// Switchboard / MCC: three cubicles in one line-up on a plinth under a roof canopy, with a cable
// box on top. On the front face: the cubicle doors with hinges side and handles, the meter strip
// with two meters and a lamp row per cubicle, and the vent louvres at the bottom.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Switchboard (isometric)";
const X = 22;
const Y = 8;
const Z0 = 2.5;
const H = 34;
const STRIP = H - 8;
export const extent = boxExtent(-X - 1, -Y - 1, 0, X + 1, Y + 1.5, H + 7.5);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const third = (2 * X) / 3;
  const on = (x, z) => [x, Y, z];
  const centres = [-X + third / 2, 0, X - third / 2];
  const lines = [];
  for (const x of [-X / 3, X / 3]) lines.push(s.poly([on(x, Z0), on(x, H)]));
  lines.push(s.poly([on(-X, STRIP), on(X, STRIP)]));
  for (const cx of centres) {
    const x0 = cx - third / 2 + 1.5;
    const x1 = cx + third / 2 - 1.5;
    lines.push(s.poly([on(x0, Z0 + 2), on(x0, STRIP - 1.5), on(x1, STRIP - 1.5), on(x1, Z0 + 2)], true));
    lines.push(s.poly([on(x1 - 2, 13), on(x1 - 2, 18)]));
    for (const z of [Z0 + 4, Z0 + 6]) lines.push(s.poly([on(x0 + 2, z), on(x0 + 7, z)]));
    lines.push(s.circle(on(cx - 2.6, STRIP + 4), [0, 1, 0], 2));
    lines.push(s.circle(on(cx + 2.6, STRIP + 4), [0, 1, 0], 2));
  }
  return [
    { name: "plinth", solid: s.box(-X - 1, -Y - 1, 0, X + 1, Y + 1, Z0) },
    { name: "line-up", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "fronts", lines: lines.join("") },
    { name: "canopy", solid: s.box(-X - 1, -Y - 1, H, X + 1, Y + 1.5, H + 1.5) },
    { name: "cable-box", solid: s.box(-X + 3, -Y + 1, H + 1.5, -X + 13, Y - 3, H + 7.5) },
  ];
}
