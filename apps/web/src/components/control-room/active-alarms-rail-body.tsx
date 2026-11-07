import { useState } from "react";
import { Link } from "react-router-dom";

import { ASSET_LABEL_SEPARATOR, assetLabelParts } from "@bms/shared";
import type { AlarmListItem, AlarmSeverityCount, AlarmSeverityDto } from "@bms/shared";

import { alarmSeverityTone } from "../../lib/alarm-severity";
import { StatusPill } from "../status-pill";

/** The reference rail's row budget (`docs/ux/ion-exchange-reference-alignment.md`, page 10). */
export const RAIL_ROWS = 8;

type RailTab = "active" | "summary";

function tabClass(selected: boolean): string {
  return `surface-segment-item px-3 py-1.5 ${selected ? "surface-segment-item-selected" : ""}`;
}

function RailNote({ text }: { text: string }) {
  return (
    <div className="surface-pressed p-3 text-sm text-ink-muted">
      {text}
    </div>
  );
}

/** One read's state, as the body needs it: no answer yet, a failed answer, or the items. */
export type RailFeed<T> =
  | { status: "pending" | "error" }
  | { status: "ready"; items: readonly T[] };

export type ActiveAlarmsRailBodyProps = {
  /** The newest active alarms. The body keeps the first `rowBudget`. */
  active: RailFeed<AlarmListItem>;
  /** The active count per severity, in the API's ascending-rank order; the body reverses it. */
  summary: RailFeed<AlarmSeverityCount>;
  /** The summary tab's total — the server's own number, not a sum of `summary`. */
  total: number;
  severities: readonly AlarmSeverityDto[];
  /** Set when there is nothing to ask about; replaces both panels. */
  noIdsNote: string | null;
  /** The most alarm rows drawn. */
  rowBudget?: number;
  /** `F3.73` — `false` hides the Alarm Summary tab (the site widget's `showSummary`). */
  showSummary?: boolean;
};

/** `F4.316` (ADR 0111): the label's `· where` part — the RTU's name, or the location's without one. */
function whereOf(a: AlarmListItem): string | null {
  return assetLabelParts({ code: a.assetCode, rtuName: a.assetRtuName, locationName: a.assetLocationName }).where;
}

/** The wrapping `· where` span, or nothing when the asset has neither an RTU nor a location. */
function WhereSpan({ where }: { where: string | null }) {
  return where === null ? null : (
    <span className="whitespace-normal">
      {ASSET_LABEL_SEPARATOR}
      {where}
    </span>
  );
}

/**
 * The rail's whole drawing — tab strip, "View All" link and the two panels — with no read in it
 * (`F3.73` plan Task 3.5). `ActiveAlarmsRail` (`/cr-overview`, its own reads) and the
 * `active_alarms_rail` site widget (one site-widgets read) both feed it, so the two cannot
 * draw the same alarm differently. The caller owns the frame: a `<section>` or a `WidgetFrame`.
 *
 * Both panels gate on the feed's `pending` — no answer yet — rather than a fetching flag: a
 * paused read (offline) has not answered and must not fall through to "No active alarms".
 */

export function ActiveAlarmsRailBody({
  active,
  summary,
  total,
  severities,
  noIdsNote,
  rowBudget = RAIL_ROWS,
  showSummary = true,
}: ActiveAlarmsRailBodyProps) {
  const [chosen, setChosen] = useState<RailTab>("active");
  // A hidden Summary tab cannot stay selected: the config may change under a mounted body.
  const tab: RailTab = showSummary ? chosen : "active";
  const rows = active.status === "ready" ? active.items.slice(0, rowBudget) : [];
  const counts = summary.status === "ready" ? [...summary.items].reverse() : [];

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="surface-segment flex gap-2" role="tablist" aria-label="Alarms rail">
          <button type="button" role="tab" aria-selected={tab === "active"} className={tabClass(tab === "active")} onClick={() => setChosen("active")}>
            Active Alarms
          </button>
          {showSummary ? (
            <button type="button" role="tab" aria-selected={tab === "summary"} className={tabClass(tab === "summary")} onClick={() => setChosen("summary")}>
              Alarm Summary
            </button>
          ) : null}
        </div>
        <Link className="text-xs font-semibold text-accent-strong hover:underline" to="/alarms">
          View All
        </Link>
      </div>
      <div className="mt-3" role="tabpanel">
        {noIdsNote ? (
          <RailNote text={noIdsNote} />
        ) : tab === "active" ? (
          active.status === "pending" ? (
            <RailNote text="Loading alarms…" />
          ) : active.status === "error" ? (
            <RailNote text="Alarms unavailable." />
          ) : rows.length === 0 ? (
            <RailNote text="No active alarms" />
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-ink-muted">
                <tr>
                  <th className="py-1 pr-2 font-semibold">Time</th>
                  <th className="py-1 font-semibold">Alarm</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((alarm) => (
                  <tr key={alarm.id} className="border-t border-well-deep align-top">
                    <td className="whitespace-nowrap py-1.5 pr-2 font-mono">
                      {new Date(alarm.raisedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    {/*
                      F4.316 / ADR 0111: `<code> · <RTU or location>`; the where part wraps, never truncates.
                      The label, the message and the severity share one cell, the message and the pill on a
                      wrapping line under the label: four columns did not fit the 320px rail, and the pill drew
                      past the card's edge.
                    */}
                    <td className="min-w-0 py-1.5">
                      <div className="font-medium text-ink">
                        <span className="whitespace-nowrap">{alarm.assetCode}</span>
                        <WhereSpan where={whereOf(alarm)} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 break-words text-ink">{alarm.message}</span>
                        <StatusPill label={alarm.severity} tone={alarmSeverityTone(alarm.severity, severities)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : summary.status === "pending" ? (
          <RailNote text="Loading alarms…" />
        ) : summary.status === "error" ? (
          <RailNote text="Alarms unavailable." />
        ) : (
          <div className="text-sm">
            <ul className="space-y-2" aria-label="Active alarms by severity">
              {counts.map((row) => (
                <li key={row.code} className="flex items-center justify-between gap-3">
                  <StatusPill label={row.label} tone={row.tone} />
                  <span className="font-mono font-semibold text-ink">{row.count}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between gap-3 border-t border-well-deep pt-2">
              <span className="text-ink-muted">Total</span>
              <span data-testid="alarm-summary-total" className="font-mono font-semibold text-ink">
                {total}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
