// Unit cooler (ceiling evaporator of a cold room): the ceiling bracket, two hanger rods, the flat
// casing with two fans (guard ring, blades and hub) on its face, the coil fins on its end, and the
// drip tray's lip below.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Unit cooler (isometric)";
const X = 8;
const Y = 20;
const Z0 = 4;
const H = 20;
const TOP = 28;
export const extent = boxExtent(-X - 1, -Y - 1, 0, X + 1, Y + 1, TOP + 2);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const fan = (y) => {
    const c = [X, y, (Z0 + H) / 2 + 0.5];
    return s.circle(c, [1, 0, 0], 6.5) + s.spokes(c, [1, 0, 0], 1.4, 6.5, 4, Math.PI / 4) + s.circle(c, [1, 0, 0], 1.4);
  };
  const fins = [];
  for (let x = -X + 2; x < X - 1; x += 2.5) fins.push(s.poly([[x, Y, Z0 + 4], [x, Y, H - 2]]));
  return [
    { name: "bracket", solid: s.box(-X + 1, -Y + 2, TOP, X - 1, Y - 2, TOP + 2) },
    ...[-Y + 6, Y - 6].map((y) => ({ name: `rod-${y}`, solid: s.vcyl(0, y, 0.8, H, TOP, 12) })),
    { name: "tray", solid: s.box(-X - 1, -Y - 1, Z0 - 1.5, X + 1, Y + 1, Z0) },
    { name: "casing", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "fans", lines: fan(-9) + fan(9) },
    { name: "fins", lines: fins.join("") },
  ];
}
