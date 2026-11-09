// Circuit breaker (moulded case) on its mounting plate: the body, three line terminals on top,
// three load terminals below, the handle recess with the toggle handle, the trip button and the
// rating label on the front face.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Circuit breaker (isometric)";
const X = 11;
const Y = 7;
const H = 30;
export const extent = boxExtent(-X - 4, -Y - 2, -7, X + 4, Y + 6, H + 7);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const terminals = (z0, z1) => [-6.5, 0, 6.5].map((x) => ({ name: `terminal-${z0}-${x}`, solid: s.vcyl(x, 0, 2, z0, z1, 20) }));
  const recess = [[-6, Y, 9], [6, Y, 9], [6, Y, 22], [-6, Y, 22]];
  const label = [[-7, Y, 3], [7, Y, 3], [7, Y, 6], [-7, Y, 6]];
  return [
    { name: "plate", solid: s.box(-X - 4, -Y - 2, -7, X + 4, -Y, H + 7) },
    ...terminals(-4, 0),
    { name: "body", solid: s.box(-X, -Y, 0, X, Y, H) },
    ...terminals(H, H + 4),
    { name: "recess-and-label", lines: s.poly(recess, true) + s.poly(label, true) },
    { name: "handle", solid: s.box(-2, Y, 14, 2, Y + 6, 20) },
    { name: "trip-button", solid: s.box(X, -3, 24, X + 2, 1, 27) },
  ];
}
