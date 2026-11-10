// Temperature probe (cold-room RTD / thermocouple): the round head with its cap and four scale
// ticks, the neck, the long stem with its tapered tip, and the cable gland on the side of the head.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Temperature probe (isometric)";
const HEAD_Z = 34;
export const extent = boxExtent(-8, -8, 0, 12, 8, HEAD_Z + 10);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const face = G.frameAlong([0, 0, HEAD_Z + 7], [0, 0, 1]);
  const ticks = G.spokesOf(face, 0, 3.4, 5.4, 4, P, { phase: Math.PI / 4 });
  return [
    { name: "tip", solid: s.turned([0, 0, 6], [0, 0, -1], [[0, 1.6], [3, 1.2], [5, 0.3]]) },
    { name: "stem", solid: s.vcyl(0, 0, 1.6, 6, HEAD_Z - 5, 16) },
    { name: "neck", solid: s.turned([0, 0, HEAD_Z - 5], [0, 0, 1], [[0, 2.6], [3, 2.6], [5, 4]]) },
    { name: "head", solid: s.vcyl(0, 0, 7, HEAD_Z, HEAD_Z + 5.5, 48) },
    { name: "gland", solid: s.xcyl(0, HEAD_Z + 2.7, 1.8, 6.5, 11) },
    { name: "cap", solid: s.turned([0, 0, HEAD_Z + 5.5], [0, 0, 1], [[0, 7], [1, 6.6], [1.5, 6]]) },
    { name: "ticks", lines: ticks },
  ];
}
