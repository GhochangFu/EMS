// Battery string: two monobloc batteries side by side, each with its lid seam, the − and + marks,
// two terminal posts and a vent cap, joined by an inter-cell link.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Battery string (isometric)";
const W = 12;
const GAP = 1.5;
const Y = 8;
const H = 17;
export const extent = boxExtent(-W * 2 - GAP, -Y, 0, W * 2 + GAP, Y, H + 5);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const block = (x0, label) => {
    const x1 = x0 + W * 2;
    const cx = (x0 + x1) / 2;
    return [
      { name: `case-${label}`, solid: s.box(x0, -Y, 0, x1, Y, H) },
      { name: `seam-${label}`, lines: s.poly([[x0, Y, H - 4], [x1, Y, H - 4], [x1, -Y, H - 4]]) },
      { name: `marks-${label}`, lines: s.poly([[x0 + 4, 3, H], [x0 + 7, 3, H]]) + s.poly([[x1 - 7, 3, H], [x1 - 4, 3, H]]) + s.poly([[x1 - 5.5, 1.5, H], [x1 - 5.5, 4.5, H]]) },
      { name: `post-a-${label}`, solid: s.vcyl(x0 + 5, -2, 2, H, H + 4, 20) },
      { name: `vent-${label}`, solid: s.vcyl(cx, 2, 1.8, H, H + 2, 16) },
      { name: `post-b-${label}`, solid: s.vcyl(x1 - 5, -2, 2, H, H + 4, 20) },
    ];
  };
  return [
    ...block(-W * 2 - GAP, "a"),
    ...block(GAP, "b"),
    { name: "link", solid: s.box(-6.5 - GAP, -3.2, H + 3, 6.5 + GAP, -0.8, H + 4.5) },
  ];
}
