// Plate-and-frame filter press: the hydraulic cylinder and its end bracket, the moving head, the
// plate pack (one line per plate) above the drip tray, the fixed head with the feed nozzle, the two
// side beams and the legs.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Filter press (isometric)";
const Y = 9;
const Z0 = 8;
const H = 26;
export const extent = boxExtent(-32, -Y - 2, 0, 20, Y + 2, H + 2);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const plates = [];
  for (let x = -12.5; x < 10; x += 2.3) plates.push(s.poly([[x, Y - 1, Z0 + 1], [x, Y - 1, H - 1], [x, -Y + 1, H - 1]]));
  const leg = (x) => ({ name: `leg-${x}`, solid: s.box(x - 1.5, -Y, 0, x + 1.5, Y, Z0 - 1) });
  return [
    leg(-30),
    { name: "bracket", solid: s.box(-32, -Y - 1, Z0 - 1, -29, Y + 1, H + 1) },
    { name: "beam-back", solid: s.xcyl(-Y - 1, H - 2, 1.2, -29, 12) },
    { name: "cylinder", solid: s.xcyl(0, (Z0 + H) / 2, 3.2, -29, -19) },
    { name: "rod", solid: s.xcyl(0, (Z0 + H) / 2, 1.4, -19, -16) },
    { name: "moving-head", solid: s.box(-16, -Y - 1, Z0 - 1, -13, Y + 1, H + 1) },
    { name: "tray", solid: s.box(-13, -Y, 2, 10, Y, 4) },
    { name: "pack", solid: s.box(-13, -Y + 1, Z0, 10, Y - 1, H) },
    { name: "plates", lines: plates.join("") },
    { name: "beam-front", solid: s.xcyl(Y + 1, H - 2, 1.2, -29, 12) },
    leg(13),
    { name: "fixed-head", solid: s.box(10, -Y - 2, Z0 - 1, 14, Y + 2, H + 2) },
    { name: "feed", solid: s.xcyl(0, (Z0 + H) / 2, 2.4, 14, 18) },
    { name: "feed-flange", solid: s.xcyl(0, (Z0 + H) / 2, 3.6, 18, 19.5) },
  ];
}
