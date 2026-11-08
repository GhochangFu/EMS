import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchOrganizationControlRoomView,
  makeOrganizationLayout,
  resetOrganizationLayout,
} from "../../api/control-room";
import { apiErrorMessage } from "../../lib/api-error-message";
import { STRIP_REFETCH_MS, STRIP_STALE_MS, stripTileProps } from "../../lib/organization-strip";
import { KpiTile } from "../kpi-tile";
import { WidgetIconGlyph } from "../widget-icon";
import { CostByDayChartWidget } from "../widgets/cost-by-day-chart-widget";

type OrganizationKpiStripProps = {
  organizationId: string;
};

/** The query key of one organization's strip read; Make and Reset invalidate it. */
export function organizationStripKey(organizationId: string): readonly string[] {
  return ["control-room", "organization-view", organizationId];
}

/**
 * The strip's one read and a ticking clock, shared by the tiles (`OrganizationKpiStrip`) and the
 * chart block (`OrganizationStripCharts`): both use the same query key, so the page sends one read.
 * The clock lets a last answer that stops being refreshed still age on screen (as the estate
 * ribbon's does): nothing else re-renders while reads fail or hang.
 */
function useOrganizationStripView(organizationId: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const viewQ = useQuery({
    queryKey: organizationStripKey(organizationId),
    queryFn: () => fetchOrganizationControlRoomView(organizationId),
    refetchInterval: STRIP_REFETCH_MS,
  });
  return { viewQ, now };
}

/**
 * `F4.317` task 5.3 (ADR 0112 decisions 2 to 6) — the organization page's KPI strip: the tiles of
 * `GET /control-room/organizations/:id/view`, drawn on the estate grid, with a "Layout: …" status
 * line. A caller the API says may manage the strip (`canManage`) also sees **Make organization
 * layout** (while the strip is the stock one), **Reset to default** and **Edit in the builder**
 * (while it is a copy); anyone else sees tiles and the status line only. The API decides again on
 * every write, so a stale button is a refusal shown inline, never a change.
 *
 * A failed read draws one line and leaves the rest of the page standing: the strip is a summary,
 * not a gate. Tile rules live in `lib/organization-strip.ts`.
 */
export function OrganizationKpiStrip({ organizationId }: OrganizationKpiStripProps) {
  const queryClient = useQueryClient();
  const key = organizationStripKey(organizationId);
  const [actionError, setActionError] = useState<string | null>(null);
  const { viewQ, now } = useOrganizationStripView(organizationId);
  const settle = () => queryClient.invalidateQueries({ queryKey: key });
  const make = useMutation({
    mutationFn: () => makeOrganizationLayout(organizationId),
    onMutate: () => setActionError(null),
    onSuccess: settle,
    onError: (err: unknown) => setActionError(apiErrorMessage(err)),
  });
  const reset = useMutation({
    mutationFn: () => resetOrganizationLayout(organizationId),
    onMutate: () => setActionError(null),
    onSuccess: settle,
    onError: (err: unknown) => setActionError(apiErrorMessage(err)),
  });

  const view = viewQ.data;
  if (view === undefined) {
    return viewQ.isError ? (
      <p data-testid="organization-kpi-strip-error" role="alert" className="text-sm text-critical-ink">
        The KPI strip could not be read. Try again later.
      </p>
    ) : (
      <p data-testid="organization-kpi-strip-loading" role="status" className="text-sm text-ink-muted">
        Loading KPIs…
      </p>
    );
  }

  // `F4.337` — the strip draws the tiles only; `OrganizationStripCharts` draws the charts where
  // the page puts it (below the alarms), whatever grid row the layout gives them.
  const tiles = view.tiles
    .filter((tile) => tile.widgetType !== "chart")
    .sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
  const busy = make.isPending || reset.isPending;
  // Age is the browser's own clock from when the answer arrived, never the server's `resolvedAt`
  // against this clock: a skewed browser clock would show every tile stale.
  const receivedAt = new Date(viewQ.dataUpdatedAt).toISOString();

  return (
    <section data-testid="organization-kpi-strip" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span data-testid="organization-strip-layout">{`Layout: ${view.layoutName}`}</span>
        {view.canManage ? (
          <span className="flex flex-wrap items-center gap-2">
            {view.kind === "stock" ? (
              <button
                type="button"
                disabled={busy}
                aria-busy={make.isPending}
                onClick={() => make.mutate()}
                className="rounded border border-line px-2 py-1 font-semibold text-accent-strong hover:underline disabled:opacity-60"
              >
                {make.isPending ? "Making organization layout…" : "Make organization layout"}
              </button>
            ) : (
              <>
                {view.dashboardSlug !== null ? (
                  <Link
                    to={`/admin/dashboards/${encodeURIComponent(view.dashboardSlug)}?organizationId=${encodeURIComponent(organizationId)}`}
                    className="font-semibold text-accent-strong hover:underline"
                  >
                    Edit in the builder
                  </Link>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={reset.isPending}
                  onClick={() => reset.mutate()}
                  className="rounded border border-line px-2 py-1 font-semibold text-accent-strong hover:underline disabled:opacity-60"
                >
                  {reset.isPending ? "Resetting…" : "Reset to default"}
                </button>
              </>
            )}
          </span>
        ) : null}
      </div>
      {actionError !== null ? (
        <p data-testid="organization-strip-action-error" role="alert" className="text-sm text-critical-ink">
          {actionError}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => {
          const { icon, stale, ...props } = stripTileProps(tile, receivedAt, Math.max(now, viewQ.dataUpdatedAt));
          return (
            <div key={tile.key} data-testid={`org-strip-tile-${tile.key}`} className="min-w-0">
              <KpiTile {...props} icon={WidgetIconGlyph(icon)} stale={stale && props.status === "ready"} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * `F4.337` (owner, 2026-11-08) — the strip's chart widgets (`F4.332`'s daily energy cost chart,
 * ADR 0112 Amendment 3), drawn full width where the organization page places this block: after
 * the sites and the active alarms, before Asset health. It reads the strip's own query (one
 * request for both) and draws nothing while the read is pending or failed, or when the layout
 * holds no chart — the strip above already says so in one line.
 */
export function OrganizationStripCharts({ organizationId }: OrganizationKpiStripProps) {
  const { viewQ, now } = useOrganizationStripView(organizationId);
  const charts = (viewQ.data?.tiles ?? [])
    .filter((tile) => tile.widgetType === "chart")
    .sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
  if (charts.length === 0) return null;
  // The tiles' staleness rule (`stripTileProps`), so the chart ages with them.
  const stale = Math.max(now, viewQ.dataUpdatedAt) - viewQ.dataUpdatedAt > STRIP_STALE_MS;
  return (
    <section data-testid="organization-strip-charts" className="space-y-3">
      {charts.map((tile) => {
        const resolved = tile.sources[0]?.resolved;
        return (
          <div key={tile.key} data-testid={`org-strip-tile-${tile.key}`} className="min-w-0">
            <CostByDayChartWidget
              title={tile.title ?? "Daily energy cost"}
              status={resolved === null || resolved === undefined ? "empty" : "ready"}
              stale={stale}
              rows={resolved?.shape === "dataset" ? resolved.rows : []}
            />
          </div>
        );
      })}
    </section>
  );
}
