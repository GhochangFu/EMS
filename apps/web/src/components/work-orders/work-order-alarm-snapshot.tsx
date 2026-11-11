import type { WorkOrderAlarmSnapshot as Snapshot } from "@bms/shared";

const NOT_RECORDED = "Not recorded";

/**
 * `E3.1` / ADR 0122 decision 5a: the alarm's enrichment as it stood when the ticket was
 * created, read-only. It is not the technician's findings. Null renders nothing.
 */
export function WorkOrderAlarmSnapshot({ snapshot }: { snapshot: Snapshot | null }) {
  if (snapshot === null) {
    return null;
  }
  const rows: Array<[string, string]> = [
    ["Root cause", snapshot.rootCause ?? NOT_RECORDED],
    ["Corrective actions", snapshot.correctiveActions ?? NOT_RECORDED],
    ["Skill", snapshot.skillCode ?? NOT_RECORDED],
    ["Estimated restore", snapshot.etrAt === null ? NOT_RECORDED : new Date(snapshot.etrAt).toLocaleString()],
  ];
  return (
    <section aria-label="From the alarm" className="surface-raised-sm flex flex-col gap-2 p-3">
      <h3 className="text-xs text-ink">From the alarm</h3>
      <p className="text-2xs text-ink-muted">As recorded on the alarm when this work order was created.</p>
      <dl className="flex flex-col gap-1">
        {rows.map(([term, value]) => (
          <div key={term} className="flex flex-col">
            <dt className="text-3xs text-ink-muted">{term}</dt>
            <dd className="text-xs text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
