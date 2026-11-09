// Air-cooled chiller: a long casing on a base with the V-coil zigzag on the side, two condenser
// fan stacks with guards and blades on top, the control panel with its door and the two
// chilled-water nozzles with flanges at the end.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Chiller (isometric)";
const X = 24;
const Y = 10;
const Z0 = 2.5;
const H = 18;
export const extent = boxExtent(-X - 1, -Y - 1, 0, X + 8, Y + 1, H + 4);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const zig = [];
  for (let i = 0; i <= 8; i += 1) zig.push([-X + 4 + i * 5, Y, i % 2 ? Z0 + 3 : H - 3]);
  const fan = (x) => [
    { name: `fan-${x}`, solid: s.vcyl(x, 0, 7, H, H + 3, 40) },
    { name: `guard-${x}`, lines: s.circle([x, 0, H + 3], [0, 0, 1], 4.5) + G.spokesOf(G.frameAlong([x, 0, H + 3], [0, 0, 1]), 0, 1.2, 6, 4, P, { phase: Math.PI / 4 }) },
  ];
  const panelDoor = s.poly([[X + 2, -7, 7], [X + 2, -1, 7], [X + 2, -1, 14], [X + 2, -7, 14]], true);
  const nozzle = (z) => [
    { name: `nozzle-${z}`, solid: s.xcyl(4, z, 2, X, X + 5) },
    { name: `nozzle-flange-${z}`, solid: s.xcyl(4, z, 3, X + 5, X + 6.5) },
  ];
  return [
    { name: "base", solid: s.box(-X - 1, -Y - 1, 0, X + 1, Y + 1, Z0) },
    { name: "casing", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "coil", lines: s.poly(zig) },
    ...fan(-11),
    ...fan(11),
    { name: "panel", solid: s.box(X, -8, 6, X + 2, 0, 15) },
    { name: "panel-door", lines: panelDoor },
    ...nozzle(6.5),
    ...nozzle(13),
  ];
}
