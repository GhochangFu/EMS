// Variable frequency drive: the drive body on its back plate with the keypad (screen and buttons),
// the heat-sink fins on the side, the cooling fan on top, and the terminal cover with cable glands.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Variable frequency drive (isometric)";
const X = 9;
const Y = 7;
const H = 34;
export const extent = boxExtent(-X - 2, -Y - 2, -3, X + 2, Y, H + 2);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  const on = (x, z) => [x, Y, z];
  const keypad = s.poly([on(-5, H - 4), on(5, H - 4), on(5, H - 16), on(-5, H - 16)], true);
  const screen = s.poly([on(-3.5, H - 5.5), on(3.5, H - 5.5), on(3.5, H - 10), on(-3.5, H - 10)], true);
  const buttons = [-2.5, 0, 2.5].map((x) => s.circle(on(x, H - 13), [0, 1, 0], 0.8)).join("");
  const cover = s.poly([on(-X, 9), on(X, 9)]);
  const fins = [];
  for (let y = -Y + 1.5; y < Y; y += 2) fins.push(s.poly([[X, y, 11], [X, y, H - 3]]));
  return [
    { name: "plate", solid: s.box(-X - 2, -Y - 2, -3, X + 2, -Y, H + 2) },
    ...[-4, 0, 4].map((x) => ({ name: `gland-${x}`, solid: s.vcyl(x, 0, 1.4, -3, 0, 16) })),
    { name: "body", solid: s.box(-X, -Y, 0, X, Y, H) },
    { name: "front", lines: keypad + screen + buttons + cover },
    { name: "fins", lines: fins.join("") },
    { name: "fan", lines: s.circle([0, 0, H], [0, 0, 1], 4) + G.spokesOf(G.frameAlong([0, 0, H], [0, 0, 1]), 0, 1, 4, 3, P) },
  ];
}
