// End-suction centrifugal pump on a skid: a fan-cooled motor on feet with ribs and a terminal box,
// a coupling guard, the volute casing, and suction and discharge nozzles with flanges.
// A glyph, not a figure. Drawn for the thin-line fill set (out/fill, lines 1/40 of the view box):
// lines closer than about 2 units merge there. In the stroke set (1/16) the close ones merge.

export const name = "Centrifugal pump (isometric)";

const SKID = { x: -28, y: -11, w: 56, d: 22, r: 1 };
const SKID_H = 3;
const FOOT_H = 5;
const AXIS_Z = FOOT_H + 8; // the motor sits on its feet
const FEET = [-21, -9].map((x) => ({ x, y: -8, w: 6, d: 16, r: 0.5 }));
const COWL = { from: -28, to: -22, r: 5.5 };
const MOTOR = { from: -22, to: -1, r: 8 };
const RIBS = { from: -19, to: -4, count: 10 };
const TERMINAL_BOX = { x: -15, y: -3.5, w: 6, d: 7, r: 0.5 };
const TERMINAL_BOX_H = 4.5;
const GUARD = { x: -1, y: -4, w: 6, d: 8, r: 1 };
const GUARD_H = AXIS_Z + 3;
const CASING = { from: 5, to: 15, r: 11 };
const SUCTION = { from: 15, to: 20, r: 4.5 };
const SUCTION_FLANGE = { from: 20, to: 22, r: 6.5 };
const DISCHARGE = { x: 10, r: 4.5, from: AXIS_Z + 10, to: AXIS_Z + 16 };
const DISCHARGE_FLANGE = { from: AXIS_Z + 16, to: AXIS_Z + 18, r: 6.5 };

export const extent = [
  [SKID.x, SKID.y, -SKID_H],
  [SKID.x + SKID.w, SKID.y + SKID.d, -SKID_H],
  [SKID.x, SKID.y, 0],
  [SKID.x + SKID.w, SKID.y + SKID.d, 0],
  [COWL.from, -COWL.r, AXIS_Z + COWL.r],
  [SUCTION_FLANGE.to, 0, AXIS_Z + SUCTION_FLANGE.r],
  [DISCHARGE.x, 0, DISCHARGE_FLANGE.to],
  [DISCHARGE.x + DISCHARGE_FLANGE.r, DISCHARGE_FLANGE.r, DISCHARGE_FLANGE.to],
];

export function parts(k, G, P) {
  const shaft = G.frameAlong([0, 0, AXIS_Z], [1, 0, 0]);
  const along = ({ from, to, r }) => G.disc(from, to, r, shaft, P, { steps: 48 });
  const upright = (x, r, z0, z1) => k.cylinder(x, 0, r, z0, z1 - z0, P, 40);
  return [
    { name: "skid", solid: k.slabOf(SKID, -SKID_H, SKID_H, P, 2) },
    { name: "skid-groove", lines: k.planOutline(k.insetPlan(SKID, 2.5), 0, P, 2) },
    ...FEET.map((foot, i) => ({ name: `motor-foot-${i + 1}`, solid: k.slabOf(foot, 0, FOOT_H, P, 2) })),
    { name: "fan-cowl", solid: along(COWL) },
    { name: "motor", solid: along(MOTOR) },
    { name: "motor-ribs", lines: G.ribsOf(shaft, RIBS.from, RIBS.to, MOTOR.r, RIBS.count, P, { seams: true }) },
    { name: "terminal-box", solid: k.slabOf(TERMINAL_BOX, AXIS_Z + MOTOR.r - 1, TERMINAL_BOX_H + 1, P, 2) },
    { name: "coupling-guard", solid: k.slabOf(GUARD, 0, GUARD_H, P, 2) },
    { name: "casing", solid: along(CASING) },
    { name: "casing-joint", lines: G.arcOf(shaft, 10, CASING.r, P) },
    { name: "discharge", solid: upright(DISCHARGE.x, DISCHARGE.r, DISCHARGE.from, DISCHARGE.to) },
    { name: "discharge-flange", solid: upright(DISCHARGE.x, DISCHARGE_FLANGE.r, DISCHARGE_FLANGE.from, DISCHARGE_FLANGE.to) },
    { name: "suction", solid: along(SUCTION) },
    { name: "suction-flange", solid: along(SUCTION_FLANGE) },
  ];
}
