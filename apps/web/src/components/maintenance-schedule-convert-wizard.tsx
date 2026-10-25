import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ConvertMaintenanceResponse, MaintenanceScheduleItem } from "@bms/shared";

import { convertMaintenanceSchedule } from "../api/maintenance";
import { apiErrorMessage } from "../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "./admin/admin-wizard-frame";
import { maintenanceWizardEntry } from "./maintenance-schedule-wizard";
import { WizardShell } from "./wizard/wizard-shell";

export type MaintenanceScheduleConvertWizardProps = {
  item: MaintenanceScheduleItem;
  /** The notes the row used to send on its own; the user may change them. */
  defaultNotes: string;
  onCancel: () => void;
  onDone: (response: ConvertMaintenanceResponse) => Promise<void> | void;
};

/**
 * `F4.284` (ADR 0099 decision 6; ADR 0106 decision 5) — a schedule's "Generate WO" on
 * the shared `WizardShell`, replacing the row's direct call: Notes → Review. The route
 * makes a work order and moves the schedule's next due date on by one cycle. Used by
 * operators too; Submit sends the plain request (no `X-Copilot-Change`).
 */
export function MaintenanceScheduleConvertWizard({ item, defaultNotes, onCancel, onDone }: MaintenanceScheduleConvertWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>({ notes: defaultNotes });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      convertMaintenanceSchedule({ id: item.id, ...(typeof body.notes === "string" ? { notes: body.notes } : {}) }),
    onSuccess: async (response) => onDone(response),
  });
  const notes = typeof values.notes === "string" ? values.notes : "";
  return (
    <AdminWizardFrame title="Generate a work order">
      <WizardShell
        entry={maintenanceWizardEntry("maintenanceSchedule.convert")}
        params={{ id: item.id }}
        values={values}
        onChange={setValues}
        renderStep={() => (
          <label className={labelClass}>
            Notes (optional)
            <textarea
              aria-label="Notes"
              className={fieldClass}
              rows={3}
              value={notes}
              maxLength={2000}
              onChange={(e) => setValues({ ...values, notes: e.target.value === "" ? undefined : e.target.value })}
            />
          </label>
        )}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        summary={maintenanceWizardEntry("maintenanceSchedule.convert").summary({
          body: values,
          params: { id: item.id },
          targetName: item.title,
          organizationName: "",
          workOrder: { title: `Maintenance: ${item.title}`, status: "open", assetName: item.assetName },
        })}
      />
    </AdminWizardFrame>
  );
}
