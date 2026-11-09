// Mechanical bar screen in an inlet channel: the channel floor and back wall, the inclined bar rack,
// the rake head frame with its drive motor and gearbox above the channel, the discharge chute, and
// the front channel wall.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Bar screen (isometric)";
const W = 10;
const WALL = 3;
const H = 14;
export const extent = boxExtent(-20, -W - WALL, 0, 20, W + WALL, 34);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const bars = [];
  for (let y = -W + 1.5; y < W - 1; y += 2.2) bars.push(s.poly([[-10, y, 2], [8, y, 30]]));
  const rails = [-W + 0.5, W - 0.5].map((y) => s.poly([[-11, y, 2], [7, y, 30]])).join("");
  const water = s.poly([[-20, W, 8], [-12, W, 8]]);
  return [
    { name: "floor", solid: s.box(-20, -W, 0, 20, W, 2) },
    { name: "wall-back", solid: s.box(-20, -W - WALL, 0, 20, -W, H) },
    { name: "rack", lines: bars.join("") + rails },
    { name: "head-frame", solid: s.box(4, -W - 1, 26, 12, W + 1, 30) },
    { name: "chute", solid: s.box(12, -5, 20, 17, 5, 27) },
    { name: "gearbox", solid: s.box(5, W + 1, 26, 10, W + 5, 31) },
    { name: "motor", solid: s.xcyl(W + 3, 33, 2.2, 3, 12) },
    { name: "wall-front", solid: s.box(-20, W, 0, 20, W + WALL, H) },
    { name: "water-line", lines: water },
  ];
}
