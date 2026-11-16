import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { assetLabelOf } from "@bms/shared";
import type { AnomalyListRow } from "@bms/shared";

import { fetchAnomalyList } from "../api/ml";
import { formatShortInZone, retryUnlessForbidden } from "../components/asset-history/history-format";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { StatusPill } from "../components/status-pill";
import { AppShell } from "../layouts/app-shell";
import { detectorLabel } from "../lib/anomaly-series";
import { assetHistoryPath, rangeToSearch } from "../lib/asset-history-range";
import type { AuthUser } from "../stores/auth-store";

export const ANOMALIES_SUBTITLE =
  "Advisory. Hours in the last 7 days when an asset's readings were unusual against its own last 28 days.";

/** The page promises nothing to an asset type the scorer does not target. */
export const ANOMALIES_EMPTY_SENTENCE =
  "No unusual hours in the last 7 days. Scores are made for a few asset types with enough recent real data.";

export const ANOMALIES_TRUNCATED_SENTENCE = "Showing the newest 500.";

export const ANOMALIES_ERROR_SENTENCE = "Could not load the unusual hours.";

/** Read again every 15 minutes; scores land once an hour. */
const ANOMALIES_REFETCH_MS = 15 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/**
 * The row's history link: the asset's history page from `t − 24 h` to `min(t + 24 h, asOf)`, with
 * the contributing points charted. An unreadable instant links to the bare history page.
 */
function historyHref(row: AnomalyListRow, asOf: string): string {
  const path = assetHistoryPath(row.assetId);
  const t = Date.parse(row.t);
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(t)) {
    return path;
  }
  const to = Number.isFinite(asOfMs) ? Math.min(t + DAY_MS, asOfMs) : t + DAY_MS;
  const search = rangeToSearch({
    range: "custom",
    from: new Date(t - DAY_MS).toISOString(),
    to: new Date(to).toISOString(),
    compare: false,
    points: row.contributingPoints,
    fn: "avg",
  });
  return `${path}?${search.toString()}`;
}

type AnomaliesPageProps = {
  user: AuthUser;
};

/**
 * `E1.2c` / ADR 0135 Amendment 5 ruling 4(a) — `/anomalies`: the unusual hours of the last 7 days
 * the caller can read (`GET /ml/anomalies`; the API filters by access, so the page has no gate
 * beyond sign-in). The `E1.4b` Forecasts page's shape and the list language (§5): the shared shell,
 * `PageHeader`, one `SectionCard` table.
 *
 * Every hour is in **its row's** site zone, never the browser's. The asset is named by
 * `assetLabelOf` (ADR 0111). Each row opens that asset's history around the hour with its
 * contributing points charted, where the unusual-hour marks draw. Every surface says advisory: a
 * score is a notice, never an alarm. A failed read is one fixed sentence (the `F4.204` rule).
 */
export function AnomaliesPage({ user }: AnomaliesPageProps) {
  const listQ = useQuery({
    queryKey: ["ml-anomalies"],
    // A thunk: React Query's context must never reach `since`.
    queryFn: () => fetchAnomalyList(),
    refetchInterval: ANOMALIES_REFETCH_MS,
    retry: retryUnlessForbidden,
  });
  const data = listQ.data;
  const items = data?.items ?? [];

  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Anomalies · advisory</span>}>
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader eyebrow="Operations · Anomalies" title="Anomalies" subtitle={ANOMALIES_SUBTITLE} />

        {listQ.isPending ? (
          // `isPending`, not `isLoading`: opened offline the read is pending but paused, and a waiting
          // list must not read as the empty sentence.
          <p className="text-sm text-ink-muted">Loading unusual hours…</p>
        ) : listQ.isError && data === undefined ? (
          <p className="text-sm text-critical-ink" role="alert">
            {ANOMALIES_ERROR_SENTENCE}
          </p>
        ) : data === undefined || items.length === 0 ? (
          <SectionCard title="Unusual hours">
            <p className="text-sm text-ink-muted">{ANOMALIES_EMPTY_SENTENCE}</p>
          </SectionCard>
        ) : (
          <SectionCard title="Unusual hours" bodyClassName="overflow-x-auto">
            {data.truncated ? <p className="px-3 py-2 text-xs text-ink-muted">{ANOMALIES_TRUNCATED_SENTENCE}</p> : null}
            <table className="w-full text-left text-sm">
              <thead className="border-b border-well-deep bg-well text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Hour</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Detector</th>
                  <th className="px-3 py-2">Top points</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={`${row.assetId}:${row.t}:${row.detector}`} className="border-b border-well-deep">
                    <td className="px-3 py-1.5 text-xs">{row.assetLocationName}</td>
                    <td className="px-3 py-1.5">
                      <Link
                        className="font-mono text-xs font-semibold text-accent-strong hover:underline"
                        to={historyHref(row, data.asOf)}
                      >
                        {assetLabelOf(row)}
                      </Link>
                      <span className="block text-2xs text-ink-muted">{row.assetName}</span>
                    </td>
                    <td className="px-3 py-1.5 text-xs tabular-nums" data-testid="anomaly-hour" title={row.timeZone}>
                      {formatShortInZone(row.t, row.timeZone)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums" data-testid="anomaly-score">
                      {row.score.toFixed(3)}
                    </td>
                    <td className="px-3 py-1.5 text-xs" data-testid="anomaly-detector">
                      {detectorLabel(row.detector)}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs" data-testid="anomaly-points">
                      {row.contributingPoints.join(", ")}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusPill label="Advisory" tone="info" />
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
