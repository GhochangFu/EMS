import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { useActiveAlarms } from "../../hooks/use-active-alarms";
import { alarmSeverityTone } from "../../lib/alarm-severity";
import { StatusPill } from "../status-pill";

/** The reference rail's row budget (`docs/ux/ion-exchange-reference-alignment.md`, page 10). */
const RAIL_ROWS = 8;

type RailTab = "active" | "summary";

/** The page's asset read — TanStack's `status` for `GET /api/v1/assets`. */
export type AssetsStatus = "pending" | "success" | "error";

/** What the rail says when it has no ids, by why it has none. */
const NO_IDS_NOTE: Record<AssetsStatus, string> = {
  pending: "Loading alarms…",
  error: "Alarms unavailable.",
  success: "No assets in scope",
};

function tabClass(selected: boolean): string {
  return `rounded border px-3 py-1.5 text-xs font-semibold ${
    selected
      ? "border-bms-green bg-emerald-50 text-emerald-900"
      : "border-gray-200 bg-white text-bms-ink"
  }`;
}

function RailNote({ text }: { text: string }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-bms-muted">
      {text}
    </div>
  );
}

/**
 * The rail reads one of two scopes. `assetIds` is the `F3.28` pages' scope.
 * `organizationId` (`F3.66` step-5 fix) is the Control Room organization
 * page's: the API narrows by organization, intersected with the caller's
 * readable assets, so the page no longer sends every asset id against the
 * API's 200-id cap.
 */
export type ActiveAlarmsRailProps =
  | {
      assetIds: readonly string[];
      /**
       * The state of the page's asset read, which resolves `assetIds`. With no ids
       * the two reads are disabled, and a disabled query answers nothing — so
       * without this the rail would say "No active alarms" on every cold load,
       * before it has asked, and "Loading alarms…" forever after a failed read.
       */
      assetsStatus?: AssetsStatus;
      organizationId?: undefined;
    }
  | {
      organizationId: string;
      assetIds?: undefined;
      assetsStatus?: undefined;
    };

/**
 * The `/cr-overview` alarms rail (`F3.28`, ADR 0074 decision 4). It replaced
 * `ActiveRulesPanel`, which re-derived warnings from rules in the browser;
 * this reads the alarms the server raised, for the page's own assets, and
 * refreshes on `/ws/alarms` events.
 *
 * *Active Alarms* is the newest {@link RAIL_ROWS} active alarms, message
 * verbatim. *Alarm Summary* is the count per severity, most urgent first —
 * the API returns ascending rank, so the order is reversed here — then the
 * total.
 *
 * Both tabs gate on `isPending` — no answer yet — rather than `isLoading`,
 * which is `isPending && isFetching`: a paused read (offline) is pending but
 * not fetching, and would otherwise fall through to "No active alarms".
 */
export function ActiveAlarmsRail(props: ActiveAlarmsRailProps) {
  const { assetsStatus = "success" } = props;
  const [tab, setTab] = useState<RailTab>("active");
  const { active, summary } = useActiveAlarms(
    props.organizationId !== undefined ? { organizationId: props.organizationId } : props.assetIds,
  );
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });
  const severities = vocabQ.data?.alarmSeverities ?? [];
  const rows = (active.data?.items ?? []).slice(0, RAIL_ROWS);
  const counts = [...(summary.data?.items ?? [])].reverse();
  // With no ids nothing is fetched: say why, never "No active alarms". The
  // organization scope needs no ids, so it never shows this note.
  const noIdsNote =
    props.organizationId !== undefined || props.assetIds.length > 0 ? null : NO_IDS_NOTE[assetsStatus];

  return (
    <section aria-label="Alarms" className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2" role="tablist" aria-label="Alarms rail">
          <button type="button" role="tab" aria-selected={tab === "active"} className={tabClass(tab === "active")} onClick={() => setTab("active")}>
            Active Alarms
          </button>
          <button type="button" role="tab" aria-selected={tab === "summary"} className={tabClass(tab === "summary")} onClick={() => setTab("summary")}>
            Alarm Summary
          </button>
        </div>
        <Link className="text-xs font-semibold text-bms-green hover:underline" to="/alarms">
          View All
        </Link>
      </div>
      <div className="mt-3" role="tabpanel">
        {noIdsNote ? (
          <RailNote text={noIdsNote} />
        ) : tab === "active" ? (
          active.isPending ? (
            <RailNote text="Loading alarms…" />
          ) : active.isError ? (
            <RailNote text="Alarms unavailable." />
          ) : rows.length === 0 ? (
            <RailNote text="No active alarms" />
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-bms-muted">
                <tr>
                  <th className="py-1 pr-2 font-semibold">Time</th>
                  <th className="py-1 pr-2 font-semibold">Asset</th>
                  <th className="py-1 pr-2 font-semibold">Alarm</th>
                  <th className="py-1 font-semibold">Severity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((alarm) => (
                  <tr key={alarm.id} className="border-t border-gray-100 align-top">
                    <td className="whitespace-nowrap py-1.5 pr-2 font-mono">
                      {new Date(alarm.raisedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-1.5 pr-2 font-medium text-bms-ink">{alarm.assetCode}</td>
                    <td className="py-1.5 pr-2 text-bms-ink">{alarm.message}</td>
                    <td className="py-1.5">
                      <StatusPill label={alarm.severity} tone={alarmSeverityTone(alarm.severity, severities)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : summary.isPending ? (
          <RailNote text="Loading alarms…" />
        ) : summary.isError ? (
          <RailNote text="Alarms unavailable." />
        ) : (
          <div className="text-sm">
            <ul className="space-y-2" aria-label="Active alarms by severity">
              {counts.map((row) => (
                <li key={row.code} className="flex items-center justify-between gap-3">
                  <StatusPill label={row.label} tone={row.tone} />
                  <span className="font-mono font-semibold text-bms-ink">{row.count}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between gap-3 border-t border-gray-100 pt-2">
              <span className="text-bms-muted">Total</span>
              <span data-testid="alarm-summary-total" className="font-mono font-semibold text-bms-ink">
                {summary.data.total}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
