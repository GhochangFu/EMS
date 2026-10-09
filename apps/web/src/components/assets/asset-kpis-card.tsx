import type { AssetKpisResponse } from "@bms/shared";

import { excludedSentence, formatKpiValue, inputAsOfSentence, KPI_STATE_SENTENCE } from "../../lib/asset-kpis-view";

type AssetKpisCardProps = {
  data: AssetKpisResponse;
};

/**
 * `F2.33` (ADR 0097 decision 1) — the asset's template KPIs, computed at read
 * time, under the health card on the asset detail panel.
 *
 * A KPI with no value shows the em dash **and** why (the state sentence), and
 * how old its inputs were when any was read — a stale KPI says how stale. An
 * aggregate KPI shows its counts, never its members (decision 6). The window
 * is the API's default; the card offers no control for it.
 */
export function AssetKpisCard({ data }: AssetKpisCardProps) {
  return (
    <div className="flex flex-col surface-raised p-3">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">KPIs</h3>
      {data.items.length === 0 ? (
        <p className="text-xs text-ink-muted">No KPIs on this asset&apos;s template.</p>
      ) : (
        <ul className="space-y-2 text-xs text-ink">
          {data.items.map((kpi) => (
            <li key={kpi.code} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span data-kpi-name>{kpi.name}</span>
                <span className="font-condensed text-base font-bold tabular-nums">
                  {formatKpiValue(kpi.value, kpi.unit)}
                </span>
              </div>
              {kpi.state !== "ok" ? <p className="text-ink-muted">{KPI_STATE_SENTENCE[kpi.state]}</p> : null}
              {/* The count is measured only when the member read ran: a refusal above it (a
                  stale local input, an unset parameter) carries `excluded: 0` for members
                  nobody read, so "all fresh" is said only for `ok`, where it is true. */}
              {kpi.memberCount > 0 && (kpi.excluded > 0 || kpi.state === "ok") ? (
                <p className="text-ink-muted">{excludedSentence(kpi.excluded, kpi.memberCount)}</p>
              ) : null}
              {kpi.inputAsOf !== null ? <p className="text-ink-muted">{inputAsOfSentence(kpi.inputAsOf)}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
