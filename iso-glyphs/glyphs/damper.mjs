// Air damper (AWS: qet:air-damper on the ESKOM flow network): a duct stub with its flange, the
// damper frame with six inclined blades on its face, the blade linkage and the actuator on the
// side.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Air damper (isometric)";
const Y = 12;
const H = 24;
export const extent = boxExtent(-20, -Y - 1, 0, 4, Y + 7, H + 1);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const blades = [];
  for (let z = 4; z < H - 1; z += 3.4) blades.push(s.poly([[3, -Y + 2, z - 1], [3, Y - 2, z + 1]]));
  const opening = s.poly([[3, -Y + 2, 2], [3, Y - 2, 2], [3, Y - 2, H - 2], [3, -Y + 2, H - 2]], true);
  const linkage = s.poly([[-1, Y, 5], [-1, Y, H - 5]]) + [8, 12, 16].map((z) => s.poly([[-1, Y, z], [1.5, Y, z + 1]])).join("");
  return [
    { name: "duct", solid: s.box(-20, -Y + 1.5, 1.5, -3, Y - 1.5, H - 1.5) },
    { name: "duct-flange", solid: s.box(-5, -Y - 0.5, -0.5, -3, Y + 0.5, H + 0.5) },
    { name: "frame", solid: s.box(-3, -Y, 0, 3, Y, H) },
    { name: "opening", lines: opening },
    { name: "blades", lines: blades.join("") },
    { name: "linkage", lines: linkage },
    { name: "actuator", solid: s.box(-3, Y, H - 9, 2, Y + 6, H - 2) },
    { name: "actuator-cover", lines: s.poly([[2, Y + 1.5, H - 7.5], [2, Y + 4.5, H - 7.5], [2, Y + 4.5, H - 3.5], [2, Y + 1.5, H - 3.5]], true) },
  ];
}
