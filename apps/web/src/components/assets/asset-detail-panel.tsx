import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import type { AssetRow } from "../../api/assets";
import { fetchDashboards } from "../../api/dashboards";
import { useAssetHealth } from "../../hooks/use-asset-health";
import { apiErrorMessage } from "../../lib/api-error-message";
import { activeLabel, noDashboardsSentence } from "../../lib/asset-browser";
import { AssetHealthCard } from "../asset-health/asset-health-card";
import { StatusPill } from "../status-pill";

/**
 * `F3.31` — the read-only detail panel of the `/assets` browser (ADR 0068
 * decision 3, ruling 5): a right-docked `<aside>` on the same route, the
 * `asset-images-panel.tsx` shape.
 *
 * Three reads and one filter, nothing written:
 *
 * - the row's own columns, from the `AssetRow` the list already holds —
 *   **no second asset fetch**;
 * - health through `useAssetHealth`, rendered by `AssetHealthCard`, which
 *   already prints ADR 0050's three absences as distinct sentences rather
 *   than a zero;
 * - the asset's `F3.2` default dashboards through `GET /dashboards?assetId=`
 *   (decision 4), each a link to `/dashboards/<slug>`; an empty list reads
 *   `noDashboardsSentence`, which says why when the asset has no template.
 *
 * There is **no** edit, RTU-attach, points, image or delete control here, and
 * `AssetImagesPanel` is not reused — it is an upload surface (decision 3's
 * last paragraph; `assets-page.spec.tsx` P7 asserts the absence).
 */
export type AssetDetailPanelProps = {
  asset: AssetRow;
  /** The vocabulary label for `asset.domain`, resolved by the page. */
  domainLabel: string;
  onClose: () => void;
};

/** A null RTU or source reads the em dash the rest of the UI uses for "nothing to show". */
const NONE = "—";

export function AssetDetailPanel({ asset, domainLabel, onClose }: AssetDetailPanelProps): JSX.Element {
  const healthQ = useAssetHealth(asset.id);
  const dashboardsQ = useQuery({
    queryKey: ["dashboards", "list", { assetId: asset.id }],
    queryFn: () => fetchDashboards(undefined, asset.id),
  });
  const dashboards = dashboardsQ.data?.items ?? [];

  const facts: Array<[string, string]> = [
    ["Name", asset.name],
    ["Site", asset.siteName],
    ["Location", asset.locationName],
    ["Domain", domainLabel],
    ["RTU", asset.rtuDisplayName ?? NONE],
    ["Source", asset.telemetrySource ?? NONE],
    ["Active", activeLabel(asset.active)],
  ];

  return (
    <aside className="fixed right-0 top-0 z-50 flex h-full w-[90%] max-w-[380px] flex-col border-l border-gray-200 bg-white shadow-lg">
      <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <div>
          <h2 className="font-condensed text-base font-bold">Asset · {asset.code}</h2>
          <p className="text-xs text-bms-muted">{asset.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill label={activeLabel(asset.active)} tone={asset.active ? "ok" : "offline"} />
          <button type="button" className="text-xs text-bms-muted" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="font-medium uppercase tracking-wide text-bms-muted">{term}</dt>
              <dd className="text-bms-ink">{value}</dd>
            </div>
          ))}
        </dl>

        {healthQ.isLoading ? <p className="text-xs text-bms-muted">Loading health…</p> : null}
        {healthQ.isError ? (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            Health could not be read. {apiErrorMessage(healthQ.error as Error)}
          </p>
        ) : null}
        {healthQ.data ? <AssetHealthCard title="Health" data={healthQ.data} /> : null}

        <section className="border-t border-gray-200 pt-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-bms-muted">Dashboards</h3>
          {dashboardsQ.isLoading ? <p className="mt-1 text-xs text-bms-muted">Loading dashboards…</p> : null}
          {dashboardsQ.isError ? (
            <p className="mt-1 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {apiErrorMessage(dashboardsQ.error as Error)}
            </p>
          ) : null}
          {dashboardsQ.isSuccess && dashboards.length === 0 ? (
            <p className="mt-1 text-xs text-bms-muted">{noDashboardsSentence(asset.templateId)}</p>
          ) : null}
          {dashboards.length > 0 ? (
            <ul className="mt-1 space-y-1 text-xs">
              {dashboards.map((dashboard) => (
                <li key={dashboard.id} className="flex items-baseline gap-1">
                  {/* `?organizationId=` as on the dashboards page: on the fleet pool one
                      slug can live in two organizations, and the viewer reads the query. */}
                  <Link
                    to={`/dashboards/${dashboard.slug}?organizationId=${dashboard.organizationId}`}
                    className="font-semibold text-bms-green hover:underline"
                  >
                    {dashboard.name}
                  </Link>
                  <span className="text-bms-muted">· {dashboard.widgetCount} widgets</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
