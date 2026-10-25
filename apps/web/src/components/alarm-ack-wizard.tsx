import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { AlarmListItem } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { ackAlarm } from "../api/alarms";
import { apiErrorMessage } from "../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "./admin/admin-wizard-frame";
import { WizardShell } from "./wizard/wizard-shell";

/** The catalog entry an operations wizard submits (`@bms/shared/copilot`), or a loud failure. */
export function operationsWizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.284: the catalog has no entry "${id}"`);
  return entry;
}

/**
 * `values` with `reason` set to `text` trimmed (left off when blank), so Next, Review and Submit
 * all check and send the same reason the route stores — the old dialog's `trim().length >= 3`.
 */
export function withTrimmedReason(values: Record<string, unknown>, text: unknown): Record<string, unknown> {
  const rest = { ...values };
  delete rest.reason;
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed === "" ? rest : { ...rest, reason: trimmed };
}

/** The reason box's text: what was typed while it trims to the stored reason, else the stored one (a fill). */
export function reasonText(draft: string, values: Record<string, unknown>): string {
  const reason = typeof values.reason === "string" ? values.reason : "";
  return draft.trim() === reason ? draft : reason;
}

export type AlarmAckWizardProps = {
  alarm: AlarmListItem;
  onCancel: () => void;
  onDone: (alarm: AlarmListItem) => Promise<void> | void;
};

/**
 * `F4.284` (ADR 0099 decision 6; ADR 0106 decisions 3, 4; owner ruling Q9) — the
 * alarms page's Ack on the shared `WizardShell`: Reason → Review, the red
 * `operational` card that says it cannot be undone. Used by operators too; Submit
 * sends the plain request (no `X-Copilot-Change`). The dialog keeps the old name
 * ("Acknowledge alarm") and the reason box its `#reason` id, so the e2e path holds.
 */
export function AlarmAckWizard({ alarm, onCancel, onDone }: AlarmAckWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => ackAlarm(alarm.id, String(body.reason ?? "")),
    onSuccess: async (row) => onDone(row),
  });
  return (
    <AdminWizardFrame title="Acknowledge alarm">
      <p className="text-xs text-ink-muted">{alarm.message}</p>
      <WizardShell
        entry={operationsWizardEntry("alarm.acknowledge")}
        params={{ id: alarm.id }}
        values={values}
        onChange={(next) => setValues(withTrimmedReason(next, next.reason))}
        renderStep={() => (
          <label className={labelClass} htmlFor="reason">
            Reason (required)
            <textarea
              id="reason"
              className={fieldClass}
              rows={3}
              value={reasonText(draft, values)}
              maxLength={2000}
              placeholder="e.g. Verified at panel — transient spike"
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
        summary={operationsWizardEntry("alarm.acknowledge").summary({
          body: values,
          params: { id: alarm.id },
          targetName: alarm.assetName,
          organizationName: "",
          alarm: { message: alarm.message, severity: alarm.severity, assetName: alarm.assetName, raisedAt: alarm.raisedAt },
        })}
      />
    </AdminWizardFrame>
  );
}
