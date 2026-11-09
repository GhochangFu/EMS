// Circular clarifier: a wide, low round tank with its weir launder line, the centre feed well, the drive on top, the bridge
// with its handrail from the rim to the centre, and the flanged outlet nozzle.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Clarifier (isometric)";
const R = 24;
const H = 8;
export const extent = boxExtent(-R, -R, 0, R + 6, R + 6, 22);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const out = G.frameAlong([0, 0, 3.5], [Math.SQRT1_2, Math.SQRT1_2, 0]);
  const rail = s.poly([[2.5, 4, 15], [2.5, R + 1, 15]]);
  const posts = [8, 16, R + 1].map((y) => s.poly([[2.5, y, 10.5], [2.5, y, 15]])).join("");
  return [
    { name: "basin", solid: s.vcyl(0, 0, R, 0, H, 72) },
    { name: "weir", lines: s.circle([0, 0, H], [0, 0, 1], R - 3) },
    { name: "outlet", solid: G.disc(R - 1, R + 4, 2.5, out, P, { steps: 32 }) },
    { name: "outlet-flange", solid: G.disc(R + 4, R + 6, 4, out, P, { steps: 32 }) },
    { name: "feed-well", solid: s.vcyl(0, 0, 10, H, H + 3, 56) },
    { name: "bridge", solid: s.box(-2.5, 0, H + 1, 2.5, R + 1, H + 2.5) },
    { name: "drive", solid: s.vcyl(0, 0, 5, H + 3, H + 10, 40) },
    { name: "handrail", lines: rail + posts },
  ];
}
