import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { MaintenanceScheduleItem } from "@bms/shared";

import { updateMaintenanceSchedule } from "../api/maintenance";
import { apiErrorMessage } from "../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "./admin/admin-wizard-frame";
import { maintenanceWizardEntry } from "./maintenance-schedule-wizard";
import { WizardShell } from "./wizard/wizard-shell";

export type MaintenanceScheduleToggleWizardProps = {
  item: MaintenanceScheduleItem;
  onCancel: () => void;
  onDone: (item: MaintenanceScheduleItem) => Promise<void> | void;
};

/** `active` is the direction's, never the user's or a fill's (owner ruling DC1). */
const FIXED_FIELDS = ["active"] as const;

/**
 * `F4.281` (ADR 0099 decision 6, Amendment 8 D3, Q16; owner ruling DC1) — a
 * schedule's Deactivate or Activate on the shared `WizardShell`, replacing the
 * row's direct call: one entry per direction, Reason (optional) → Review, with
 * `active` fixed by the schedule's state (the opposite of it). Submit sends the
 * plain request (no `X-Copilot-Change`).
 */
export function MaintenanceScheduleToggleWizard({ item, onCancel, onDone }: MaintenanceScheduleToggleWizardProps) {
  const active = !item.active;
  const id = active ? "maintenanceSchedule.activate" : "maintenanceSchedule.deactivate";
  const [values, setValues] = useState<Record<string, unknown>>({ active });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      updateMaintenanceSchedule({
        id: item.id,
        active,
        ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
      }),
    onSuccess: async (row) => onDone(row),
  });
  const reason = typeof values.reason === "string" ? values.reason : "";
  const shared = {
    fixedFields: FIXED_FIELDS,
    values: { ...values, active },
    onChange: (next: Record<string, unknown>) => setValues({ ...next, active }),
    renderStep: () => (
      <label className={labelClass}>
        Reason (optional)
        <input
          aria-label="Reason"
          className={fieldClass}
          value={reason}
          maxLength={2000}
          onChange={(e) => setValues({ ...values, active, reason: e.target.value === "" ? undefined : e.target.value })}
        />
      </label>
    ),
    onSubmit: (body: Record<string, unknown>) => save.mutate(body),
    onCancel,
    submitting: save.isPending,
    submitError: save.error ? apiErrorMessage(save.error) : null,
    summary: maintenanceWizardEntry(id).summary({
      body: values,
      params: { id: item.id },
      targetName: item.title,
      organizationName: "",
    }),
  };
  return active ? (
    <AdminWizardFrame title="Activate a maintenance schedule">
      <WizardShell entry={maintenanceWizardEntry("maintenanceSchedule.activate")} {...shared} params={{ id: item.id }} />
    </AdminWizardFrame>
  ) : (
    <AdminWizardFrame title="Deactivate a maintenance schedule">
      <WizardShell entry={maintenanceWizardEntry("maintenanceSchedule.deactivate")} {...shared} params={{ id: item.id }} />
    </AdminWizardFrame>
  );
}
