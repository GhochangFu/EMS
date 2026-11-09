// Lighting pole: the foundation plinth, the base flange, the pole with its hand-hole door, the
// double arm and two luminaire heads.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Light fitting (isometric)";
const H = 40;
export const extent = boxExtent(-22, -6, 0, 22, 6, H + 2);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  return [
    { name: "plinth", solid: s.box(-6, -6, 0, 6, 6, 3) },
    { name: "flange", solid: s.vcyl(0, 0, 4, 3, 5, 32) },
    { name: "luminaire-back", solid: s.box(-22, -4, H - 4, -10, 4, H + 1) },
    { name: "arm-back", solid: s.box(-12, -1.2, H - 2, 0, 1.2, H) },
    { name: "pole", solid: s.vcyl(0, 0, 2, 5, H + 1, 20) },
    { name: "hand-hole", solid: s.box(1.5, -1.5, 8, 3, 1.5, 16) },
    { name: "arm-front", solid: s.box(0, -1.2, H - 2, 12, 1.2, H) },
    { name: "luminaire-front", solid: s.box(10, -4, H - 4, 22, 4, H + 1) },
  ];
}
