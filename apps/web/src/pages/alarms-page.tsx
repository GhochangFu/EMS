import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";

import { ackAlarm, fetchAlarmsPage } from "../api/alarms";
import { alarmSeverityTone, summariseAlarmSeverities } from "../lib/alarm-severity";
import { AlarmSummaryCard } from "../components/alarm-summary-card";
import { AppShell } from "../layouts/app-shell";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { StatusPill } from "../components/status-pill";
import { useAuthStore, type AuthUser } from "../stores/auth-store";
import type { AlarmListItem, AlarmSocketEvent } from "@bms/shared";

type AlarmsPageProps = {
  user: AuthUser;
};

function socketBase(): string {
  return (
    import.meta.env.VITE_WS_URL ??
    import.meta.env.VITE_API_URL ??
    "http://localhost:4000"
  );
}

type AlarmSubsystem = "UPS" | "Battery" | "HVAC" | "IT" | "Security";

const alarmSubsystems: AlarmSubsystem[] = ["UPS", "Battery", "HVAC", "IT", "Security"];

function alarmSubsystem(alarm: AlarmListItem): AlarmSubsystem {
  const haystack = `${alarm.assetCode} ${alarm.assetName} ${alarm.message}`.toLowerCase();
  if (haystack.includes("batt")) {
    return "Battery";
  }
  if (haystack.includes("ups")) {
    return "UPS";
  }
  if (haystack.includes("hvac") || haystack.includes("crac") || haystack.includes("cool")) {
    return "HVAC";
  }
  if (
    haystack.includes("rack") ||
    haystack.includes("pdu") ||
    haystack.includes("server") ||
    haystack.includes("network") ||
    haystack.includes("videowall")
  ) {
    return "IT";
  }
  return "Security";
}

function matchesAlarmSearch(alarm: AlarmListItem, query: string): boolean {
  if (!query) {
    return true;
  }
  const state = alarm.acknowledgedAt ? "acknowledged" : "open active unack";
  const searchable = [
    alarm.severity,
    alarm.assetCode,
    alarm.assetName,
    alarm.siteName,
    alarm.message,
    state,
    alarmSubsystem(alarm),
  ]
    .join(" ")
    .toLowerCase();
  return searchable.includes(query);
}

export function AlarmsPage({ user }: AlarmsPageProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [ackTarget, setAckTarget] = useState<AlarmListItem | null>(null);
  const [reason, setReason] = useState("");
  const [ackError, setAckError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const accessToken = useAuthStore((state) => state.accessToken);

  const listQ = useInfiniteQuery({
    queryKey: ["alarms", "list"],
    queryFn: ({ pageParam }) => fetchAlarmsPage(pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  useEffect(() => {
    const socket: Socket = io(`${socketBase()}/ws/alarms`, {
      transports: ["websocket"],
      auth: { token: accessToken },
    });
    socket.on("alarm", (evt: AlarmSocketEvent) => {
      void evt;
      void qc.invalidateQueries({ queryKey: ["alarms", "list"] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "kpis"] });
    });
    return () => {
      socket.disconnect();
    };
  }, [accessToken, qc]);

  const ackM = useMutation({
    mutationFn: ({ id, r }: { id: string; r: string }) => ackAlarm(id, r),
    onSuccess: () => {
      setAckTarget(null);
      setReason("");
      setAckError(null);
      void qc.invalidateQueries({ queryKey: ["alarms", "list"] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "kpis"] });
    },
    onError: (e: Error) => {
      setAckError(e.message);
    },
  });

  const rows = listQ.data?.pages.flatMap((p) => p.items) ?? [];
  const searchQuery = search.trim().toLowerCase();
  const filteredRows = useMemo(
    () => rows.filter((alarm) => matchesAlarmSearch(alarm, searchQuery)),
    [rows, searchQuery],
  );
  const summary = useMemo(() => {
    const { critical, major, minor, unrecognised } = summariseAlarmSeverities(
      rows.map((alarm) => alarm.severity),
    );
    const active = rows.filter((alarm) => !alarm.acknowledgedAt).length;
    const acknowledged = rows.filter((alarm) => alarm.acknowledgedAt).length;
    const bySubsystem = alarmSubsystems.map((subsystem) => ({
      subsystem,
      count: rows.filter((alarm) => alarmSubsystem(alarm) === subsystem).length,
    }));
    return { critical, major, minor, unrecognised, active, acknowledged, bySubsystem };
  }, [rows]);
  const distributionTotal = Math.max(rows.length, 1);

  function submitAck(e: FormEvent): void {
    e.preventDefault();
    if (!ackTarget) {
      return;
    }
    setAckError(null);
    ackM.mutate({ id: ackTarget.id, r: reason.trim() });
  }

  function startWorkOrder(alarm: AlarmListItem): void {
    const params = new URLSearchParams({
      alarmId: alarm.id,
      assetId: alarm.assetId,
      title: `Investigate ${alarm.assetCode} alarm`,
      description: alarm.message,
    });
    navigate(`/work-orders?${params}`);
  }

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-bms-ink">
          Alarm Centre · live rows via WebSocket{" "}
          <code className="text-[10px] text-bms-muted">/ws/alarms</code>
        </span>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="R.alm"
          title="Alarm Centre"
          subtitle="Threshold rules run on telemetry in the API · acknowledgements are audited"
        />

        {/*
          Critical / Major / Minor are the mockup's names for the stored
          `critical` / `warning` / `info` (AGENTS.md §5). The sixth card is not
          in the mockup because the mockup has no way to draw a severity the
          product cannot classify — it appears only when one exists, so a clean
          board stays the five cards the reference shows. Without it, `F4.46`'s
          fix would move unrecognised rows out of `Minor` and into nothing at
          all, under-reporting the board instead of mis-reporting it.
        */}
        <div
          className={`grid gap-3 sm:grid-cols-2 ${
            summary.unrecognised > 0 ? "lg:grid-cols-6" : "lg:grid-cols-5"
          }`}
        >
          <AlarmSummaryCard label="Critical" value={summary.critical} tone="critical" emptyLabel="all clear" />
          <AlarmSummaryCard label="Major" value={summary.major} tone="warning" />
          <AlarmSummaryCard label="Minor" value={summary.minor} tone="info" />
          <AlarmSummaryCard label="Active (Unack)" value={summary.active} tone="ok" />
          <AlarmSummaryCard label="Acknowledged" value={summary.acknowledged} tone="ok" />
          {summary.unrecognised > 0 ? (
            <AlarmSummaryCard label="Unrecognised" value={summary.unrecognised} tone="offline" />
          ) : null}
        </div>

        <SectionCard
          title="Distribution by Subsystem"
          subtitle="Derived from current alarm asset and message context"
        >
          <div className="space-y-3">
            {summary.bySubsystem.map((item) => {
              const pct = Math.min(100, (item.count / distributionTotal) * 100);
              return (
                <div
                  key={item.subsystem}
                  className="grid grid-cols-[96px_minmax(0,1fr)_72px] items-center gap-4 text-sm sm:grid-cols-[120px_minmax(0,1fr)_84px]"
                >
                  <div className="truncate font-semibold text-bms-ink">{item.subsystem}</div>
                  <div className="min-w-0">
                    <div className="h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-bms-green"
                      style={{ width: `${pct}%` }}
                    />
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-right font-mono font-semibold text-bms-ink">
                    {item.count} / {rows.length}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {listQ.isLoading ? (
          <p className="text-sm text-bms-muted">Loading alarms…</p>
        ) : listQ.isError ? (
          <p className="text-sm text-red-600">Could not load alarms (auth?).</p>
        ) : (
          <SectionCard
            title="Alarm Grid"
            subtitle={`${filteredRows.length} of ${rows.length} loaded alarms shown`}
            actions={
              <label className="flex min-w-[260px] items-center gap-2 text-xs text-bms-muted">
                Search
                <input
                  className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-bms-ink"
                  placeholder="Asset, site, severity, subsystem..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            }
            bodyClassName="overflow-x-auto p-0"
          >
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                <tr>
                  <th className="px-3 py-2">Raised</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-bms-muted"
                    >
                      No alarms yet. Start the simulator — voltage or demand rules
                      will raise rows within a few seconds.
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-bms-muted"
                    >
                      No alarms match the current search.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((a) => (
                    <tr
                      key={a.id}
                      className={
                        a.acknowledgedAt
                          ? "border-b border-gray-50 bg-gray-50/60 text-bms-muted"
                          : "border-b border-gray-100"
                      }
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {new Date(a.raisedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill
                          label={a.severity}
                          tone={alarmSeverityTone(a.severity)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{a.assetCode}</div>
                        <div className="text-xs text-bms-muted">{a.assetName}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{a.siteName}</td>
                      <td className="max-w-xs px-3 py-2 text-xs">{a.message}</td>
                      <td className="px-3 py-2 text-xs">
                        {a.acknowledgedAt ? (
                          <span className="text-emerald-700">Acknowledged</span>
                        ) : (
                          <span className="font-medium text-bms-ink">Open</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="rounded border border-gray-300 px-2.5 py-1 text-xs font-semibold text-bms-ink hover:bg-gray-50"
                            onClick={() => startWorkOrder(a)}
                          >
                            Work order
                          </button>
                          {!a.acknowledgedAt ? (
                          <button
                            type="button"
                            className="rounded bg-bms-green px-2.5 py-1 text-xs font-semibold text-white hover:bg-bms-green-dark"
                            onClick={() => {
                              setAckTarget(a);
                              setReason("");
                              setAckError(null);
                            }}
                          >
                            Ack
                          </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </SectionCard>
        )}

        {listQ.hasNextPage ? (
          <button
            type="button"
            className="text-sm font-medium text-bms-green hover:underline"
            onClick={() => void listQ.fetchNextPage()}
            disabled={listQ.isFetchingNextPage}
          >
            {listQ.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>

      {ackTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ack-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 id="ack-title" className="font-condensed text-lg font-bold">
              Acknowledge alarm
            </h2>
            <p className="mt-1 text-xs text-bms-muted">{ackTarget.message}</p>
            <form className="mt-4 space-y-3" onSubmit={submitAck}>
              <div>
                <label className="text-xs font-medium text-bms-muted" htmlFor="reason">
                  Reason (required)
                </label>
                <textarea
                  id="reason"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  rows={3}
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                  placeholder="e.g. Verified at panel — transient spike"
                  required
                  minLength={3}
                />
              </div>
              {ackError ? (
                <p className="text-xs text-red-600" role="alert">
                  {ackError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded px-3 py-2 text-sm text-bms-muted hover:bg-gray-100"
                  onClick={() => setAckTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={ackM.isPending || reason.trim().length < 3}
                  className="rounded bg-bms-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {ackM.isPending ? "Saving…" : "Confirm ack"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
