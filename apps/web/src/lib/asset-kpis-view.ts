import type { AssetKpiState } from "@bms/shared";

import { formatWidgetValue } from "./widget-value";

/**
 * `F2.33` (ADR 0097) — what the KPI card says when a KPI has no value. A
 * closed `Record` over the contract's state enum, so a state added to the
 * contract is a compile error here until it has a sentence.
 */
export const KPI_STATE_SENTENCE: Readonly<Record<AssetKpiState, string>> = {
  ok: "Computed now",
  unvalidated: "Not evaluated — the expression is stored unvalidated",
  missing_input: "An input has no reading",
  stale_input: "An input is stale — older than the window",
  no_members: "No asset in scope declares this point",
  unknown_asset_reference: "A referenced asset is not at this location",
  parameter_unset: "A parameter has no value set",
  window_empty: "No reading inside the window",
  window_sparse: "Too few readings inside the window",
  windows_unresolved: "The window read was refused",
  timezone_unset: "The location has no time zone",
  non_finite: "The result is not a finite number",
};

/** The value with its unit, or the em dash for `null` — `formatWidgetValue`'s precision rule. */
export function formatKpiValue(value: number | null, unit: string | undefined): string {
  return formatWidgetValue(value, unit === undefined ? {} : { unit });
}

/** How many declared aggregate members were stale or missing — counts only, never names (decision 6). */
export function excludedSentence(excluded: number, memberCount: number): string {
  return excluded === 0 ? `All ${memberCount} members fresh` : `${excluded} of ${memberCount} members excluded`;
}

/** The oldest input the value rests on. */
export function inputAsOfSentence(inputAsOf: string): string {
  return `Inputs as of ${new Date(inputAsOf).toLocaleString()}`;
}
