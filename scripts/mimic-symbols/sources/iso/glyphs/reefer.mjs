// Refrigerated container (reefer): a 20-ft box with corrugations on its long side, the two door
// locking bars on its door end, the refrigeration unit on its front end (condenser fan with its
// guard and the display window), and the four corner castings.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Refrigerated container (isometric)";
const X = 10;
const Y = 26;
const H = 22;
export const extent = boxExtent(-X - 0.5, -Y - 0.5, 0, X + 0.5, Y + 1.5, H + 0.5);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  // The long side faces +x and carries the corrugations; the doors are on the +y end, toward the
  // viewer; the refrigeration unit sits on the −y end, its fan and display on its +x face.
  const corr = [];
  for (let y = -Y + 15; y <= Y - 4 + 1e-9; y += 5.5) corr.push(s.poly([[X, y, 2], [X, y, H - 2]]));
  const bars = [-5, -1.5, 1.5, 5].map((x) => s.poly([[x, Y, 1.5], [x, Y, H - 1.5]])).join("");
  const seam = s.poly([[0, Y, 0.5], [0, Y, H - 0.5]]);
  const fanC = [X + 1, -Y + 4.5, H - 7];
  const unit = s.circle(fanC, [1, 0, 0], 3.2) + s.spokes(fanC, [1, 0, 0], 0.8, 3.2, 4, Math.PI / 4);
  const display = s.poly([[X + 1, -Y + 2, 5], [X + 1, -Y + 7, 5], [X + 1, -Y + 7, 8.5], [X + 1, -Y + 2, 8.5]], true);
  const casting = (x, y, z) => ({ name: `casting-${x}-${y}-${z}`, solid: s.box(x - 0.5, y - 0.5, z, x + 0.5, y + 0.5, z + 1.5) });
  return [
    { name: "box", solid: s.box(-X, -Y, 0, X, Y, H) },
    { name: "corrugations", lines: corr.join("") },
    { name: "doors", lines: bars + seam },
    { name: "unit", solid: s.box(-X + 1, -Y, 1, X + 1, -Y + 9, H - 1) },
    { name: "unit-face", lines: unit + display },
    casting(X, Y, 0),
    casting(X, Y, H - 1.5),
    casting(-X, Y, H - 1.5),
    casting(X, -Y, H - 1.5),
  ];
}
