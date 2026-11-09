// Y-strainer in a pipe run: pipe stubs, flanges, the body, the angled screen leg with its cap and
// drain plug.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Y-strainer (isometric)";
const R = 4.5;
export const extent = boxExtent(-24, -10, -20, 24, 10, 9);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const legAxis = [Math.SQRT1_2, 0, -Math.SQRT1_2];
  const leg = G.frameAlong([-2, 0, 0], legAxis);
  return [
    { name: "stub-left", solid: s.xcyl(0, 0, R, -24, -12) },
    { name: "flange-left", solid: s.xcyl(0, 0, 8.5, -12, -9.5) },
    { name: "body", solid: s.xcyl(0, 0, 6.5, -9.5, 9.5) },
    { name: "leg", solid: G.disc(2, 14, 5, leg, P, { steps: 40 }) },
    { name: "leg-seam", lines: G.arcOf(leg, 9, 5, P) },
    { name: "cap", solid: G.disc(14, 16.5, 6.5, leg, P, { steps: 40 }) },
    { name: "drain", solid: G.disc(16.5, 19, 1.6, leg, P, { steps: 16 }) },
    { name: "flange-right", solid: s.xcyl(0, 0, 8.5, 9.5, 12) },
    { name: "stub-right", solid: s.xcyl(0, 0, R, 12, 24) },
  ];
}
