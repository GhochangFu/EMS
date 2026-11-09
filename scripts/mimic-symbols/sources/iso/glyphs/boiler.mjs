// Fire-tube boiler: a horizontal shell on a base, the chimney stack at the back, the shell weld
// seams and side manhole, the steam outlet with its valve and two safety valves on top, the
// water-level gauge glass, and the hinged front door with the burner and its fan housing.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Boiler (isometric)";
const R = 12;
const AXIS_Z = R + 3;
const TOP = AXIS_Z + R;
export const extent = boxExtent(-22, -R, 0, 27, R + 2, 42);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  return [
    { name: "base", solid: s.box(-20, -10, 0, 14, 10, 3) },
    { name: "stack", solid: s.vcyl(-15, 0, 3.5, TOP - 2, 42, 24) },
    { name: "shell", solid: s.xcyl(0, AXIS_Z, R, -22, 14) },
    { name: "steam-outlet", solid: s.vcyl(-3, 0, 2, TOP - 1, TOP + 4, 16) },
    { name: "steam-valve", solid: s.box(-6, -3, TOP + 4, 0, 3, TOP + 8) },
    { name: "safety-a", solid: s.vcyl(5, -3, 1.4, TOP - 1, TOP + 5, 16) },
    { name: "safety-b", solid: s.vcyl(9, 3, 1.4, TOP - 1, TOP + 5, 16) },
    { name: "seams", lines: [-10, 2].map((x) => G.arcOf(G.frameAlong([0, 0, AXIS_Z], [1, 0, 0]), x, R, P)).join("") },
    { name: "manhole", solid: s.ycyl(-8, AXIS_Z + 2, 3.5, R - 1.5, R + 1) },
    { name: "gauge-glass", solid: s.box(12, R - 1, AXIS_Z - 2, 14, R + 2, AXIS_Z + 9) },
    { name: "door", solid: s.xcyl(0, AXIS_Z, R - 2, 14, 17) },
    { name: "door-hinges", lines: [AXIS_Z - 5, AXIS_Z + 5].map((z) => s.poly([[17, -R + 3, z], [17, -R + 1, z]])).join("") },
    { name: "burner", solid: s.xcyl(0, AXIS_Z, 4, 17, 21) },
    { name: "fan-housing", solid: s.box(19, -5, AXIS_Z - 12, 27, 5, AXIS_Z - 3) },
  ];
}
