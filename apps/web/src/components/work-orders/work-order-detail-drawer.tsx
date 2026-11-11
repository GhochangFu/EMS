import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserRole, WorkOrderStatus } from "@bms/shared";

import { fetchWorkOrderDetail } from "../../api/work-orders";
import { apiErrorMessage } from "../../lib/api-error-message";
import { WorkOrderAlarmSnapshot } from "./work-order-alarm-snapshot";
import { WorkOrderCancelForm } from "./work-order-cancel-form";
import { WorkOrderChecklist } from "./work-order-checklist";
import { priorityLabels, statusLabels, workOrderReferenceLabel } from "./work-order-labels";
import { WorkOrderRejectForm } from "./work-order-reject-form";
import { WorkOrderRootCauseForm } from "./work-order-root-cause-form";
import { WorkOrderSlaChip } from "./work-order-sla-chip";
import { WorkOrderStepper } from "./work-order-stepper";
import { WorkOrderTimeline } from "./work-order-timeline";

export type WorkOrderDetailDrawerProps = {
  workOrderId: string;
  /** The signed-in user's role: a `viewer` reads; an approver also sees reject and cancel. */
  role: UserRole;
  onClose: () => void;
};

/** The query key of one ticket's detail read; the status wizard reads the same one. */
export const workOrderDetailQueryKey = (id: string) => ["work-order", id] as const;

/** A checklist is locked once the ticket is resolved, closed or cancelled (the API answers 409). */
const CHECKLIST_LOCKED: readonly WorkOrderStatus[] = ["resolved", "closed", "cancelled"];
/** The root cause is locked once the ticket is closed or cancelled (the API answers 409). */
const ROOT_CAUSE_LOCKED: readonly WorkOrderStatus[] = ["closed", "cancelled"];

/**
 * `E3.1` (ADR 0122 decisions 4, 5, 5a, 6, 7 and 8; plan PR 6) — one work order, in a
 * drawer on `/work-orders`: its reference and SLA, the five-step lifecycle, the
 * checklist, the root cause, what the alarm said when the ticket was made, the
 * approver's reject and cancel, and the timeline.
 *
 * It reads `GET /work-orders/:id` and holds no copy: every write inside it refreshes
 * that read and the board's list. The page opens it from `?workOrder=<id>`, so a reload
 * reopens the same ticket. There is no `ESKOM_SMOC.html` screen for it (AGENTS.md §5);
 * the SOW reference layout is the visual source.
 */
export function WorkOrderDetailDrawer({ workOrderId, role, onClose }: WorkOrderDetailDrawerProps) {
  const queryClient = useQueryClient();
  const detailQ = useQuery({ queryKey: workOrderDetailQueryKey(workOrderId), queryFn: () => fetchWorkOrderDetail(workOrderId) });
  const detail = detailQ.data;
  // A viewer has no operations write: the two forms are shown read-only, as the routes would refuse them.
  const canWrite = role !== "viewer";

  /** After a write inside the drawer: this ticket's read and the board's list are both stale. */
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workOrderDetailQueryKey(workOrderId) }),
      queryClient.invalidateQueries({ queryKey: ["work-orders", "list"] }),
    ]);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-scrim/40" role="dialog" aria-modal="true" aria-labelledby="work-order-drawer-title">
      <div className="h-full w-full max-w-2xl overflow-y-auto surface-dialog p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-2xs text-ink-muted">{detail ? workOrderReferenceLabel(detail.reference) : "Work order"}</p>
            <h2 id="work-order-drawer-title" className="font-condensed text-lg font-bold text-ink">
              {detail ? detail.title : "Work order"}
            </h2>
          </div>
          <button type="button" className="text-sm text-ink-muted hover:text-ink" onClick={onClose}>
            Close details
          </button>
        </div>

        {detailQ.isLoading ? (
          <p className="mt-4 text-sm text-ink-muted">Loading work order…</p>
        ) : detailQ.isError || !detail ? (
          <p className="mt-4 text-sm text-critical-ink" role="alert">
            Could not load this work order: {apiErrorMessage(detailQ.error)}
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-2xs">
              <span className="rounded border border-line bg-canvas px-2 py-0.5 font-bold uppercase text-ink">{statusLabels[detail.status]}</span>
              <span className="rounded border border-line bg-canvas px-2 py-0.5 font-bold uppercase text-ink-muted">
                {priorityLabels[detail.priority]}
              </span>
              <WorkOrderSlaChip slaMinutes={detail.slaMinutes} slaState={detail.slaState} />
            </div>

            <WorkOrderStepper detail={detail} />

            <section aria-label="Work order summary" className="text-xs text-ink-muted">
              <p className="text-sm text-ink">{detail.description ?? "No description"}</p>
              <p className="mt-2">
                {detail.assetCode} · {detail.assetName} · {detail.siteName}
              </p>
              {detail.alarm ? (
                <p className="mt-1">
                  Raised from alarm: {detail.alarm.message} ({detail.alarm.severity})
                </p>
              ) : null}
            </section>

            <WorkOrderChecklist
              workOrderId={detail.id}
              tasks={detail.tasks}
              readOnly={!canWrite || CHECKLIST_LOCKED.includes(detail.status)}
              onChanged={refresh}
            />

            <WorkOrderRootCauseForm
              // Remount when the SAVED findings or the status change, so the fields start from
              // what the server now holds — and never on another write (a checklist tick
              // also moves `updatedAt`), which would wipe what is being typed.
              key={[detail.rootCause, detail.correctiveAction, detail.preventiveAction, detail.causeCode, detail.status].join("|")}
              workOrderId={detail.id}
              detail={detail}
              readOnly={!canWrite || ROOT_CAUSE_LOCKED.includes(detail.status)}
              onSaved={refresh}
            />

            <WorkOrderAlarmSnapshot snapshot={detail.alarmSnapshot} />

            <WorkOrderRejectForm row={detail} role={role} onDone={refresh} />
            <WorkOrderCancelForm row={detail} role={role} onDone={refresh} />

            <section aria-label="History">
              <h3 className="text-2xs font-bold uppercase tracking-wide text-ink-muted">History</h3>
              <WorkOrderTimeline events={detail.events} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
