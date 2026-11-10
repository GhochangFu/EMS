// Telemetry tower (PHE RTU signal, GSM link): a square plinth, a tapered square lattice mast with
// X braces on its two visible faces, two panel antennas near the top, a lightning rod, and three
// signal arcs on each side of the top.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Telemetry tower (isometric)";
const B = 7; // half width of the mast at its foot
const T = 2.5; // half width at its top
const Z0 = 3;
const H = 42;
const ACROSS = [-Math.SQRT1_2, Math.SQRT1_2, 0]; // horizontal, across the view
export const extent = boxExtent(-17, -17, 0, 17, 17, H + 6);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  // Half width of the mast at height z.
  const w = (z) => B + ((T - B) * (z - Z0)) / (H - Z0);
  const levels = [Z0, 14, 24, 33, H];
  const braces = [];
  for (let i = 0; i + 1 < levels.length; i += 1) {
    const [z0, z1] = [levels[i], levels[i + 1]];
    const [a, b] = [w(z0), w(z1)];
    // +x face and +y face: an X in each bay and the bay's top rung.
    braces.push(s.poly([[a, -a, z0], [b, b, z1]]), s.poly([[a, a, z0], [b, -b, z1]]), s.poly([[b, -b, z1], [b, b, z1]]));
    braces.push(s.poly([[-a, a, z0], [b, b, z1]]), s.poly([[a, a, z0], [-b, b, z1]]), s.poly([[-b, b, z1], [b, b, z1]]));
  }
  const legs = [[1, 1], [1, -1], [-1, 1]].map(([sx, sy]) => s.poly([[sx * B, sy * B, Z0], [sx * T, sy * T, H]]));
  const top = [0, 0, H - 2];
  const arcs = [];
  for (const r of [7, 11, 15]) {
    for (const side of [1, -1]) {
      const pts = [];
      for (let t = -0.55; t <= 0.551; t += 0.11) {
        const across = side * Math.cos(t) * r;
        pts.push([top[0] + ACROSS[0] * across, top[1] + ACROSS[1] * across, top[2] + Math.sin(t) * r]);
      }
      arcs.push(s.poly(pts));
    }
  }
  return [
    { name: "plinth", solid: s.box(-B - 2, -B - 2, 0, B + 2, B + 2, Z0) },
    { name: "legs", lines: legs.join("") },
    { name: "braces", lines: braces.join("") },
    { name: "antenna-back", solid: s.box(-T - 1, -T - 1.5, H - 10, -T, T + 1.5, H - 3) },
    { name: "antenna-left", solid: s.box(-T - 1.5, T, H - 10, T + 1.5, T + 1, H - 3) },
    { name: "antenna-right", solid: s.box(T, -T - 1.5, H - 10, T + 1, T + 1.5, H - 3) },
    { name: "rod", lines: s.poly([[0, 0, H], [0, 0, H + 6]]) },
    { name: "arcs", lines: arcs.join("") },
  ];
}
