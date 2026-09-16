import type {
  AssetInstantiationResultDto,
  DefaultDashboardsBackfillResultDto,
} from "@bms/shared";

/**
 * `F3.2` / [ADR 0067](../../../../docs/adr/0067-per-asset-default-dashboards.md)
 * decision 7 — the two sentences the asset-template detail page prints after a
 * write.
 *
 * They live here rather than inline in `asset-template-detail-page.tsx` for the
 * reason `template-tabs.ts` records: `apps/web`'s Vitest project runs over
 * `src/**\/*.test.ts` and the coverage gate's `include` reaches
 * `apps/web/src/lib/**` and nothing above it, so a rule written in a `.tsx` is
 * unreachable by every test in this repository. Counting and pluralisation are
 * real rules — ADR 0067 Q5 fixes the instantiate wording verbatim — so they are
 * somewhere a test can see them.
 *
 * **Counts come from the result's own count fields, never from
 * `result.assets.length`.** The server writes the whole batch or none of it,
 * and `assetCount`/`pointCount`/`ruleCount`/`dashboardCount` are what it
 * counted from the rows it wrote; an array length re-derives one of the four
 * from a different source and would disagree the day the response summarises
 * rather than enumerates. `disabledRuleCount` is deliberately absent — Q5 names
 * four counts.
 */

/** `1 asset`, `2 assets` — only the noun inflects. */
function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/**
 * ADR 0067 Q5, verbatim: *"Built 2 assets · 8 points · 3 rules · 2
 * dashboards"*. This is the first surface `ruleCount` (ADR 0058 decision 10)
 * reaches, and the first that `dashboardCount` reaches at all.
 */
export function instantiationSummary(result: AssetInstantiationResultDto): string {
  return [
    `Built ${count(result.assetCount, "asset")}`,
    count(result.pointCount, "point"),
    count(result.ruleCount, "rule"),
    count(result.dashboardCount, "dashboard"),
  ].join(" · ");
}

/**
 * Decision 4's backfill: *"Created dashboards for 5 assets · 3 already had
 * one"*.
 *
 * The second clause is printed even when `skippedCount` is `0`. The shape of
 * the sentence is then constant, which is what the browser layer asserts by
 * exact match; a "none already had one" arm would be wording no document rules
 * on and no cheaper gate could check. "already had one" does not inflect.
 */
export function backfillSummary(result: DefaultDashboardsBackfillResultDto): string {
  return `Created dashboards for ${count(result.createdCount, "asset")} · ${
    result.skippedCount
  } already had one`;
}
