// EV charger (pedestal): the plinth, the charger body with its screen, status light strip and
// card reader on the front, the holstered connector, and the cable loop.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "EV charger (isometric)";
const X = 6;
const Y = 9;
const H = 38;
export const extent = boxExtent(-X - 2, -Y - 2, 0, X + 8, Y + 2, H);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const on = (y, z) => [X, y, z];
  const screen = s.poly([on(Y - 2.5, H - 5), on(-Y + 2.5, H - 5), on(-Y + 2.5, H - 13), on(Y - 2.5, H - 13)], true);
  const strip = s.poly([on(Y - 2.5, H - 16), on(-Y + 2.5, H - 16)]);
  const reader = s.poly([on(-Y + 2.5, H - 19), on(-Y + 7, H - 19), on(-Y + 7, H - 23), on(-Y + 2.5, H - 23)], true);
  const cable = s.poly([[X + 1, Y - 4, 17], [X + 5, Y - 4, 13], [X + 7, Y - 4, 7], [X + 6, Y - 4, 4], [X + 3, Y - 4, 4], [X + 1, Y - 4, 7]]);
  return [
    { name: "plinth", solid: s.box(-X - 2, -Y - 2, 0, X + 2, Y + 2, 3) },
    { name: "body", solid: s.box(-X, -Y, 3, X, Y, H) },
    { name: "front", lines: screen + strip + reader },
    { name: "holster", solid: s.box(X, Y - 6.5, 15, X + 2.5, Y - 1.5, 21) },
    { name: "connector", solid: s.xcyl(Y - 4, 18, 1.6, X + 2.5, X + 5) },
    { name: "cable", lines: cable },
  ];
}
