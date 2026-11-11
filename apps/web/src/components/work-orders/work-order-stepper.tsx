import type { WorkOrderDetail, WorkOrderStatus } from "@bms/shared";

/** `E3.1` / ADR 0122 decision 8: one step of the five-step progress strip. */
export type WorkOrderStep = {
  key: "raised" | "created" | "assigned" | "in_progress" | "completed";
  label: string;
  state: "reached" | "current" | "pending" | "cancelled";
  at: string | null;
};

/** How many of the first four steps a ticket in this status has reached (`resolved` counts 4). */
const REACHED_BY_STATUS: Record<WorkOrderStatus, number> = {
  open: 2,
  assigned: 3,
  in_progress: 4,
  resolved: 4,
  closed: 5,
  cancelled: 2,
};

function firstEvent(detail: WorkOrderDetail, match: (e: WorkOrderDetail["events"][number]) => boolean): string | null {
  return detail.events.find(match)?.createdAt ?? null;
}

function firstStepLabel(detail: WorkOrderDetail): string {
  if (detail.alarmId !== null) {
    return "Alarm Triggered";
  }
  const created = detail.events.find((e) => e.eventType === "created");
  return created?.detail.origin === "schedule" ? "Scheduled maintenance" : "Raised manually";
}

/**
 * `E3.1` / ADR 0122 decision 8: the ticket's progress as five ordered steps. Which are
 * reached comes from the STATUS, never from the event list alone — a ticket older than
 * the events table has no events and must still draw.
 */
export function workOrderSteps(detail: WorkOrderDetail): WorkOrderStep[] {
  const cancelledEvent = detail.events.find((e) => e.eventType === "cancelled");
  const cancelled = detail.status === "cancelled";
  let reached = REACHED_BY_STATUS[detail.status];
  if (cancelled) {
    const from = cancelledEvent?.fromStatus ?? null;
    reached = from === null || from === "cancelled" ? 2 : Math.min(REACHED_BY_STATUS[from], 4);
  }
  const lastReached = Math.min(reached, 4);
  const closed = detail.status === "closed";
  const resolved = detail.status === "resolved";

  const stateAt = (n: number): WorkOrderStep["state"] => (n <= lastReached ? "reached" : "pending");

  const approvedAt = firstEvent(detail, (e) => e.eventType === "approved");
  let endAt: string | null = null;
  let endLabel = "Completed";
  let endState: WorkOrderStep["state"] = "pending";
  if (cancelled) {
    endState = "cancelled";
    endLabel = "Cancelled";
    endAt = cancelledEvent?.createdAt ?? detail.cancelledAt;
  } else if (closed) {
    endState = "reached";
    endAt = approvedAt ?? detail.closedAt;
  } else if (resolved) {
    endState = "current";
    endLabel = "Awaiting approval";
  }

  return [
    {
      key: "raised",
      label: firstStepLabel(detail),
      state: stateAt(1),
      at: detail.alarmId !== null ? (detail.alarm?.raisedAt ?? detail.createdAt) : detail.createdAt,
    },
    { key: "created", label: "Work Order Created", state: stateAt(2), at: detail.createdAt },
    {
      key: "assigned",
      label: "Assigned",
      state: stateAt(3),
      at: stateAt(3) === "reached" ? firstEvent(detail, (e) => e.eventType === "assigned" || e.toStatus === "assigned") : null,
    },
    {
      key: "in_progress",
      label: "In Progress",
      state: stateAt(4),
      at: stateAt(4) === "reached" ? firstEvent(detail, (e) => e.toStatus === "in_progress") : null,
    },
    { key: "completed", label: endLabel, state: endState, at: endAt },
  ];
}

const DOT_CLASS: Record<WorkOrderStep["state"], string> = {
  reached: "bg-ok-wash text-ok-ink border-line",
  current: "border-info-line bg-info-wash text-info-ink",
  pending: "bg-well-deep text-neutral-ink border-line",
  cancelled: "border-critical-line bg-critical-wash-strong text-critical-ink-strong",
};

/** `E3.1` / ADR 0122 decision 8: the ordered, labelled progress strip of the detail drawer. */
export function WorkOrderStepper({ detail }: { detail: WorkOrderDetail }) {
  const steps = workOrderSteps(detail);
  return (
    <ol aria-label="Work order progress" className="flex flex-col gap-2">
      {steps.map((step, index) => (
        <li
          key={step.key}
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
          className="flex items-center gap-2"
        >
          <span
            aria-hidden="true"
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-3xs ${DOT_CLASS[step.state]}`}
          >
            {index + 1}
          </span>
          <span className="text-xs text-ink">{step.label}</span>
          {step.at !== null ? (
            <span className="text-2xs text-ink-muted">{new Date(step.at).toLocaleString()}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
