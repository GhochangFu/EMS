// Wind turbine: the foundation, the tapered tower with its door, the nacelle with its seam, the
// hub with its nose cone, and three tapered blades. The rotor faces the viewer (azimuth 45°), so
// the blades show at full length instead of edge-on.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Wind turbine (isometric)";
const HUB_Z = 36;
const BLADE = 22;
const OUT = [Math.SQRT1_2, Math.SQRT1_2, 0]; // the rotor axis, toward the viewer
const ACROSS = [-Math.SQRT1_2, Math.SQRT1_2, 0]; // in the rotor plane, horizontal
export const extent = boxExtent(-BLADE, -BLADE, 0, BLADE, BLADE, HUB_Z + BLADE);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const along = (d) => [OUT[0] * d, OUT[1] * d];
  const [hx, hy] = along(7);
  // A point in the rotor plane at radius r and angle a (0 = horizontal, π/2 = up).
  const inPlane = (r, a) => [hx + ACROSS[0] * Math.cos(a) * r, hy + ACROSS[1] * Math.cos(a) * r, HUB_Z + Math.sin(a) * r];
  const blade = (a) => ({
    name: `blade-${a.toFixed(2)}`,
    solid: s.flat([inPlane(2.5, a - 0.45), inPlane(8, a + 0.2), inPlane(BLADE, a + 0.02), inPlane(BLADE, a - 0.02), inPlane(7, a - 0.12)]),
  });
  const nacelleAxis = G.frameAlong([-along(6)[0], -along(6)[1], HUB_Z], OUT);
  return [
    { name: "foundation", solid: s.vcyl(0, 0, 6, 0, 2, 40) },
    { name: "tower", solid: s.turned([0, 0, 2], [0, 0, 1], [[0, 3.2], [HUB_Z - 5, 1.8]]) },
    { name: "door", lines: s.poly([[2.3, 2.3, 2], [2.3, 2.3, 7], [3.2, 0.6, 7], [3.2, 0.6, 2]]) },
    { name: "nacelle", solid: G.solidOf([[0, 2.2], [1.5, 3.4], [11, 3.4], [12, 3]], nacelleAxis, P) },
    { name: "nacelle-seam", lines: G.arcOf(nacelleAxis, 7, 3.4, P) },
    { name: "hub", solid: G.disc(6, 7, 3, G.frameAlong([0, 0, HUB_Z], OUT), P, { steps: 32 }) },
    blade(Math.PI / 2),
    blade(Math.PI / 2 + (2 * Math.PI) / 3),
    blade(Math.PI / 2 + (4 * Math.PI) / 3),
    { name: "nose", solid: G.solidOf([[7, 3], [8.5, 2.2], [9.8, 0.8]], G.frameAlong([0, 0, HUB_Z], OUT), P) },
  ];
}
