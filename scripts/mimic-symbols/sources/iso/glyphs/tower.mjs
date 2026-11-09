// Cooling tower (box, induced draft): the cold-water basin, the casing with louvre bands on both
// visible faces, the access door, the ladder up the side, the fan deck handrail, the fan stack
// with its blades and hub, the hot-water inlet pipe with its flange and the outlet.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Cooling tower (isometric)";
const W = 16;
const B = 4;
const H = 28;
export const extent = boxExtent(-W - 3, -W - 3, 0, W + 7, W + 3, H + 10);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  // The bands stop short of the door (front face) and the ladder (side face).
  const band = (z) => s.poly([[-W + 11, W, z], [W, W, z], [W, -W + 10, z]]);
  const louvres = [B + 3, B + 6, B + 9, B + 12, B + 15].map(band).join("");
  const door = s.poly([[-W + 3, W, B], [-W + 3, W, B + 9], [-W + 9, W, B + 9], [-W + 9, W, B]]);
  const rungs = [];
  for (let z = B + 2; z < H; z += 3) rungs.push(s.poly([[W, -W + 5, z], [W, -W + 8, z]]));
  const ladder = s.poly([[W, -W + 5, B], [W, -W + 5, H + 3]]) + s.poly([[W, -W + 8, B], [W, -W + 8, H + 3]]) + rungs.join("");
  const rail = s.poly([[-W, W, H + 3], [W, W, H + 3], [W, -W, H + 3]]);
  const posts = [-W, 0, W].map((t) => s.poly([[t, W, H], [t, W, H + 3]])).join("") + s.poly([[W, 0, H], [W, 0, H + 3]]);
  return [
    { name: "basin", solid: s.box(-W - 3, -W - 3, 0, W + 3, W + 3, B) },
    { name: "casing", solid: s.box(-W, -W, B, W, W, H) },
    { name: "louvres", lines: louvres },
    { name: "door", lines: door },
    { name: "ladder", lines: ladder },
    { name: "inlet", solid: s.xcyl(-8, H - 4, 2.5, W, W + 5) },
    { name: "inlet-flange", solid: s.xcyl(-8, H - 4, 4, W + 5, W + 7) },
    { name: "outlet", solid: s.xcyl(8, 2, 2, W + 3, W + 6) },
    { name: "fan-stack", solid: s.vcyl(0, 0, 10, H, H + 8, 56) },
    { name: "blades", lines: G.spokesOf(G.frameAlong([0, 0, H + 8], [0, 0, 1]), 0, 2.5, 9, 4, P, { phase: Math.PI / 8 }) },
    { name: "hub", solid: s.vcyl(0, 0, 2.2, H + 8, H + 9.5, 20) },
    { name: "handrail", lines: rail + posts },
  ];
}
