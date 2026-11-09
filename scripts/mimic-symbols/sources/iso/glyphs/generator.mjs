// Diesel generator set on a base fuel tank with its fill cap: the radiator with its grille, the
// engine block with a side panel, an air filter and the exhaust silencer, the alternator with its
// vent slots and end cap, and the control panel with its screen on top of the alternator.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Generator set (isometric)";
const B = 5;
const AXIS_Z = B + 9;
export const extent = boxExtent(-28, -11, 0, 24, 11, 33);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const grille = [];
  for (let z = B + 3; z < B + 18; z += 2.5) grille.push(s.poly([[-22, 7, z], [-22, -7, z]]));
  const panel = (y) => s.poly([[-19, y, B + 3], [-19, y, B + 13], [-3, y, B + 13], [-3, y, B + 3]], true);
  const panelFace = [[14, -3.5, AXIS_Z + 14], [14, 3.5, AXIS_Z + 14], [14, 3.5, AXIS_Z + 10], [14, -3.5, AXIS_Z + 10]];
  const axis = G.frameAlong([0, 0, AXIS_Z], [1, 0, 0]);
  return [
    { name: "fuel-tank", solid: s.box(-28, -11, 0, 24, 11, B) },
    { name: "radiator", solid: s.box(-28, -9, B, -22, 9, B + 19) },
    { name: "grille", lines: grille.join("") },
    { name: "engine", solid: s.box(-22, -7, B, 0, 7, B + 16) },
    { name: "engine-panel", lines: panel(7) },
    { name: "fill-cap", solid: s.vcyl(18, 8, 1.4, B, B + 2, 12) },
    { name: "air-filter", solid: s.ycyl(-17, B + 19, 2.6, -6, 6) },
    { name: "silencer", solid: s.xcyl(-1, B + 24, 3, -20, -4) },
    { name: "alternator", solid: s.xcyl(0, AXIS_Z, 9, 0, 19) },
    { name: "alternator-vents", lines: [4, 7, 10, 13].map((x) => G.arcOf(axis, x, 9, P, { from: -0.6, to: 0.6 })).join("") },
    { name: "end-cap", solid: s.xcyl(0, AXIS_Z, 6.5, 19, 22) },
    { name: "control-panel", solid: s.box(5, -5, AXIS_Z + 8, 14, 5, AXIS_Z + 16) },
    { name: "panel-screen", lines: s.poly(panelFace, true) },
  ];
}
