import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { ackAlarm, fetchAlarmsPage } from "../api/alarms";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";
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

function severityStyle(sev: string): string {
  switch (sev) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-200";
    case "warning":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "info":
      return "bg-sky-100 text-sky-900 border-sky-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

export function AlarmsPage({ user }: AlarmsPageProps) {
  const qc = useQueryClient();
  const [ackTarget, setAckTarget] = useState<AlarmListItem | null>(null);
  const [reason, setReason] = useState("");
  const [ackError, setAckError] = useState<string | null>(null);

  const listQ = useInfiniteQuery({
    queryKey: ["alarms", "list"],
    queryFn: ({ pageParam }) => fetchAlarmsPage(pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  useEffect(() => {
    const socket: Socket = io(`${socketBase()}/ws/alarms`, {
      transports: ["websocket"],
    });
    socket.on("alarm", (evt: AlarmSocketEvent) => {
      void evt;
      void qc.invalidateQueries({ queryKey: ["alarms", "list"] });
      void qc.invalidateQueries({ queryKey: ["dashboard", "kpis"] });
    });
    return () => {
      socket.disconnect();
    };
  }, [qc]);

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

  function submitAck(e: FormEvent): void {
    e.preventDefault();
    if (!ackTarget) {
      return;
    }
    setAckError(null);
    ackM.mutate({ id: ackTarget.id, r: reason.trim() });
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
        <header className="border-b border-gray-200 pb-4">
          <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
            Active alarms
          </h1>
          <p className="mt-1 text-sm text-bms-muted">
            Threshold rules run on telemetry in the API. Acknowledgements are
            audited.
          </p>
        </header>

        {listQ.isLoading ? (
          <p className="text-sm text-bms-muted">Loading alarms…</p>
        ) : listQ.isError ? (
          <p className="text-sm text-red-600">Could not load alarms (auth?).</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
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
                ) : (
                  rows.map((a) => (
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
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${severityStyle(a.severity)}`}
                        >
                          {a.severity}
                        </span>
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
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
