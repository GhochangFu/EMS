// Air handling unit: a long casing in three sections (filter, coil, fan) split by section seams;
// on the front face an access door with handle and hinges per section, the filter pressure gauge
// and the two coil pipe connections; the fan inlet ring with its blades on the end face; the
// supply duct collar with its flange on top; and the base frame.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Air handling unit (isometric)";
const X = 24;
const Y = 10;
const Z0 = 2.5;
const H = 22;
export const extent = boxExtent(-X - 1, -Y - 1, 0, X + 1, Y + 5, H + 7);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const on = (x, z) => [x, Y, z];
  const seam = (x) => s.poly([on(x, Z0), on(x, H)]);
  const door = (x0, x1) => s.poly([on(x0, Z0 + 3), on(x0, H - 3), on(x1, H - 3), on(x1, Z0 + 3)], true);
  const handle = (x) => s.poly([on(x, 10), on(x, 14)]);
  const hinges = (x) => s.poly([on(x, H - 6), on(x - 1.5, H - 6)]) + s.poly([on(x, Z0 + 6), on(x - 1.5, Z0 + 6)]);
  const centre = [X, 0, (Z0 + H) / 2];
  const fronts = [
    seam(-8), seam(8),
    door(-X + 3, -11), handle(-13), hinges(-X + 3),
    door(-5, 1), handle(-0.5), hinges(-5),
    door(11, X - 3), handle(X - 5), hinges(11),
  ].join("");
  return [
    { name: "base", solid: s.box(-X - 1, -Y - 1, 0, X + 1, Y + 1, Z0) },
    { name: "casing", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "fronts", lines: fronts },
    { name: "gauge", solid: s.ycyl(-17.5, H - 1.5, 1.5, Y, Y + 1) },
    { name: "coil-supply", solid: s.ycyl(4.5, 7, 1.4, Y, Y + 4) },
    { name: "coil-return", solid: s.ycyl(4.5, 15, 1.4, Y, Y + 4) },
    { name: "fan-inlet", lines: s.circle(centre, [1, 0, 0], 6.5) + s.spokes(centre, [1, 0, 0], 1.5, 6, 5) },
    { name: "duct-collar", solid: s.box(12, -6, H, 21, 6, H + 5) },
    { name: "duct-flange", solid: s.box(11, -7, H + 5, 22, 7, H + 6.5) },
  ];
}
