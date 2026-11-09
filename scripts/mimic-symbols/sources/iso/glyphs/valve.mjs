// Flanged gate valve in a pipe run: two pipe stubs with flanges, the body, a bonnet with its
// flange, the stem and a handwheel on top.
// Same rule as the pump: lines closer than about 5 units merge at the mimic's stroke width.

export const name = "Gate valve (isometric)";

const AXIS_Z = 0;
const STUB_L = { from: -26, to: -15, r: 4 };
const FLANGE_L = { from: -15, to: -12, r: 7.5 };
const BODY = { from: -12, to: 12, r: 9 };
const FLANGE_R = { from: 12, to: 15, r: 7.5 };
const STUB_R = { from: 15, to: 26, r: 4 };
const BONNET = { r: 5, z0: 6, z1: 17 };
const BONNET_FLANGE = { r: 7.5, z0: 13, z1: 15 };
const STEM = { r: 1.5, z0: 17, z1: 26 };
const WHEEL = { r: 10, z0: 26, z1: 28 };

export const extent = [
  [STUB_L.from, -FLANGE_L.r, AXIS_Z - BODY.r],
  [STUB_R.to, FLANGE_R.r, AXIS_Z - BODY.r],
  [-WHEEL.r, -WHEEL.r, WHEEL.z1],
  [WHEEL.r, WHEEL.r, WHEEL.z1],
];

export function parts(k, G, P) {
  const pipe = G.frameAlong([0, 0, AXIS_Z], [1, 0, 0]);
  const along = ({ from, to, r }) => G.disc(from, to, r, pipe, P, { steps: 48 });
  const upright = ({ r, z0, z1 }) => k.cylinder(0, 0, r, z0, z1 - z0, P, 48);
  return [
    { name: "stub-left", solid: along(STUB_L) },
    { name: "flange-left", solid: along(FLANGE_L) },
    { name: "body", solid: along(BODY) },
    { name: "bonnet", solid: upright(BONNET) },
    { name: "bonnet-flange", solid: upright(BONNET_FLANGE) },
    { name: "stem", solid: upright(STEM) },
    { name: "handwheel", solid: upright(WHEEL) },
    { name: "wheel-spokes", lines: G.spokesOf(G.frameAlong([0, 0, WHEEL.z1], [0, 0, 1]), 0, 2, WHEEL.r - 2.5, 4, P, { phase: Math.PI / 4 }) },
    { name: "wheel-rim", lines: k.ring(0, 0, WHEEL.r - 2.5, WHEEL.z1, P, 40) },
    { name: "body-seam", lines: G.arcOf(pipe, 0, BODY.r, P) },
    { name: "flange-right", solid: along(FLANGE_R) },
    { name: "stub-right", solid: along(STUB_R) },
  ];
}
