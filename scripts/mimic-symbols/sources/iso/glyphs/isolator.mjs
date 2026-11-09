// Isolator / switch-disconnector: the enclosure on its back plate with the rotary handle on a
// round boss, the ON/OFF arc marks, the padlock tab, and cable glands top and bottom.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Isolator (isometric)";
const X = 9;
const Y = 6;
const H = 24;
export const extent = boxExtent(-X - 3, -Y - 2, -4, X + 3, Y + 5, H + 4);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const centre = [0, Y, H / 2 + 1];
  const front = G.frameAlong(centre, [0, 1, 0]);
  const marks = G.arcOf(front, 0, 6.5, P, { from: Math.PI * 0.15, to: Math.PI * 0.85 });
  const glands = (z0, z1) => [-4, 4].map((x) => ({ name: `gland-${x}-${z0}`, solid: s.vcyl(x, 0, 1.6, z0, z1, 16) }));
  return [
    { name: "plate", solid: s.box(-X - 3, -Y - 2, -4, X + 3, -Y, H + 4) },
    ...glands(-3, 0),
    { name: "enclosure", solid: s.box(-X, -Y, 0, X, Y, H) },
    ...glands(H, H + 3),
    { name: "marks", lines: marks },
    { name: "boss", solid: s.ycyl(0, H / 2 + 1, 4.5, Y, Y + 1.5) },
    { name: "handle", solid: s.box(-1.4, Y + 1.5, H / 2 - 5, 1.4, Y + 4.5, H / 2 + 7) },
    { name: "lock-tab", solid: s.box(-1, Y, 2.5, 1, Y + 3, 5.5) },
  ];
}
