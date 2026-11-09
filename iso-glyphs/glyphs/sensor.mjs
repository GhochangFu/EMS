// Field transmitter on a pipe: the pipe run with flanged ends, the tapping boss and process
// flange, the stem, the round electronics housing with its two screw caps, the display window and
// the cable gland.
import { boxExtent, shapesOf } from "../lib/shapes.mjs";

export const name = "Sensor / transmitter (isometric)";
const PIPE_Z = 5;
const HEAD_Z = 25;
export const extent = boxExtent(-18, -10, 0, 18, 10, HEAD_Z + 8);

export function parts(k, G, P) {
  const s = shapesOf(k, G, P);
  return [
    { name: "flange-back", solid: s.xcyl(0, PIPE_Z, 7, -18, -16) },
    { name: "pipe", solid: s.xcyl(0, PIPE_Z, 5, -16, 16) },
    { name: "boss", solid: s.vcyl(0, 0, 3, PIPE_Z + 3, PIPE_Z + 8, 24) },
    { name: "process-flange", solid: s.vcyl(0, 0, 5.5, PIPE_Z + 8, PIPE_Z + 10, 32) },
    { name: "stem", solid: s.vcyl(0, 0, 1.8, PIPE_Z + 10, HEAD_Z - 6, 16) },
    { name: "cap-back", solid: s.ycyl(0, HEAD_Z, 7.8, -8.5, -6.5) },
    { name: "housing", solid: s.ycyl(0, HEAD_Z, 7, -6.5, 6.5) },
    { name: "gland", solid: s.xcyl(0, HEAD_Z - 2, 1.8, 6.5, 10.5) },
    { name: "cap-front", solid: s.ycyl(0, HEAD_Z, 7.8, 6.5, 8.5) },
    { name: "window", lines: s.circle([0, 8.5, HEAD_Z], [0, 1, 0], 4.5) },
    { name: "flange-front", solid: s.xcyl(0, PIPE_Z, 7, 16, 18) },
  ];
}
