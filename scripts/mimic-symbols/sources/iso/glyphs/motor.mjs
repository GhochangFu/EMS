// Foot-mounted fan-cooled motor on a base: feet, fan cowl, ribbed frame, terminal box, the drive
// end bell and the shaft.
// Same rule as the pump: lines closer than about 5 units merge at the mimic's stroke width.

export const name = "Electric motor (isometric)";

const BASE = { x: -22, y: -12, w: 44, d: 24, r: 1 };
const BASE_H = 3;
const FOOT_H = 5;
const AXIS_Z = FOOT_H + 10;
const FEET = [-15, 3].map((x) => ({ x, y: -10, w: 7, d: 20, r: 0.5 }));
const COWL = { from: -24, to: -17, r: 7.5 };
const FRAME = { from: -17, to: 10, r: 10 };
const RIBS = { from: -14, to: 7, count: 12 };
const END_BELL = { from: 10, to: 14, r: 8 };
const SHAFT = { from: 14, to: 22, r: 2.2 };
const TERMINAL_BOX = { x: -8, y: -4.5, w: 9, d: 9, r: 0.5 };
const TERMINAL_BOX_H = 5;

export const extent = [
  [BASE.x, BASE.y, -BASE_H],
  [BASE.x + BASE.w, BASE.y + BASE.d, -BASE_H],
  [COWL.from, -COWL.r, AXIS_Z + COWL.r],
  [SHAFT.to, 0, AXIS_Z],
  [TERMINAL_BOX.x, TERMINAL_BOX.y, AXIS_Z + FRAME.r + TERMINAL_BOX_H],
];

export function parts(k, G, P) {
  const shaft = G.frameAlong([0, 0, AXIS_Z], [1, 0, 0]);
  const along = ({ from, to, r }) => G.disc(from, to, r, shaft, P, { steps: 56 });
  return [
    { name: "base", solid: k.slabOf(BASE, -BASE_H, BASE_H, P, 2) },
    ...FEET.map((foot, i) => ({ name: `foot-${i + 1}`, solid: k.slabOf(foot, 0, FOOT_H, P, 2) })),
    { name: "fan-cowl", solid: along(COWL) },
    { name: "frame", solid: along(FRAME) },
    { name: "ribs", lines: G.ribsOf(shaft, RIBS.from, RIBS.to, FRAME.r, RIBS.count, P, { seams: true }) },
    { name: "terminal-box", solid: k.slabOf(TERMINAL_BOX, AXIS_Z + FRAME.r - 1.5, TERMINAL_BOX_H + 1.5, P, 2) },
    { name: "end-bell", solid: along(END_BELL) },
    { name: "shaft", solid: along(SHAFT) },
    { name: "eye-bolt", solid: k.cylinder(4, 0, 1.2, AXIS_Z + FRAME.r - 0.5, 3, P, 12) },
    { name: "base-groove", lines: k.planOutline(k.insetPlan(BASE, 2.5), 0, P, 2) },
  ];
}
