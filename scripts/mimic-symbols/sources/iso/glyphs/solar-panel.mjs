// Solar PV array: a tilted panel (cell grid on the face, the frame edge below it) on a frame of
// two front posts and two back posts over two ground rails, and the junction box under the panel.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Solar PV array (isometric)";
const X = 18;
const Y = 11;
const LOW = 6;
const HIGH = 20;
const COLS = 6;
const ROWS = 3;
export const extent = boxExtent(-X, -Y, 0, X, Y, HIGH + 1);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  // The panel plane: front edge at y = +Y (low), back edge at y = −Y (high).
  const at = (x, t) => [x, Y - 2 * Y * t, LOW + (HIGH - LOW) * t];
  const face = [at(-X, 0), at(X, 0), at(X, 1), at(-X, 1)];
  const grid = [];
  for (let c = 1; c < COLS; c += 1) {
    const x = -X + (2 * X * c) / COLS;
    grid.push(s.poly([at(x, 0), at(x, 1)]));
  }
  for (let r = 1; r < ROWS; r += 1) grid.push(s.poly([at(-X, r / ROWS), at(X, r / ROWS)]));
  const edge = s.poly([[-X, Y, LOW - 1.2], [X, Y, LOW - 1.2], [X, Y, LOW]]);
  const post = (x, y, top) => ({ name: `post-${x}-${y}`, solid: s.box(x - 0.8, y - 0.8, 0, x + 0.8, y + 0.8, top) });
  return [
    { name: "rail-left", solid: s.box(-X + 3, -Y, 0, -X + 5, Y, 1.5) },
    { name: "rail-right", solid: s.box(X - 5, -Y, 0, X - 3, Y, 1.5) },
    post(-X + 4, -Y + 3, HIGH - 2),
    post(X - 4, -Y + 3, HIGH - 2),
    { name: "junction-box", solid: s.box(-3, -4, 9, 3, 0, 12) },
    post(-X + 4, Y - 2, LOW - 1),
    post(X - 4, Y - 2, LOW - 1),
    { name: "panel", solid: s.flat(face) },
    { name: "cells", lines: grid.join("") },
    { name: "edge", lines: edge },
  ];
}
