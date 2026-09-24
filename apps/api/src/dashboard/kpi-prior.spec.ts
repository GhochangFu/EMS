import { KPI_PRIOR_OFFSET_MS, emptyKpiPrior, priorInstant } from "./kpi-prior";

/**
 * `F3.28` — the pure half of the KPI prior (ADR 0074 decision 5). The SQL is
 * `kpi-prior.integration.spec.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** "vs yesterday" is exactly 24 h — not a calendar day, not a rounded hour. */
export function assertPriorInstantIsExactly24HoursEarlier(): void {
  const asOf = new Date("2026-09-24T10:15:30.123Z");
  const got = priorInstant(asOf).toISOString();
  assert(
    got === "2026-09-23T10:15:30.123Z",
    `priorInstant must be asOf − 24 h to the millisecond, got ${got}`,
  );
}

/** The offset is spelled once; this pins its value. */
export function assertOffsetIs24Hours(): void {
  assert(
    KPI_PRIOR_OFFSET_MS === 86_400_000,
    `KPI_PRIOR_OFFSET_MS must be 86 400 000 ms, got ${KPI_PRIOR_OFFSET_MS}`,
  );
}

/** An empty scope's prior still carries the instant it describes. */
export function assertEmptyPriorCarriesItsInstant(): void {
  const at = new Date("2026-09-23T10:15:30.123Z");
  const got = emptyKpiPrior(at);
  assert(
    JSON.stringify(got) ===
      JSON.stringify({ asOf: "2026-09-23T10:15:30.123Z", totalKw: null, alarmsOpen: 0, pueEstimate: null }),
    `emptyKpiPrior must be { asOf, null, 0, null }, got ${JSON.stringify(got)}`,
  );
}
