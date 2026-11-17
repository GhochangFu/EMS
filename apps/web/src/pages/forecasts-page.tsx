import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { assetLabelOf } from "@bms/shared";
import { forecastFindingHref } from "@bms/shared/contracts";
import type { ForecastListRow } from "@bms/shared";

import { fetchForecastList } from "../api/ml";
import { formatShortInZone, retryUnlessForbidden } from "../components/asset-history/history-format";
import { MlFindingsCard } from "../components/ml/ml-findings-card";
import { PageHeader } from "../components/page-header";
import { ScopeFilterBar } from "../components/scope-filter-bar";
import { SectionCard } from "../components/section-card";
import { StatusPill } from "../components/status-pill";
import { useScopeFilter } from "../hooks/use-scope-filter";
import { AppShell } from "../layouts/app-shell";
import { FORECAST_REFETCH_MS, modelLabel } from "../lib/forecast-series";
import { ML_PAGE_FILTER_KEYS, pickScope } from "../lib/ml-findings";
import type { AuthUser } from "../stores/auth-store";

/** C8 (replaces R-e's copy): the page promises nothing to a point type the scorer does not target. */
export const FORECASTS_EMPTY_SENTENCE =
  "No forecasts yet. Forecasts are made for a few point types with enough recent real data.";

const formatValue = (value: number): string =>
  value.toLocaleString("en-GB", { maximumFractionDigits: 2, useGrouping: false });

/** The p50 range over the next 48 h, with the unit: `-18.46 – -17.2 °C`. */
function rangeLabel(row: ForecastListRow): string {
  const range = `${formatValue(row.p50Min)} – ${formatValue(row.p50Max)}`;
  return row.unit === null ? range : `${range} ${row.unit}`;
}

type ForecastsPageProps = {
  user: AuthUser;
};

/**
 * `E1.4b` / ADR 0135 Amendment 3 R-e, C7, C8, R-g — `/forecasts`: one row per forecast point the
 * caller can read (`GET /ml/forecasts`; the API filters by `readableAssetIds`, so the page has no
 * gate beyond sign-in). The mockups have no forecast screen, so the page keeps the list language
 * (§5): the shared shell, `PageHeader`, one `SectionCard` table.
 *
 * Every time is in **its row's** site zone (C7), never the browser's: two rows of two sites read
 * two zones. The asset is named by `assetLabelOf` (ADR 0111). Each row opens that asset's history
 * with the point charted, where the band and the caption draw. Read again every 15 minutes, the
 * forecast's own pace; a failed read is one fixed sentence (the `F4.204` rule).
 *
 * `E1.9b` (ADR 0135 Amendment 8 decisions 1 and 8): under the header, the Organization and Location
 * pickers (`useScopeFilter`, the URL state of `/alarms`), then the "Findings — advisory" cards, then
 * the table. Both reads send only those two keys, and wait for `scope.ready`.
 */
export function ForecastsPage({ user }: ForecastsPageProps) {
  const scope = useScopeFilter();
  const shown = useMemo(() => pickScope(scope.filter, ML_PAGE_FILTER_KEYS), [scope.filter]);
  const listQ = useQuery({
    queryKey: ["ml-forecasts", shown.organizationId ?? null, shown.locationId ?? null],
    // A thunk: React Query's context must never reach the filter.
    queryFn: () => fetchForecastList(shown),
    refetchInterval: FORECAST_REFETCH_MS,
    retry: retryUnlessForbidden,
    enabled: scope.ready,
  });
  const items = listQ.data?.items ?? [];

  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Forecasts · advisory</span>}>
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Operations · Forecasts"
          title="Forecasts"
          subtitle="Advisory. The next 48 h from the latest model run."
        />

        <ScopeFilterBar
          filter={scope.filter}
          options={scope.options}
          unavailable={scope.unavailable}
          onChange={scope.setScope}
          pickers={ML_PAGE_FILTER_KEYS}
        />
        <MlFindingsCard kinds={["forecasts"]} scope={shown} enabled={scope.ready} />

        {listQ.isPending ? (
          // `isPending`, not `isLoading`: opened offline the read is pending but paused, and a waiting
          // list must not read as the C8 "no forecasts" sentence (the §4.2 `ScopeFilterBar` trap).
          <p className="text-sm text-ink-muted">Loading forecasts…</p>
        ) : listQ.isError && listQ.data === undefined ? (
          // A failed background poll keeps the rows it has; each row carries its own `stale`.
          <p className="text-sm text-critical-ink" role="alert">
            Could not load the forecasts.
          </p>
        ) : items.length === 0 ? (
          <SectionCard title="Forecast points">
            <p className="text-sm text-ink-muted">{FORECASTS_EMPTY_SENTENCE}</p>
          </SectionCard>
        ) : (
          <SectionCard title="Forecast points" bodyClassName="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-well-deep bg-well text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Point</th>
                  <th className="px-3 py-2">Next 48 h (p50 min–max)</th>
                  <th className="px-3 py-2">Peak at</th>
                  <th className="px-3 py-2">Issued</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={`${row.assetId}:${row.pointKey}`} className="border-b border-well-deep">
                    <td className="px-3 py-1.5 text-xs">{row.assetLocationName}</td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs text-ink">{assetLabelOf(row)}</span>
                      <span className="block text-2xs text-ink-muted">{row.assetName}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <Link
                        className="font-mono text-xs font-semibold text-accent-strong hover:underline"
                        to={forecastFindingHref(row.assetId, [row.pointKey])}
                      >
                        {row.pointKey}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 tabular-nums" data-testid="forecast-range">
                      {rangeLabel(row)}
                    </td>
                    <td className="px-3 py-1.5 text-xs tabular-nums" data-testid="forecast-peak" title={row.timeZone}>
                      {formatShortInZone(row.p50PeakAt, row.timeZone)}
                    </td>
                    <td className="px-3 py-1.5 text-xs tabular-nums" data-testid="forecast-issued" title={row.timeZone}>
                      {formatShortInZone(row.issuedAt, row.timeZone)}
                    </td>
                    <td className="px-3 py-1.5 text-xs">{modelLabel(row.modelName)}</td>
                    <td className="px-3 py-1.5">
                      {row.stale ? <StatusPill label="Stale" tone="warning" /> : <StatusPill label="Fresh" tone="ok" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}
