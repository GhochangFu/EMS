// Pressure filter: a vertical shell with dished heads on three legs, a top manway, the air
// release pipe, the inlet and outlet nozzles toward the viewer joined by the face pipe with its
// backwash valve and handwheel.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Pressure filter (isometric)";
const R = 12;
const Z0 = 9;
const Z1 = 32;
const FACE = R + 7;
export const extent = boxExtent(-R, -R, 0, R + 10, R + 10, Z1 + 10);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const out = [Math.SQRT1_2, Math.SQRT1_2, 0];
  const at = (d) => [out[0] * d, out[1] * d];
  const nozzle = (z) => [
    { name: `nozzle-${z}`, solid: G.disc(R - 1, R + 4, 3, G.frameAlong([0, 0, z], out), P, { steps: 40 }) },
    { name: `flange-${z}`, solid: G.disc(R + 4, R + 5.5, 5, G.frameAlong([0, 0, z], out), P, { steps: 40 }) },
  ];
  const leg = (angle) => {
    const x = Math.cos(angle) * (R - 3);
    const y = Math.sin(angle) * (R - 3);
    return { name: `leg-${angle.toFixed(1)}`, solid: s.vcyl(x, y, 1.6, 0, Z0, 20) };
  };
  const [fx, fy] = at(FACE);
  const mid = (Z0 + Z1) / 2;
  return [
    leg(Math.PI * 1.25),
    { name: "bottom-head", solid: s.turned([0, 0, Z0], [0, 0, -1], [[0, R], [2.5, R - 3], [4, R - 7]]) },
    leg(Math.PI * 0.6),
    leg(Math.PI * 1.9),
    { name: "shell", solid: s.vcyl(0, 0, R, Z0, Z1, 64) },
    { name: "top-head", solid: s.turned([0, 0, Z1], [0, 0, 1], [[0, R], [3, R - 3], [5, R - 7], [6, 2]]) },
    { name: "manway", solid: s.vcyl(-3, -3, 4, Z1 + 3, Z1 + 7, 32) },
    { name: "air-release", solid: s.vcyl(4, 4, 1.3, Z1 + 3, Z1 + 9, 16) },
    ...nozzle(Z1 - 5),
    ...nozzle(Z0 + 5),
    { name: "face-pipe", solid: s.vcyl(fx, fy, 2.2, Z0 + 5, Z1 - 5, 20) },
    { name: "valve", solid: s.box(fx - 3, fy - 3, mid - 3, fx + 3, fy + 3, mid + 3) },
    { name: "handwheel", solid: G.disc(3, 4.5, 3.5, G.frameAlong([fx, fy, mid], out), P, { steps: 32 }) },
  ];
}
