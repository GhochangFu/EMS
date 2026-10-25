import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { WorkOrderListItem } from "@bms/shared";

import { closeWorkOrder } from "../../api/work-orders";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { operationsWizardEntry, reasonText, withTrimmedReason } from "../alarm-ack-wizard";
import { WizardShell } from "../wizard/wizard-shell";

export type WorkOrderCloseWizardProps = {
  row: WorkOrderListItem;
  /** A drop on the Done column sets the card's position there; the page's, never a fill's. */
  sortOrder?: number;
  onCancel: () => void;
  onDone: (row: WorkOrderListItem) => Promise<void> | void;
};

/**
 * `F4.284` (ADR 0099 decision 6; ADR 0106 decisions 3, 4) — a work order's Close on the
 * shared `WizardShell`: Reason → Review, the red `operational` card that says it cannot
 * be undone. Used by operators too; Submit sends the plain `POST /work-orders/:id/close`.
 */
export function WorkOrderCloseWizard({ row, sortOrder, onCancel, onDone }: WorkOrderCloseWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>(sortOrder === undefined ? {} : { sortOrder });
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => closeWorkOrder(row.id, String(body.reason ?? ""), sortOrder),
    onSuccess: async (updated) => onDone(updated),
  });
  const entry = operationsWizardEntry("workOrder.close");
  return (
    <AdminWizardFrame title="Close work order">
      <p className="text-xs text-ink-muted">{row.title}</p>
      <WizardShell
        entry={operationsWizardEntry("workOrder.close")}
        params={{ id: row.id }}
        fixedFields={["sortOrder"]}
        values={values}
        onChange={(next) => setValues(withTrimmedReason(sortOrder === undefined ? next : { ...next, sortOrder }, next.reason))}
        renderStep={() => (
          <label className={labelClass}>
            Closure reason
            <textarea
              className={fieldClass}
              rows={3}
              value={reasonText(draft, values)}
              maxLength={2000}
              onChange={(e) => {
                setDraft(e.target.value);
                setValues(withTrimmedReason(values, e.target.value));
              }}
            />
          </label>
        )}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        summary={entry.summary({
          body: values,
          params: { id: row.id },
          targetName: row.title,
          organizationName: "",
          workOrder: { title: row.title, status: row.status, assetName: row.assetName },
        })}
      />
    </AdminWizardFrame>
  );
}
