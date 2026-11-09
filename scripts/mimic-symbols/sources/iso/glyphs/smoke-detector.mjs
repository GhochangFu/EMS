// Smoke / leak detector (ESKOM environment sensors): a ceiling base plate, the detector body with
// its vent slots, the domed cap and the status LED.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Smoke detector (isometric)";
const R = 13;
export const extent = boxExtent(-R - 1, -R - 1, 0, R + 1, R + 1, 14);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const up = G.frameAlong([0, 0, 0], [0, 0, 1]);
  const slots = [];
  for (let a = -0.7; a <= 2.3; a += 0.375) {
    const x = Math.cos(a) * (R - 3);
    const y = Math.sin(a) * (R - 3);
    slots.push(s.poly([[x, y, 6], [x, y, 8.5]]));
  }
  return [
    { name: "base", solid: s.vcyl(0, 0, R + 1, 0, 2.5, 64) },
    { name: "body", solid: s.vcyl(0, 0, R - 3, 2.5, 9.5, 56) },
    { name: "slots", lines: slots.join("") },
    { name: "body-seam", lines: G.arcOf(up, 5, R - 3, P) },
    { name: "cap", solid: s.turned([0, 0, 9.5], [0, 0, 1], [[0, R - 3], [2, R - 5], [3.5, 6], [4, 3]]) },
    { name: "led", solid: s.vcyl(4, 3, 1, 12, 13.5, 12) },
  ];
}
