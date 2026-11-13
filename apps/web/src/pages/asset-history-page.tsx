import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { encodePointRef } from "@bms/shared";

import { fetchAssetPoints, fetchAssets } from "../api/assets";
import { downloadAssetHistoryExport } from "../api/view-exports";
import { BucketTable } from "../components/asset-history/bucket-table";
import { ACCESS_SENTENCE, isForbidden, retryUnlessForbidden, siteZoneOf } from "../components/asset-history/history-format";
import { PointList } from "../components/asset-history/point-list";
import { RangePicker } from "../components/asset-history/range-picker";
import { RawRecordsTable } from "../components/asset-history/raw-records-table";
import { TrendChart, type TrendSeries } from "../components/asset-history/trend-chart";
import { MaintenanceBadge } from "../components/maintenance/maintenance-badge";
import { PageHeader } from "../components/page-header";
import { CopyLinkButton } from "../components/view-actions/copy-link-button";
import { ExportMenu } from "../components/view-actions/export-menu";
import { historyPinSource, PinButton } from "../components/view-actions/pin-dialog";
import { ScheduleButton } from "../components/view-actions/schedule-button";
import { useActiveMaintenance } from "../hooks/use-active-maintenance";
import { useAssetHistory } from "../hooks/use-asset-history";
import { apiErrorMessage } from "../lib/api-error-message";
import { chartablePoints, rangeFromSearch, rangeToSearch, type HistoryRange } from "../lib/asset-history-range";
import { historySchedulePrefill } from "../lib/schedule-from-view";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AssetHistoryPageProps = {
  user: AuthUser;
};

/**
 * `F4.297` U5 (ADR 0108 decision 1) — `/asset-history/:assetId`: the asset's points with the
 * latest value and poll time, a chart and a bucket table over a preset or custom range with an
 * optional compare, and the chosen point's latest raw records.
 *
 * The range, the compare, the function and the charted points live in the URL
 * (`rangeFromSearch` / `rangeToSearch`), so a reload keeps them and `F4.303` can reuse them.
 * With no `points` in the URL the first point is charted.
 *
 * The page is a site view (decision 1.9): every time is in the zone the `aggregate` response
 * names. There is no route guard beyond sign-in: the API's `canReadAsset` is the containment, and
 * a 403 from any read renders {@link ACCESS_SENTENCE} once, with no retry loop.
 */
export function AssetHistoryPage({ user }: AssetHistoryPageProps) {
  const { assetId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = useMemo(() => rangeFromSearch(searchParams), [searchParams]);

  const assetsQ = useQuery({ queryKey: ["assets", "list"], queryFn: () => fetchAssets(), retry: retryUnlessForbidden });
  const pointsQ = useQuery({
    queryKey: ["asset-points", assetId],
    queryFn: () => fetchAssetPoints(assetId),
    enabled: assetId !== "",
    retry: retryUnlessForbidden,
  });

  const asset = assetsQ.data?.find((row) => row.id === assetId);
  // `F4.359` U16 (plan Q7): one asset-scoped read; an `:assetId` that is not a uuid names no asset, so no read.
  const inMaintenance = useActiveMaintenance({ assetId }, { enabled: UUID.test(assetId) }).coveredAssetIds.has(assetId);
  const points = useMemo(() => pointsQ.data?.items ?? [], [pointsQ.data]);
  const selected = useMemo(() => {
    // The two-axis rule holds for a URL list too: a third distinct unit is not charted.
    const known = chartablePoints(
      range.points.filter((key) => points.some((p) => p.pointKey === key)),
      (key) => points.find((p) => p.pointKey === key)?.unit ?? null,
    );
    return known.length > 0 || points.length === 0 ? known : [points[0].pointKey];
  }, [range.points, points]);

  const history = useAssetHistory(assetId, selected, range);
  const series: TrendSeries[] = history.flatMap((h) =>
    h.data === undefined
      ? []
      : [{ pointKey: h.pointKey, unit: points.find((p) => p.pointKey === h.pointKey)?.unit ?? null, data: h.data }],
  );
  const siteZone = siteZoneOf(series.find((s) => s.data.timeZone !== undefined)?.data.timeZone);

  const forbidden =
    isForbidden(pointsQ.error) || isForbidden(assetsQ.error) || history.some((h) => isForbidden(h.error));
  const missing = assetsQ.isSuccess && asset === undefined;

  function setRange(next: HistoryRange): void {
    setSearchParams(rangeToSearch(next), { replace: true });
  }

  const firstKey = selected[0];
  const firstSeries = series.find((s) => s.pointKey === firstKey);
  const historyError = history.find((h) => h.error !== null && !isForbidden(h.error))?.error;

  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Asset history</span>}>
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Operations · Asset history"
          title={asset ? `${asset.code} · ${asset.name}` : "Asset history"}
          subtitle={asset ? asset.siteName : undefined}
          actions={
            inMaintenance ? (
              <span data-testid="asset-maintenance-badge">
                <MaintenanceBadge />
              </span>
            ) : undefined
          }
        />

        {forbidden || missing ? (
          <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
            {ACCESS_SENTENCE}
          </p>
        ) : (
          <>
            {pointsQ.isLoading ? <p className="text-sm text-ink-muted">Loading points…</p> : null}
            {pointsQ.isError ? (
              <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
                {apiErrorMessage(pointsQ.error)}
              </p>
            ) : null}

            {/* `F4.303` (ADR 0108 Amendment 6 item 2): the state is already in the URL; "Copy link" ends the row. */}
            <div data-testid="asset-history-controls" className="flex flex-wrap items-start justify-between gap-2">
              <RangePicker range={range} zone={siteZone.zone} zoneLabel={siteZone.label} onChange={setRange} />
              <span className="inline-flex flex-wrap items-center gap-3">
                {selected.length === 0 ? null : (
                  <ExportMenu onExport={(format) => downloadAssetHistoryExport(format, assetId, range, selected)} />
                )}
                {/* `F4.303` U15 (Amendment 6 item 4): pins the charted points with the page's function. */}
                {asset === undefined ? null : (
                  <PinButton role={user.role} source={historyPinSource(asset.code, assetId, range, selected)} />
                )}
                {/* `F4.303` U16 (Amendment 6 item 6): schedules `trend_points` for the charted points. */}
                {asset === undefined || selected.length === 0 ? null : (
                  <ScheduleButton user={user} prefill={historySchedulePrefill(asset, range, selected)} />
                )}
                <CopyLinkButton />
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <PointList
                assetId={assetId}
                points={points}
                selected={selected}
                onChange={(next) => setRange({ ...range, points: next })}
                zone={siteZone.zone}
              />
              <div className="space-y-4">
                {historyError ? (
                  <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">
                    {apiErrorMessage(historyError)}
                  </p>
                ) : null}
                <TrendChart
                  series={series}
                  chartedCount={selected.length}
                  compare={range.compare}
                  siteZone={siteZone}
                />
                {firstSeries ? (
                  <BucketTable
                    pointKey={firstSeries.pointKey}
                    unit={firstSeries.unit}
                    data={firstSeries.data}
                    compare={range.compare}
                    zone={siteZone.zone}
                  />
                ) : null}
              </div>
            </div>

            {firstKey ? (
              <RawRecordsTable
                key={firstKey}
                pointRef={encodePointRef(assetId, firstKey)}
                pointKey={firstKey}
                zone={siteZone.zone}
              />
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
