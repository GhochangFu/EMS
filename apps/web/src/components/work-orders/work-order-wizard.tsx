import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { WorkOrderListItem } from "@bms/shared";

import type { AssetRow } from "../../api/assets";
import { createWorkOrder, fetchWorkOrderChecklistTemplates, type CreateWorkOrderInput } from "../../api/work-orders";
import { toLocalDateTimeInputValue } from "../../lib/alarm-details";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { operationsWizardEntry } from "../alarm-ack-wizard";
import { WizardShell } from "../wizard/wizard-shell";
import { priorities, priorityLabels } from "./work-order-labels";

export type WorkOrderWizardProps = {
  assets: readonly AssetRow[];
  /** The values the page opens with (an alarm's "Create work order" link sets the asset, alarm and title). */
  initial: Record<string, unknown>;
  onCancel: () => void;
  onDone: (row: WorkOrderListItem) => Promise<void> | void;
};

const text = (values: Record<string, unknown>, key: string): string => (typeof values[key] === "string" ? (values[key] as string) : "");
/** An empty box leaves the field out, so Review asks for a required one rather than sending "". */
const orNothing = (value: string): string | undefined => (value === "" ? undefined : value);

/**
 * `F4.284` (ADR 0099 decision 6; ADR 0106 decision 2) — the board's "+ New WO" on the
 * shared `WizardShell`: Work → Assignment → Review. Used by operators too; Submit sends
 * the plain `POST /work-orders` (no `X-Copilot-Change`). A linked alarm is the page's
 * (`fixedFields`), so a copilot fill never changes it.
 */
export function WorkOrderWizard({ assets, initial, onCancel, onDone }: WorkOrderWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>({ priority: "medium", ...initial });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => createWorkOrder(body as CreateWorkOrderInput),
    onSuccess: async (row) => onDone(row),
  });
  const set = (key: string, value: unknown) => setValues({ ...values, [key]: value });
  const assetId = text(values, "assetId");
  // `E3.1` (ADR 0122 decision 4.3, ruling P6): the active checklist templates that fit the
  // chosen asset. The pick is the page's own field (`clientOnly` in the catalog, ruling P4):
  // a copilot fill never sets it.
  const templates = useQuery({
    queryKey: ["work-order-checklist-templates", assetId],
    queryFn: () => fetchWorkOrderChecklistTemplates(assetId),
    enabled: assetId !== "",
    staleTime: 60_000,
  });
  const pickedTemplate = templates.data?.items.find((template) => template.id === values.checklistTemplateId);
  /** A template belongs to the asset it was listed for: a new asset drops the pick. */
  const setAsset = (next: string | undefined) => setValues({ ...values, assetId: next, checklistTemplateId: undefined });
  const due = text(values, "dueAt");
  const entry = operationsWizardEntry("workOrder.create");
  const asset = assets.find((candidate) => candidate.id === values.assetId);
  return (
    <AdminWizardFrame title="Create work order">
      {/* The catalog's Review summary does not know a `clientOnly` field, so the pick is named here, on every step. */}
      {pickedTemplate ? <p className="text-xs text-ink-muted">Checklist: {pickedTemplate.name}</p> : null}
      <WizardShell
        entry={operationsWizardEntry("workOrder.create")}
        params={{}}
        fixedFields={typeof initial.alarmId === "string" ? ["alarmId"] : []}
        values={values}
        onChange={setValues}
        renderStep={(step) =>
          step.id === "work" ? (
            <>
              <label className={labelClass}>
                Asset
                <select className={fieldClass} value={text(values, "assetId")} onChange={(e) => setAsset(orNothing(e.target.value))}>
                  <option value="">Select an asset</option>
                  {assets.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.code} · {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Title
                <input className={fieldClass} value={text(values, "title")} maxLength={255} onChange={(e) => set("title", orNothing(e.target.value))} />
              </label>
              <label className={labelClass}>
                Description
                <textarea
                  className={fieldClass}
                  rows={3}
                  value={text(values, "description")}
                  maxLength={4000}
                  onChange={(e) => set("description", orNothing(e.target.value))}
                />
              </label>
              <label className={labelClass}>
                Priority
                <select className={fieldClass} value={text(values, "priority")} onChange={(e) => set("priority", e.target.value)}>
                  {priorities.map((item) => (
                    <option key={item} value={item}>
                      {priorityLabels[item]}
                    </option>
                  ))}
                </select>
              </label>
              {(templates.data?.items.length ?? 0) > 0 ? (
                <label className={labelClass}>
                  Checklist template (optional)
                  <select
                    className={fieldClass}
                    value={text(values, "checklistTemplateId")}
                    onChange={(e) => set("checklistTemplateId", orNothing(e.target.value))}
                  >
                    <option value="">No checklist</option>
                    {templates.data?.items.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({template.items.length} {template.items.length === 1 ? "item" : "items"})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {typeof values.alarmId === "string" ? (
                <p className="rounded bg-canvas px-3 py-2 font-mono text-2xs text-ink-muted">Linked alarm: {values.alarmId}</p>
              ) : null}
            </>
          ) : (
            <>
              <label className={labelClass}>
                Assignee user id (optional)
                <input className={fieldClass} value={text(values, "assignedTo")} onChange={(e) => set("assignedTo", orNothing(e.target.value.trim()))} />
              </label>
              <label className={labelClass}>
                Due (optional)
                <input
                  type="datetime-local"
                  className={fieldClass}
                  value={due ? toLocalDateTimeInputValue(due) : ""}
                  onChange={(e) => set("dueAt", e.target.value ? new Date(e.target.value).toISOString() : undefined)}
                />
              </label>
            </>
          )
        }
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        summary={entry.summary({ body: values, params: {}, targetName: asset ? asset.name : "an asset", organizationName: "your organization" })}
      />
    </AdminWizardFrame>
  );
}
