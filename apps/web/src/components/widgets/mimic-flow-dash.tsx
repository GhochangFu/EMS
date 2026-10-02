/** One flow dash period, in viewBox units: the animated offset runs over exactly one. */
const FLOW_DASH = "6 10";
const FLOW_PERIOD = 16;

/**
 * `F3.32b` (ADR 0079 Amendment 2) — the moving dash over a pipe whose upstream unit has fresh
 * data (`mimicNodeFlows`). SMIL, not a CSS keyframe, so no stylesheet or Tailwind config
 * changes; `motion-reduce:hidden` removes it for a person who asked for reduced motion, leaving
 * the plain pipe.
 *
 * `className` is the dash's stroke colour only (`F3.74` plan D6): on a graph with sources the scene
 * passes the pipe's energy class, so a de-energised or unknown pipe never animates in accent. It
 * defaults to `stroke-accent`, the colour of a graph with no sources, as before.
 */
export function FlowDash({ d, from, className = "stroke-accent" }: { d: string; from: string; className?: string }) {
  return (
    <path
      data-testid="mimic-flow"
      data-flow-from={from}
      d={d}
      fill="none"
      strokeWidth={3}
      strokeDasharray={FLOW_DASH}
      className={`${className} motion-reduce:hidden`}
    >
      <animate attributeName="stroke-dashoffset" from={FLOW_PERIOD} to={0} dur="1s" repeatCount="indefinite" />
    </path>
  );
}
