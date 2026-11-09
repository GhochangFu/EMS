// Vertical storage tank on a round plinth: shell with three weld seams, a level gauge beside it,
// a cone roof with a vent, a side manway and a flanged outlet nozzle near the bottom.
// Same rule as the pump: lines closer than about 5 units merge at the mimic's stroke width.

export const name = "Storage tank (isometric)";

const PLINTH = { r: 17, h: 3 };
const SHELL = { r: 14, z0: 0, z1: 34 };
/** The shell's inner volume, for the live level fill (ADR 0121 decision 6; build.mjs projects it). */
export const level = { r: SHELL.r, z0: SHELL.z0, z1: SHELL.z1 };
const SEAMS = [8.5, 17, 25.5];
const GAUGE = { angle: -Math.PI / 5, r: SHELL.r + 2.5, z0: 4, z1: 30 };
const ROOF = { rise: 7 };
const VENT = { r: 2.5, h: 4 };
const MANWAY = { z: 22, from: 13, to: 16, r: 4.5 };
const OUTLET = { z: 6, from: 12, to: 19, r: 3 };
const OUTLET_FLANGE = { from: 19, to: 21, r: 5 };

export const extent = [
  [-PLINTH.r, -PLINTH.r, -PLINTH.h],
  [PLINTH.r, PLINTH.r, -PLINTH.h],
  [0, 0, SHELL.z1 + ROOF.rise + VENT.h],
  [OUTLET_FLANGE.to, 0, OUTLET.z + OUTLET_FLANGE.r],
];

/** The level gauge: a tube beside the shell on two stubs. */
function levelGauge(k, G, P) {
  const x = Math.cos(GAUGE.angle) * GAUGE.r;
  const y = Math.sin(GAUGE.angle) * GAUGE.r;
  const stub = (z) => G.disc(SHELL.r - 0.5, GAUGE.r, 0.8, G.frameAlong([0, 0, z], [Math.cos(GAUGE.angle), Math.sin(GAUGE.angle), 0]), P, { steps: 12 });
  return [
    { name: "gauge-stub-low", solid: stub(GAUGE.z0 + 1) },
    { name: "gauge-stub-high", solid: stub(GAUGE.z1 - 1) },
    { name: "gauge-tube", solid: k.cylinder(x, y, 1.1, GAUGE.z0, GAUGE.z1 - GAUGE.z0, P, 12) },
  ];
}

export function parts(k, G, P) {
  const up = G.frameAlong([0, 0, 0], [0, 0, 1]);
  // Nozzles leave the shell toward the viewer (azimuth 45°), so they are seen in three-quarter view.
  const out = (z) => G.frameAlong([0, 0, z], [Math.SQRT1_2, Math.SQRT1_2, 0]);
  const nozzle = (z, { from, to, r }) => G.disc(from, to, r, out(z), P, { steps: 40 });
  return [
    { name: "plinth", solid: k.cylinder(0, 0, PLINTH.r, -PLINTH.h, PLINTH.h, P, 64) },
    { name: "shell", solid: k.cylinder(0, 0, SHELL.r, SHELL.z0, SHELL.z1 - SHELL.z0, P, 64) },
    { name: "seams", lines: SEAMS.map((z) => G.arcOf(up, z, SHELL.r, P)).join("") },
    { name: "roof", solid: G.solidOf([[SHELL.z1, SHELL.r], [SHELL.z1 + ROOF.rise, VENT.r]], up, P) },
    { name: "vent", solid: k.cylinder(0, 0, VENT.r, SHELL.z1 + ROOF.rise - 0.5, VENT.h + 0.5, P, 32) },
    ...levelGauge(k, G, P),
    { name: "manway", solid: nozzle(MANWAY.z, MANWAY) },
    { name: "outlet", solid: nozzle(OUTLET.z, OUTLET) },
    { name: "outlet-flange", solid: nozzle(OUTLET.z, OUTLET_FLANGE) },
  ];
}
