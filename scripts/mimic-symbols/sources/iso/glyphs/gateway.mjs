// Network gateway / GSM modem (PHE "GSM network"): a flat case on four feet, two antennas with
// rounded tips on its back edge, and on the front face four port lights and an Ethernet port slot.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Network gateway (isometric)";
const X = 9;
const Y = 15;
const Z0 = 2;
const H = 11;
const MAST = 16;
export const extent = boxExtent(-X, -Y, 0, X, Y, H + MAST + 2);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const lights = [-10, -6.5, -3, 0.5].map((y) => s.circle([X, y, H - 3.5], [1, 0, 0], 1)).join("");
  const port = s.poly([[X, 5, Z0 + 2.5], [X, 11, Z0 + 2.5], [X, 11, Z0 + 6], [X, 5, Z0 + 6]], true);
  const seam = s.poly([[X, -Y + 1.5, Z0 + 1.5], [X, Y - 1.5, Z0 + 1.5]]);
  const antenna = (y) => [
    { name: `antenna-base-${y}`, solid: s.vcyl(-X + 3, y, 1.8, H, H + 2, 20) },
    { name: `antenna-${y}`, solid: s.vcyl(-X + 3, y, 1, H + 2, H + MAST - 2, 12) },
    { name: `antenna-tip-${y}`, solid: s.turned([-X + 3, y, H + MAST - 2], [0, 0, 1], [[0, 1], [2, 1.3], [3.5, 0.6]]) },
  ];
  return [
    ...antenna(-Y + 4),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => ({
      name: `foot-${sx}-${sy}`,
      solid: s.box(sx * (X - 2.5) - 1.5, sy * (Y - 3) - 1.5, 0, sx * (X - 2.5) + 1.5, sy * (Y - 3) + 1.5, Z0),
    })),
    { name: "case", solid: s.box(-X, -Y, Z0, X, Y, H) },
    { name: "front", lines: lights + port + seam },
    ...antenna(Y - 4),
  ];
}
