// Vertical pressure vessel on a skirt: the shell, a dished top head with a flanged top nozzle, a
// flanged inlet nozzle, a manway with its cover, and the skirt access opening.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Pressure vessel (isometric)";
const R = 12;
const Z0 = 8;
const Z1 = 36;
export const extent = boxExtent(-R, -R, 0, R + 8, R + 8, Z1 + 13);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const along = (axis, z, from, to, r) => G.disc(from, to, r, G.frameAlong([0, 0, z], axis), P, { steps: 40 });
  const opening = s.poly([[-3, R - 1.6, 0], [-3, R - 1.6, 5], [3, R - 1.6, 5], [3, R - 1.6, 0]]);
  return [
    { name: "skirt", solid: s.vcyl(0, 0, R - 1.5, 0, Z0 + 1, 56) },
    { name: "skirt-opening", lines: opening },
    { name: "shell", solid: s.vcyl(0, 0, R, Z0, Z1, 64) },
    { name: "seams", lines: [Z0 + 9.5, Z0 + 19].map((z) => G.arcOf(G.frameAlong([0, 0, 0], [0, 0, 1]), z, R, P)).join("") },
    { name: "nameplate", lines: s.poly([[R * 0.6, -R * 0.8, Z1 - 4], [R * 0.6, -R * 0.8, Z1 - 9], [R * 0.85, -R * 0.53, Z1 - 9], [R * 0.85, -R * 0.53, Z1 - 4]], true) },
    { name: "head", solid: s.turned([0, 0, Z1], [0, 0, 1], [[0, R], [3, R - 2.5], [5, R - 6], [6, 3]]) },
    { name: "top-nozzle", solid: s.vcyl(0, 0, 2.5, Z1 + 5.5, Z1 + 10) },
    { name: "top-flange", solid: s.vcyl(0, 0, 4.5, Z1 + 10, Z1 + 12) },
    { name: "inlet", solid: along([1, 0, 0], Z1 - 6, R - 1, R + 5, 3) },
    { name: "inlet-flange", solid: along([1, 0, 0], Z1 - 6, R + 5, R + 7, 5) },
    { name: "manway", solid: along([0, 1, 0], Z0 + 9, R - 1, R + 3, 5) },
    { name: "manway-cover", solid: along([0, 1, 0], Z0 + 9, R + 3, R + 4.5, 6.5) },
  ];
}
