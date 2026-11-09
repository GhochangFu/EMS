// Plate heat exchanger: the support column, the guide bar on top, the pressure plate, the plate
// pack (one line per plate group), the fixed frame plate at the front with its four flanged
// nozzles, and the tie bolts.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Plate heat exchanger (isometric)";
const Y = 8;
const H = 26;
export const extent = boxExtent(-24, -Y - 2, 0, 20, Y + 2, H + 2);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const plates = [];
  for (let x = -10; x < 9; x += 2.4) plates.push(s.poly([[x, Y - 1, 3.5], [x, Y - 1, H - 3.5], [x, -Y + 1, H - 3.5]]));
  const nozzle = (y, z) => [
    { name: `nozzle-${y}-${z}`, solid: s.xcyl(y, z, 2.2, 14, 18) },
    { name: `nozzle-flange-${y}-${z}`, solid: s.xcyl(y, z, 3.4, 18, 19.5) },
  ];
  const bolts = [-Y - 1.2, Y + 1.2].map((y) => [5, H - 5].map((z) => ({ name: `bolt-${y}-${z}`, solid: s.xcyl(y, z, 0.8, -15, 15) }))).flat();
  return [
    { name: "column", solid: s.box(-24, -3, 0, -20, 3, H + 1) },
    { name: "foot", solid: s.box(-25, -6, 0, -19, 6, 2) },
    { name: "guide-bar", solid: s.xcyl(0, H, 1.2, -22, 12) },
    { name: "pressure-plate", solid: s.box(-14, -Y - 1, 1, -11, Y + 1, H + 1) },
    { name: "pack", solid: s.box(-11, -Y + 1, 2.5, 11, Y - 1, H - 2.5) },
    { name: "plates", lines: plates.join("") },
    ...bolts,
    { name: "frame-plate", solid: s.box(11, -Y - 2, 0, 14, Y + 2, H + 2) },
    ...nozzle(-4, 6),
    ...nozzle(4, 6),
    ...nozzle(-4, H - 5),
    ...nozzle(4, H - 5),
  ];
}
