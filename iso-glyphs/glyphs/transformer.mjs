// Oil-filled distribution transformer on base rails: the tank with its rating plate, the cover,
// three HV bushings with caps, three LV bushings, the conservator on its bracket at the back end
// with the Buchholz pipe, and a radiator
// bank with fins on the front side.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Transformer (isometric)";
const X = 14;
const Y = 9;
const Z0 = 3;
const H = 25;
export const extent = boxExtent(-X - 1, -Y - 1, 0, X + 1, Y + 7, H + 14);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const fins = [-8, -5, -2, 1, 4, 7].map((x) => s.poly([[x + 0.5, Y + 6, Z0 + 5], [x + 0.5, Y + 6, H - 5]])).join("");
  const plate = s.poly([[X, -4, Z0 + 6], [X, -9 + 2, Z0 + 6], [X, -9 + 2, Z0 + 11], [X, -4, Z0 + 11]], true);
  return [
    { name: "rail-back", solid: s.box(-X, -Y + 1, 0, X, -Y + 4, Z0) },
    { name: "rail-front", solid: s.box(-X, Y - 4, 0, X, Y - 1, Z0) },
    { name: "tank", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "cover", solid: s.box(-X - 1, -Y - 1, H, X + 1, Y + 1, H + 2) },
    { name: "bracket", solid: s.box(-13, -7.5, H + 2, -10, -4.5, H + 9) },
    { name: "conservator", solid: s.xcyl(-6, H + 12.5, 3.5, -15, -3) },
    { name: "pipe", solid: s.box(-4, -7, H + 2, -2, -5.5, H + 10) },
    ...[-1, 6, 13].map((x) => ({ name: `hv-bushing-${x}`, solid: s.vcyl(x - 2, 1, 1.8, H + 2, H + 9, 20) })),
    ...[-1, 6, 13].map((x) => ({ name: `hv-cap-${x}`, solid: s.vcyl(x - 2, 1, 1.1, H + 9, H + 10.5, 16) })),
    ...[0, 5, 10].map((x) => ({ name: `lv-bushing-${x}`, solid: s.vcyl(x - 1, 6.5, 1.3, H + 2, H + 6, 16) })),
    { name: "rating-plate", lines: plate },
    { name: "radiator", solid: s.box(-11, Y, Z0 + 3, 11, Y + 6, H - 3) },
    { name: "fins", lines: fins },
  ];
}
