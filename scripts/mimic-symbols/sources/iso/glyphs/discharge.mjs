// Discharge outfall: the outlet pipe (with a flanged joint) through a headwall, two wing walls,
// a concrete apron with two energy-dissipator blocks, and a flap gate on the outlet.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Discharge outfall (isometric)";
const PIPE_Z = 8;
export const extent = boxExtent(-28, -15, 0, 28, 15, 18);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  return [
    { name: "pipe-in", solid: s.xcyl(0, PIPE_Z, 4.5, -28, -4) },
    { name: "joint", solid: s.xcyl(0, PIPE_Z, 6.5, -17, -15) },
    { name: "wing-back", solid: s.box(1, -15, 0, 13, -12, 10) },
    { name: "headwall", solid: s.box(-4, -15, 0, 1, 15, 18) },
    { name: "apron", solid: s.box(1, -12, 0, 28, 12, 2.5) },
    { name: "pipe-out", solid: s.xcyl(0, PIPE_Z, 4.5, 1, 6) },
    { name: "flap-gate", solid: s.box(6, -6.5, 1.5, 8, 6.5, 14.5) },
    { name: "block-a", solid: s.box(16, -8, 2.5, 20, -3, 6) },
    { name: "block-b", solid: s.box(16, 3, 2.5, 20, 8, 6) },
    { name: "wing-front", solid: s.box(1, 12, 0, 13, 15, 10) },
  ];
}
