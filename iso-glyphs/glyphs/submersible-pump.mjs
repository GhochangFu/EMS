// Borehole submersible pump: the motor with its seams, the intake screen, the stacked pump stages,
// the discharge head and nipple, and the cable guard strip down the side.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Submersible pump (isometric)";
const R = 6;
export const extent = boxExtent(-R - 1, -R - 1, 0, R + 2, R + 2, 48);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const up = G.frameAlong([0, 0, 0], [0, 0, 1]);
  const seams = (zs) => zs.map((z) => G.arcOf(up, z, R, P)).join("");
  const screen = [];
  for (let a = -0.6; a <= 2.2; a += 0.45) {
    const x = Math.cos(a + Math.PI / 4 - 0.8) * R;
    const y = Math.sin(a + Math.PI / 4 - 0.8) * R;
    screen.push(s.poly([[x, y, 18.5], [x, y, 21.5]]));
  }
  return [
    { name: "motor", solid: s.vcyl(0, 0, R, 0, 18, 48) },
    { name: "motor-seams", lines: seams([4, 14]) },
    { name: "intake", solid: s.vcyl(0, 0, R - 0.5, 18, 22, 48) },
    { name: "screen", lines: screen.join("") },
    { name: "stages", solid: s.vcyl(0, 0, R, 22, 38, 48) },
    { name: "stage-seams", lines: seams([25.5, 29, 32.5, 36]) },
    { name: "head", solid: s.turned([0, 0, 38], [0, 0, 1], [[0, R], [3, R - 1.5], [5, 3.5]]) },
    { name: "nipple", solid: s.vcyl(0, 0, 2.5, 43, 46.5, 24) },
    { name: "nipple-ring", solid: s.vcyl(0, 0, 3.4, 46.5, 48, 24) },
    { name: "cable-guard", solid: s.box(R * 0.55, R * 0.55, 6, R * 0.55 + 2, R * 0.55 + 2, 38) },
  ];
}
