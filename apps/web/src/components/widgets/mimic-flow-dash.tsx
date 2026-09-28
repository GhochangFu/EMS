/** One flow dash period, in viewBox units: the animated offset runs over exactly one. */
const FLOW_DASH = "6 10";
const FLOW_PERIOD = 16;

/**
 * `F3.32b` (ADR 0079 Amendment 2) — the moving dash over a pipe whose upstream unit has fresh
 * data (`mimicNodeFlows`). SMIL, not a CSS keyframe, so no stylesheet or Tailwind config
 * changes; `motion-reduce:hidden` removes it for a person who asked for reduced motion, leaving
 * the plain pipe.
 */
export function FlowDash({ d, from }: { d: string; from: string }) {
  return (
    <path
      data-testid="mimic-flow"
      data-flow-from={from}
      d={d}
      fill="none"
      strokeWidth={3}
      strokeDasharray={FLOW_DASH}
      className="stroke-accent motion-reduce:hidden"
    >
      <animate attributeName="stroke-dashoffset" from={FLOW_PERIOD} to={0} dur="1s" repeatCount="indefinite" />
    </path>
  );
}
