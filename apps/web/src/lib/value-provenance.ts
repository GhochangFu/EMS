/**
 * Where a value on a control-room page came from (ADR 0028).
 *
 * `ADR 0027` answered "is this reading current?" and assumed the thing on
 * screen was a reading. Verifying `F4.38` against the deployment showed that
 * assumption fails: two battery strings rendered `384 V` beside twelve breakers
 * correctly reading `OFFLINE`, because those volts were a string literal.
 *
 * The rule this module exists to carry: **a value may be labelled as a
 * measurement of X only if it comes from telemetry that measures X.** That is
 * not the same as "no arithmetic" — `kVA` from `kW` and `pf` is a real relation
 * between real inputs on the same circuit. Deriving "Voltage Y" from Voltage R,
 * or 32 cell voltages from one string voltage, asserts instruments that do not
 * exist.
 */

/**
 * Exhaustive. Every lookup below is a `Record` over this union rather than a
 * ternary chain with a default, so adding a kind is a compile error — the
 * `F4.38` finding was that a chain whose default is the healthy branch renders
 * a brand-new state as `normal` and compiles silently.
 */
export type ValueProvenance =
  | "measured"
  | "derived"
  | "nameplate"
  | "configuration"
  | "simulated";

/** The kinds that represent current knowledge of the plant. */
const LIVE: Record<ValueProvenance, boolean> = {
  measured: true,
  derived: true,
  nameplate: false,
  configuration: false,
  simulated: false,
};

/**
 * True when the value reflects telemetry, and so is subject to the ADR 0027
 * staleness gate. False when it is static or synthetic, and so must be marked
 * instead — the staleness gate cannot reach it and never will.
 */
export function isLiveProvenance(kind: ValueProvenance): boolean {
  return LIVE[kind];
}

/** Short marker rendered next to a static value. */
export const PROVENANCE_MARKER: Record<ValueProvenance, string> = {
  measured: "",
  derived: "",
  nameplate: "NP",
  configuration: "SET",
  simulated: "SIM",
};

/** Hover text spelling the marker out; operators should not have to learn it. */
export const PROVENANCE_TITLE: Record<ValueProvenance, string> = {
  measured: "Live reading from telemetry",
  derived: "Calculated from live readings",
  nameplate: "Nameplate / design data — not a reading",
  configuration: "Configured setpoint — not a reading",
  simulated: "Simulated demo data — not a reading",
};

/**
 * Styling token for the marker. Static kinds are deliberately muted and
 * uppercase so they read as annotation rather than as part of the number.
 */
export const PROVENANCE_CLASS: Record<ValueProvenance, string> = {
  measured: "",
  derived: "",
  nameplate: "text-slate-500",
  configuration: "text-sky-700",
  simulated: "text-violet-700",
};

/**
 * Marker text for a static value, or `null` when the kind is live and needs no
 * annotation. Callers render nothing for `null` rather than an empty element.
 */
export function provenanceMarker(kind: ValueProvenance): string | null {
  return isLiveProvenance(kind) ? null : PROVENANCE_MARKER[kind];
}
