// Chemical dosing skid: a day tank with a level scale on its front and a dished lid, the mixer
// gearbox and motor, and two dosing pumps (duty and standby), each with its head, motor, fan cowl
// and discharge line, on one base.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Dosing skid (isometric)";
const TANK = { x: -10, y: -2, r: 10, z0: 2.5, z1: 22 };
export const extent = boxExtent(-22, -16, 0, 25, 16, 33);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  // The scale sits on the shell where it faces the viewer: a vertical line with four ticks.
  const fx = TANK.x + TANK.r * Math.SQRT1_2;
  const fy = TANK.y + TANK.r * Math.SQRT1_2;
  const scale =
    s.poly([[fx, fy, 5], [fx, fy, 20]]) +
    [7, 11, 15, 19].map((z) => s.poly([[fx, fy, z], [fx - 1.4, fy + 1.4, z]])).join("");
  const pump = (y) => [
    { name: `pump-body-${y}`, solid: s.box(5, y - 4.5, 2.5, 12, y + 4.5, 11) },
    { name: `pump-head-${y}`, lines: s.circle([5, y, 7], [-1, 0, 0], 2.5) },
    { name: `pump-motor-${y}`, solid: s.xcyl(y, 7, 4, 12, 21) },
    { name: `pump-cowl-${y}`, solid: s.xcyl(y, 7, 3, 21, 24) },
    { name: `pump-discharge-${y}`, solid: s.vcyl(8.5, y, 0.9, 11, 15, 12) },
  ];
  return [
    { name: "base", solid: s.box(-22, -16, 0, 25, 16, 2.5) },
    { name: "tank", solid: s.vcyl(TANK.x, TANK.y, TANK.r, TANK.z0, TANK.z1, 56) },
    { name: "level-scale", lines: scale },
    { name: "lid", solid: G.solidOf([[22, 10], [24, 7], [25, 3]], G.frameAlong([TANK.x, TANK.y, 0], [0, 0, 1]), P) },
    { name: "gearbox", solid: s.vcyl(TANK.x, TANK.y, 3, 25, 28) },
    { name: "mixer-motor", solid: s.vcyl(TANK.x, TANK.y, 2.2, 28, 33, 24) },
    ...pump(-9),
    ...pump(10),
  ];
}
