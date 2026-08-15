import {
  PROVENANCE_CLASS,
  PROVENANCE_TITLE,
  provenanceMarker,
  type ValueProvenance,
} from "../lib/value-provenance";

type StaticValueProps = {
  /** The value itself, exactly as it should read. */
  children: React.ReactNode;
  /** Why this value is static. Live kinds render no marker (ADR 0028). */
  kind: Exclude<ValueProvenance, "measured" | "derived">;
};

/**
 * A value that is *not* a live reading, marked so an operator can tell (ADR
 * 0028 decision 3).
 *
 * The staleness gate of `ADR 0027` cannot reach nameplate, setpoint or
 * simulated data — there is nothing to go stale — so the honesty has to be
 * visual. Use this anywhere a static value sits among live ones; the repo
 * invariant in `tests/repo-invariants.test.ts` checks for this wrapper rather
 * than against numeric literals, which would be unenforceable when nameplate
 * values are legitimate.
 */
export function StaticValue({ children, kind }: StaticValueProps) {
  const marker = provenanceMarker(kind);
  return (
    <span className="inline-flex items-baseline gap-1" title={PROVENANCE_TITLE[kind]}>
      <span>{children}</span>
      {marker ? (
        <span
          className={`font-mono text-[9px] font-semibold uppercase tracking-wide ${PROVENANCE_CLASS[kind]}`}
        >
          {marker}
        </span>
      ) : null}
    </span>
  );
}

type StaticTspanProps = {
  kind: Exclude<ValueProvenance, "measured" | "derived">;
  children: React.ReactNode;
};

/**
 * The SVG counterpart of {@link StaticValue}.
 *
 * A `<span>` cannot live inside `<svg>`, and the SLD schematic is entirely SVG
 * — which is exactly where the `384 V` literals were found. This renders a
 * `<tspan>` rather than a positioned `<text>` deliberately: it drops into any
 * existing text node without moving it, so marking a value cannot disturb a
 * diagram whose geometry follows the mockup reference (AGENTS.md §5). It also
 * means the marker cannot drift away from the value it qualifies.
 */
export function StaticTspan({ kind, children }: StaticTspanProps) {
  const marker = provenanceMarker(kind);
  return (
    <tspan>
      <title>{PROVENANCE_TITLE[kind]}</title>
      {children}
      {marker ? <tspan className="fill-slate-400 text-[7px]">{` ${marker}`}</tspan> : null}
    </tspan>
  );
}
