import type { DashboardKpis } from "@bms/shared";

import { formatDelta } from "./widget-value";

/**
 * `F3.28` (ADR 0074 decision 5, task 2.5) — the hint and note lines of the
 * executive KPI ribbon on `/`, from the server's KPI snapshot and its `prior`.
 *
 * Each tile compares a live field with the same field 24 h earlier through
 * `formatDelta`, so the text ("↑ 10.0% vs yesterday") and its null cases are the
 * ones a `value_tile` already renders. `formatDelta` returns `null` for a
 * missing value on either side and for a baseline of `0` — a percentage of zero
 * does not exist — and each tile then falls back to the fixed line it carried
 * before `F3.28`.
 *
 * **Total load compares the server with the server** (plan decision 5). The
 * tile *displays* the live socket sum (`displayTotalKw` in
 * `use-executive-dashboard.ts`), but the delta is `kpi.totalKw` against
 * `kpi.prior.totalKw`: both halves come from the same SQL definition at two
 * instants, whereas the socket sum has no prior to compare with. The printed
 * value and the delta can therefore disagree by up to one `kpiQuery` refetch
 * interval.
 *
 * **Open alarms** (owner ruling OQ5): the delta goes in `hint`; "N critical"
 * moves to `KpiTile`'s `note` line; with no delta the hint reads
 * {@link OPEN_ALARMS_FALLBACK_HINT}. `prior.alarmsOpen` is often `0` on a quiet
 * estate, and a baseline of `0` has no percentage, so the fallback is the
 * common case there — that is `formatDelta`'s rule, not a gap here.
 *
 * **PUE**: the delta text only. With no delta the page keeps `pueTileProps`'
 * own hint, which says where the ratio comes from or what to configure.
 *
 * **Sites online** carries no delta (plan decision 8) and is not handled here.
 */

/** Total load's line when there is no computable delta. */
export const TOTAL_LOAD_FALLBACK_HINT = "Sum of latest kW per asset";

/** Open alarms' line when there is no computable delta (OQ5). The dash is U+2014. */
export const OPEN_ALARMS_FALLBACK_HINT = "Active — not yet cleared";

export type KpiRibbonHints = {
  readonly totalLoadHint: string;
  readonly openAlarmsHint: string;
  /** "N critical", only when at least one open alarm is critical. */
  readonly openAlarmsNote: string | undefined;
  /** The PUE delta text, or `undefined` so the caller keeps its own hint. */
  readonly pueDeltaText: string | undefined;
};

/**
 * The ribbon's hint and note lines. `kpi` is `undefined` while the query has
 * not settled, and every tile then shows its fallback line.
 */
export function kpiRibbonHints(kpi: DashboardKpis | undefined): KpiRibbonHints {
  if (!kpi) {
    return {
      totalLoadHint: TOTAL_LOAD_FALLBACK_HINT,
      openAlarmsHint: OPEN_ALARMS_FALLBACK_HINT,
      openAlarmsNote: undefined,
      pueDeltaText: undefined,
    };
  }
  const totalLoad = formatDelta(kpi.totalKw, kpi.prior.totalKw);
  const openAlarms = formatDelta(kpi.alarmsOpen, kpi.prior.alarmsOpen);
  const pue = formatDelta(kpi.pueEstimate, kpi.prior.pueEstimate);
  return {
    totalLoadHint: totalLoad?.text ?? TOTAL_LOAD_FALLBACK_HINT,
    openAlarmsHint: openAlarms?.text ?? OPEN_ALARMS_FALLBACK_HINT,
    openAlarmsNote: kpi.alarmsCritical > 0 ? `${kpi.alarmsCritical} critical` : undefined,
    pueDeltaText: pue?.text,
  };
}
