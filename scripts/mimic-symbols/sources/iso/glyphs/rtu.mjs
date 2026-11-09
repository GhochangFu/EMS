// RTU / controller panel (PHE "RTU health"): a wall-mount enclosure on a pole bracket with its
// door, handle, status window and three LEDs, the side vent louvres, the antenna on top and cable glands below.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "RTU panel (isometric)";
const X = 12;
const Y = 6;
const Z0 = 6;
const H = 34;
export const extent = boxExtent(-X - 1, -Y - 3, 0, X + 1, Y, H + 12);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const door = [[-X + 2.5, Y, Z0 + 2.5], [-X + 2.5, Y, H - 2.5], [X - 2.5, Y, H - 2.5], [X - 2.5, Y, Z0 + 2.5]];
  const window = [[-6, Y, H - 6], [3, Y, H - 6], [3, Y, H - 12], [-6, Y, H - 12]];
  const handle = s.poly([[X - 5, Y, 15], [X - 5, Y, 21]]);
  const leds = [-5, -2, 1].map((x) => s.circle([x, Y, H - 15], [0, 1, 0], 0.8)).join("");
  const louvres = [12, 14.5, 17, 19.5].map((z) => s.poly([[X, Y - 2, z], [X, -Y + 2, z]])).join("");
  return [
    { name: "back-plate", solid: s.box(-X - 1, -Y - 3, 0, X + 1, -Y, H + 2) },
    ...[-6, 0, 6].map((x) => ({ name: `gland-${x}`, solid: s.vcyl(x, 0, 1.6, Z0 - 4, Z0, 16) })),
    { name: "enclosure", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "front", lines: s.poly(door, true) + s.poly(window, true) + handle + leds },
    { name: "louvres", lines: louvres },
    { name: "antenna-base", solid: s.vcyl(6, 0, 2, H, H + 2, 20) },
    { name: "antenna", solid: s.vcyl(6, 0, 0.9, H + 2, H + 12, 12) },
  ];
}
