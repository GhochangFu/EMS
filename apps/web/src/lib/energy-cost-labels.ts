import type { DashboardWidgetDto, EnergyCostReason } from "@bms/shared";

/** The plain sentence for a period total with no priced day (a tile covers a period, not a day). */
const COST_PERIOD_REASON_TEXT: Readonly<Record<EnergyCostReason, string>> = {
  rate_missing: "No energy rate for this period",
  currency_mixed: "More than one currency in scope",
  no_energy: "No energy data for this period",
};

/**
 * `F4.332` (ADR 0070 Amendment 7 decision 8) — the note every stored energy cost point carries.
 *
 * The `energy_cost_*` points (`energy_cost_per_h`, `_today`, `_this_month`, `_this_year`) are
 * written by the calc engine with the rate of the latest tick, so the whole period is priced at
 * today's rate. The note is added by point key, so it reaches every dashboard that already binds
 * one (the six live PHE dashboards included) with no data change.
 */
export const RATE_EFFECTIVE_NOW_NOTE = "at the rate effective now";

const STORED_COST_PREFIX = "energy_cost_";

/** Whether `pointKey` is one of the stored, tick-priced energy cost points. */
export function isStoredEnergyCostPoint(pointKey: string | null | undefined): boolean {
  return typeof pointKey === "string" && pointKey.startsWith(STORED_COST_PREFIX);
}

/**
 * Whether the widget shows a stored energy cost point: bound directly, or through a
 * `sustainability.*` source's `pointKey`.
 */
export function widgetShowsStoredEnergyCost(widget: Pick<DashboardWidgetDto, "points" | "sources">): boolean {
  if (widget.points.some((point) => isStoredEnergyCostPoint(point.pointKey))) return true;
  return widget.sources.some(
    (source) => source.catalogKey.startsWith("sustainability.") && isStoredEnergyCostPoint(String(source.params.pointKey ?? "")),
  );
}

/** `F4.332` — the coverage line of an `energy.cost.total` tile: days, not assets. */
export function costDaysNote(coverage: { fresh: number; carrying: number } | null | undefined): string | undefined {
  if (!coverage || coverage.fresh >= coverage.carrying) return undefined;
  return `${coverage.fresh} of ${coverage.carrying} days priced`;
}

/** The plain sentence for a null period total, or nothing for a reason this read does not know. */
export function costReasonText(reason: string | null | undefined): string | undefined {
  // `Object.hasOwn`, not `in`: "constructor" is `in` every object (the prototype-key guard).
  return reason !== null && reason !== undefined && Object.hasOwn(COST_PERIOD_REASON_TEXT, reason)
    ? COST_PERIOD_REASON_TEXT[reason as EnergyCostReason]
    : undefined;
}
