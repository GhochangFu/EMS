// Lift (elevator): the shaft enclosure with the machine room on top; on the front face the
// landing door (frame, inner frame, two leaves), the floor indicator above it and the call-button
// plate with its two buttons beside it.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Lift (isometric)";
const X = 13;
const Y = 12;
const H = 40;
export const extent = boxExtent(-X, -Y, 0, X, Y, H + 9);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const frame = [[X, 7, 0], [X, 7, 25], [X, -7, 25], [X, -7, 0]];
  const leaves = s.poly([[X, 0, 0], [X, 0, 25]]);
  const indicator = [[X, 4, 31], [X, -4, 31], [X, -4, 35], [X, 4, 35]];
  const buttons = [[X, -9, 10], [X, -9, 17], [X, -11, 17], [X, -11, 10]];
  const inner = s.poly([[X, 5, 0], [X, 5, 23], [X, -5, 23], [X, -5, 0]]);
  return [
    { name: "shaft", solid: s.box(-X, -Y, 0, X, Y, H) },
    { name: "front", lines: s.poly(frame) + inner + leaves + s.poly(indicator, true) + s.poly(buttons, true) },
    { name: "buttons", lines: s.circle([X, -10, 15], [1, 0, 0], 0.7) + s.circle([X, -10, 12], [1, 0, 0], 0.7) },
    { name: "machine-room", solid: s.box(-X + 2, -Y + 2, H, X - 6, Y - 2, H + 9) },
    { name: "vent", lines: s.poly([[X - 6, 6, H + 5], [X - 6, -6, H + 5]]) },
  ];
}
