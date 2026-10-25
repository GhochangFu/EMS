import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type {
  MaintenanceGenerationMode,
  MaintenanceScheduleCategory,
  MaintenanceScheduleItem,
  WorkOrderPriority,
} from "@bms/shared";
import {
  maintenanceGenerationModeSchema,
  maintenanceScheduleCategorySchema,
  workOrderPrioritySchema,
} from "@bms/shared/contracts";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import type { AssetRow } from "../api/assets";
import { createMaintenanceSchedule, type CreateMaintenanceScheduleInput } from "../api/maintenance";
import { apiErrorMessage } from "../lib/api-error-message";
import {
  MAINTENANCE_CATEGORY_LABELS,
  MAINTENANCE_GENERATION_MODE_LABELS,
  WORK_ORDER_PRIORITY_LABELS,
} from "../lib/maintenance-labels";
import { AdminWizardFrame, fieldClass, labelClass, numberOf } from "./admin/admin-wizard-frame";
import { WizardShell } from "./wizard/wizard-shell";

/** The catalog entry, or a build defect (the `rule-lifecycle-wizard.tsx` rule). */
export function maintenanceWizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.281: the catalog has no entry "${id}"`);
  return entry;
}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");
const numberText = (value: unknown): string => (typeof value === "number" ? String(value) : "");
/** An optional text field: `undefined` when blank, so the strict body leaves it out. */
const optionalText = (text: string): string | undefined => (text.trim() === "" ? undefined : text);

/** The local calendar day of an instant, as a date input shows it (`yyyy-mm-dd`). */
function localDateOf(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The first due instant: 09:00 local on the picked day (the form's rule before the stepper). */
function firstDueAtOf(day: string): string | undefined {
  if (day === "") return undefined;
  const date = new Date(`${day}T09:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function initialValues(assetOptions: readonly AssetRow[]): Record<string, unknown> {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return {
    assetId: assetOptions[0]?.id,
    title: "",
    category: "preventive",
    generationMode: "calendar",
    priority: "medium",
    intervalDays: 30,
    firstDueAt: firstDueAtOf(localDateOf(tomorrow.toISOString())),
    estimatedMinutes: 60,
    safetyCritical: false,
  };
}

export type MaintenanceScheduleWizardProps = {
  assetOptions: readonly AssetRow[];
  onCancel: () => void;
  onDone: (item: MaintenanceScheduleItem) => Promise<void> | void;
};

/**
 * `F4.281` (ADR 0099 decision 6, Amendment 8 Q16) — the Schedule Centre's
 * create form on the shared `WizardShell`: `maintenanceSchedule.create`,
 * Schedule → Cycle → Details → Review. The values are the route's own body
 * keys, so a copilot `fill_step` lands in these inputs. Submit sends the plain
 * request (no `X-Copilot-Change`). Every role the route admits uses it.
 */
export function MaintenanceScheduleWizard({ assetOptions, onCancel, onDone }: MaintenanceScheduleWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(assetOptions));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => createMaintenanceSchedule(body as CreateMaintenanceScheduleInput),
    onSuccess: async (item) => onDone(item),
  });
  const set = (key: string, value: unknown) => setValues({ ...values, [key]: value });
  const assetName = assetOptions.find((asset) => asset.id === values.assetId)?.name ?? "the asset";

  const scheduleStep = (
    <>
      <label className={labelClass}>
        Asset
        <select className={fieldClass} value={textOf(values.assetId)} onChange={(e) => set("assetId", optionalText(e.target.value))}>
          <option value="" disabled>
            Select an asset
          </option>
          {assetOptions.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.code} · {asset.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Schedule title
        <input className={fieldClass} value={textOf(values.title)} maxLength={255} onChange={(e) => set("title", e.target.value)} />
      </label>
      <label className={labelClass}>
        Description
        <textarea
          className={`${fieldClass} min-h-20`}
          value={textOf(values.description)}
          maxLength={4000}
          onChange={(e) => set("description", optionalText(e.target.value))}
        />
      </label>
      <label className={labelClass}>
        Category
        <select className={fieldClass} value={textOf(values.category)} onChange={(e) => set("category", e.target.value)}>
          {maintenanceScheduleCategorySchema.options.map((category: MaintenanceScheduleCategory) => (
            <option key={category} value={category}>
              {MAINTENANCE_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Generation mode
        <select className={fieldClass} value={textOf(values.generationMode)} onChange={(e) => set("generationMode", e.target.value)}>
          {maintenanceGenerationModeSchema.options.map((mode: MaintenanceGenerationMode) => (
            <option key={mode} value={mode}>
              {MAINTENANCE_GENERATION_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Priority
        <select className={fieldClass} value={textOf(values.priority)} onChange={(e) => set("priority", e.target.value)}>
          {workOrderPrioritySchema.options.map((priority: WorkOrderPriority) => (
            <option key={priority} value={priority}>
              {WORK_ORDER_PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  const cycleStep = (
    <>
      <label className={labelClass}>
        Interval days
        <input
          type="number"
          min={1}
          max={730}
          className={fieldClass}
          value={numberText(values.intervalDays)}
          onChange={(e) => set("intervalDays", numberOf(e.target.value))}
        />
      </label>
      <label className={labelClass}>
        First due date
        <input
          type="date"
          className={fieldClass}
          value={localDateOf(values.firstDueAt)}
          onChange={(e) => set("firstDueAt", firstDueAtOf(e.target.value))}
        />
      </label>
      <label className={labelClass}>
        Estimated minutes
        <input
          type="number"
          min={5}
          max={1440}
          className={fieldClass}
          value={numberText(values.estimatedMinutes)}
          onChange={(e) => set("estimatedMinutes", numberOf(e.target.value))}
        />
      </label>
    </>
  );

  const detailsStep = (
    <>
      <label className={labelClass}>
        Owner team
        <input className={fieldClass} value={textOf(values.ownerTeam)} maxLength={128} onChange={(e) => set("ownerTeam", optionalText(e.target.value))} />
      </label>
      <label className={labelClass}>
        Vendor / AMC
        <input className={fieldClass} value={textOf(values.vendorName)} maxLength={128} onChange={(e) => set("vendorName", optionalText(e.target.value))} />
      </label>
      <label className={labelClass}>
        Compliance ref
        <input
          className={fieldClass}
          value={textOf(values.complianceRef)}
          maxLength={128}
          onChange={(e) => set("complianceRef", optionalText(e.target.value))}
        />
      </label>
      <label className={labelClass}>
        Trigger summary
        <textarea
          className={`${fieldClass} min-h-16`}
          value={textOf(values.triggerSummary)}
          maxLength={2000}
          placeholder="Example: Generate after 500 fan runtime hours, or when CRAC filter pressure trend degrades."
          onChange={(e) => set("triggerSummary", optionalText(e.target.value))}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={values.safetyCritical === true} onChange={(e) => set("safetyCritical", e.target.checked)} />
        Safety-critical
      </label>
    </>
  );

  return (
    <AdminWizardFrame title="Create maintenance schedule">
      <WizardShell
        entry={maintenanceWizardEntry("maintenanceSchedule.create")}
        params={{}}
        values={values}
        onChange={setValues}
        renderStep={(step) => (step.id === "schedule" ? scheduleStep : step.id === "cycle" ? cycleStep : detailsStep)}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        summary={maintenanceWizardEntry("maintenanceSchedule.create").summary({
          body: values,
          params: {},
          targetName: assetName,
          organizationName: "its organization",
        })}
      />
    </AdminWizardFrame>
  );
}
