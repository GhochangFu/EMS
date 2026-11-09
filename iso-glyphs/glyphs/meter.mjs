// Energy meter (multifunction): a case with its display window, the round dial, the terminal
// cover seam and three cable glands below.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Energy meter (isometric)";
const X = 11;
const Y = 4;
const H = 30;
export const extent = boxExtent(-X, -Y, -4, X, Y + 2, H);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const display = [[-6.5, Y, H - 3], [6.5, Y, H - 3], [6.5, Y, H - 8], [-6.5, Y, H - 8]];
  return [
    ...[-6, 0, 6].map((x) => ({ name: `gland-${x}`, solid: s.vcyl(x, 0, 1.6, -4, 0, 16) })),
    { name: "case", solid: s.box(-X, -Y, 0, X, Y, H) },
    { name: "face", lines: s.poly(display, true) + s.poly([[-X, Y, 6], [X, Y, 6], [X, -Y, 6]]) },
    { name: "dial", solid: s.ycyl(0, 14.5, 5, Y, Y + 2) },
  ];
}
