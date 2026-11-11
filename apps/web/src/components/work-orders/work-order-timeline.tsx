import type { WorkOrderEventDto, WorkOrderEventType } from "@bms/shared";

import { statusLabels } from "./work-order-labels";

const EVENT_LABELS: Record<WorkOrderEventType, string> = {
  created: "Created",
  assigned: "Assigned",
  status_changed: "Status changed",
  task_updated: "Checklist updated",
  root_cause_set: "Root cause recorded",
  resolved: "Resolved",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  sla_changed: "SLA changed",
};

function eventLabel(event: WorkOrderEventDto): string {
  const base = EVENT_LABELS[event.eventType];
  if (event.eventType === "status_changed" && event.fromStatus !== null && event.toStatus !== null) {
    return `${base} · ${statusLabels[event.fromStatus]} → ${statusLabels[event.toStatus]}`;
  }
  return base;
}

/** `E3.1` / ADR 0122 decisions 7 and 8: the ticket's history, oldest first as given. */
export function WorkOrderTimeline({ events }: { events: WorkOrderEventDto[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-ink-muted">No history recorded for this work order.</p>;
  }
  return (
    <ul aria-label="Work order timeline" className="flex flex-col gap-2">
      {events.map((event) => (
        <li key={event.id} className="surface-raised-sm flex flex-col gap-0.5 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink">{eventLabel(event)}</span>
            {event.eventType === "approved" && event.detail.selfApproved === true ? (
              <span className="rounded-full border border-warning-line bg-warning-wash-strong px-2 text-3xs text-warning-ink">
                Self-approved
              </span>
            ) : null}
          </div>
          <div className="text-2xs text-ink-muted">
            {event.actorName ?? "System"} · {new Date(event.createdAt).toLocaleString()}
          </div>
          {event.detail.reason !== undefined ? <p className="text-2xs text-ink">{event.detail.reason}</p> : null}
        </li>
      ))}
    </ul>
  );
}
