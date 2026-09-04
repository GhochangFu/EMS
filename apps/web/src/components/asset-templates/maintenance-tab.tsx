/**
 * The Maintenance tab (`F2.19`, ADR 0038 Amendment 5 Part B).
 *
 * Wiring only. The rules are `src/lib/template-maintenance-form.ts`; the write
 * goes through Unit 6's `mergeTemplateContent`, whose fourth arm this tab is
 * the first caller of.
 *
 * ## These are class-level plans. Nothing here schedules work
 *
 * A `content.maintenance` entry is the maintenance standard an asset *class*
 * ships with. It becomes a `bms.maintenance_task_templates` row only once an
 * asset exists — that table's `asset_id` is `NOT NULL` — and this feature
 * materialises none. Saving this tab creates, changes and removes no schedule
 * and no work order. The banner says so on screen, as an instruction rather
 * than a disclaimer, for the reason `alarms-tab.tsx` records: a negative gives
 * an author nothing to act on, and a maintenance screen that looks like it has
 * booked an inspection while nothing is scheduled is the misreading here that
 * has a consequence.
 *
 * `maintenance-schedules-panel.tsx` is a different entity and not this surface.
 * Its "templates" are maintenance *schedule* templates that generate work
 * orders against a real asset. The two share the three vocabularies and their
 * labels (`lib/maintenance-labels.ts`) and nothing else.
 *
 * ## Three vocabularies, all three closed, none of them fetched
 *
 * `category`, `generationMode` and `priority` are `z.enum`s in the shared
 * contract, not rows behind `GET /api/v1/vocabularies` — that payload carries
 * none of the three. So this tab has **no `useQuery`**, unlike `alarms-tab.tsx`
 * where severity, category and skill are all rows. Each select still offers a
 * stored non-member as "(retired)", exactly as the Alarms tab does: a select
 * bound to a value it does not offer would silently show the author a different
 * plan from the one that is stored.
 *
 * ## No `<details>`, anywhere, deliberately
 *
 * `F2.20` exists because closed `<details>` content is absent from `innerText`
 * altogether, which is how `E5.3`'s first browser pass reported a present
 * feature as missing. A maintenance card is long and the temptation to collapse
 * its lower half is real; `maintenance-tab.spec.tsx` asserts there is no
 * `<details>` in the read-only render so that temptation fails a test rather
 * than shipping.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AdminAssetTemplateDto, TemplateMaintenancePlan } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  MAINTENANCE_CATEGORY_LABELS,
  MAINTENANCE_GENERATION_MODE_LABELS,
  WORK_ORDER_PRIORITY_LABELS,
} from "../../lib/maintenance-labels";
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_GENERATION_MODES,
  MAINTENANCE_PRIORITIES,
  MAX_MAINTENANCE_ENTRIES,
  blankMaintenanceRow,
  buildMaintenancePayload,
  maintenanceFormErrors,
  maintenanceHaveChanged,
  maintenanceRowsFrom,
  type TemplateMaintenanceRow,
} from "../../lib/template-maintenance-form";
import { mergeTemplateContent, unwritableContentKeys } from "../../lib/template-content-merge";
import { Field } from "./field";

type MaintenanceTabProps = {
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
  /** Tells the page whether leaving this tab would discard an edit. */
  onDirtyChange: (dirty: boolean) => void;
};

/** The stored section, read from the loose `content` record. */
function storedMaintenance(template: AdminAssetTemplateDto): TemplateMaintenancePlan[] | undefined {
  const section = template.content.maintenance;
  return Array.isArray(section) ? (section as TemplateMaintenancePlan[]) : undefined;
}

export function MaintenanceTab({ template, editable, onSaved, onDirtyChange }: MaintenanceTabProps) {
  const [rows, setRows] = useState<TemplateMaintenanceRow[]>(() =>
    maintenanceRowsFrom(storedMaintenance(template)),
  );
  const [error, setError] = useState<string | null>(null);

  // Keyed on the row id and the lifecycle status — see `details-tab.tsx`.
  useEffect(() => {
    setRows(maintenanceRowsFrom(storedMaintenance(template)));
    setError(null);
  }, [template.id, template.status]);

  const blockedKeys = unwritableContentKeys(template.content);
  const changed = maintenanceHaveChanged(rows, storedMaintenance(template));

  // The same comparison Save uses, reported up so the page can guard a tab
  // switch. The cleanup reports clean on unmount, so switching away cannot
  // leave the page holding this tab's `true`.
  useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);

  // No vocabulary gate here, unlike the Alarms tab: the three lists are closed
  // enums that are present from the first render, so there is no state in which
  // a valid form would paint red while something loads.
  const problems = maintenanceFormErrors(rows);
  const blocked = problems.length > 0 || blockedKeys.length > 0;

  const saveM = useMutation({
    mutationFn: () =>
      updateAdminAssetTemplate(template.id, {
        content: mergeTemplateContent(template.content, {
          section: "maintenance",
          value: buildMaintenancePayload(rows),
        }),
      }),
    onSuccess: (next) => {
      setError(null);
      onSaved(next);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  function update(index: number, patch: Partial<TemplateMaintenanceRow>) {
    setRows((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  }

  const sectionProblems = problems.filter((problem) => problem.row === null);

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      ) : null}

      {blockedKeys.length > 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Saving maintenance is blocked: this template holds content that cannot be written back.
          The banner above lists the keys.
        </p>
      ) : null}

      {/* An instruction, not a disclaimer — `alarms-tab.tsx`'s reasoning, and
          the misreading is more consequential here: a plan that looks booked
          and is not is an inspection nobody attends. */}
      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
        These are the maintenance plans this asset class ships with. They are stored on the template
        as a standard — <strong>nothing here schedules work</strong>. A plan becomes a schedule only
        once an asset of this class exists, through the Maintenance surface for that asset. Saving
        this tab creates, changes and removes no schedule and no work order.
      </p>

      {sectionProblems.map((problem) => (
        <p
          key={problem.message}
          className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {problem.message}
        </p>
      ))}

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
          This template declares no maintenance plans yet.
        </p>
      ) : null}

      {rows.map((plan, index) => {
        const rowProblems = problems.filter((problem) => problem.row === index);
        const problemFor = (field: string) =>
          rowProblems.find((problem) => problem.field === field)?.message;

        return (
          <section key={index} className="rounded border border-gray-200 p-3">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                Plan {index + 1}
              </span>
              {/* Rendered from the row, so it shows on a read-only version too.
                  It is the single most important thing on this screen: ten of
                  the catalog's plans are safety critical and a reader skimming
                  a long card must not have to open a field to find out. */}
              {plan.safetyCritical ? (
                <span className="rounded border border-red-200 bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">
                  Safety critical
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Title" error={problemFor("title")}>
                <input
                  type="text"
                  value={plan.title}
                  disabled={!editable}
                  onChange={(event) => update(index, { title: event.target.value })}
                  className={fieldClass(!editable, problemFor("title"))}
                />
              </Field>
              <Field label="Interval days" error={problemFor("intervalDays")}>
                {/* `inputMode="numeric"` on a text input, as the Alarms tab
                    does: a `type="number"` box reports an empty string for
                    several kinds of invalid input, which would make a typo
                    indistinguishable from a cleared field. */}
                <input
                  type="text"
                  inputMode="numeric"
                  value={plan.intervalDays}
                  disabled={!editable}
                  placeholder="90"
                  onChange={(event) => update(index, { intervalDays: event.target.value })}
                  className={fieldClass(!editable, problemFor("intervalDays"))}
                />
              </Field>
              <Field label="Estimated minutes" error={problemFor("estimatedMinutes")}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={plan.estimatedMinutes}
                  disabled={!editable}
                  placeholder="60"
                  onChange={(event) => update(index, { estimatedMinutes: event.target.value })}
                  className={fieldClass(!editable, problemFor("estimatedMinutes"))}
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Field label="Category" error={problemFor("category")}>
                <select
                  value={plan.category}
                  disabled={!editable}
                  onChange={(event) => update(index, { category: event.target.value })}
                  className={fieldClass(!editable, problemFor("category"))}
                >
                  {/* A stored code the enum does not offer. Kept selectable so
                      the row shows what it holds and the problem names it,
                      rather than snapping silently to another category. */}
                  {!(MAINTENANCE_CATEGORIES as readonly string[]).includes(plan.category) ? (
                    <option value={plan.category}>{plan.category} (retired)</option>
                  ) : null}
                  {MAINTENANCE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {MAINTENANCE_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority" error={problemFor("priority")}>
                <select
                  value={plan.priority}
                  disabled={!editable}
                  onChange={(event) => update(index, { priority: event.target.value })}
                  className={fieldClass(!editable, problemFor("priority"))}
                >
                  {!(MAINTENANCE_PRIORITIES as readonly string[]).includes(plan.priority) ? (
                    <option value={plan.priority}>{plan.priority} (retired)</option>
                  ) : null}
                  {MAINTENANCE_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {WORK_ORDER_PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Generation mode" error={problemFor("generationMode")}>
                <select
                  value={plan.generationMode}
                  disabled={!editable}
                  onChange={(event) => update(index, { generationMode: event.target.value })}
                  className={fieldClass(!editable, problemFor("generationMode"))}
                >
                  {!(MAINTENANCE_GENERATION_MODES as readonly string[]).includes(
                    plan.generationMode,
                  ) ? (
                    <option value={plan.generationMode}>{plan.generationMode} (retired)</option>
                  ) : null}
                  {MAINTENANCE_GENERATION_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {MAINTENANCE_GENERATION_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-4">
              {/* "plan" is in the label on purpose: the badge above reads
                  "Safety critical", and two controls with the same accessible
                  name make a screen reader and a test say the same ambiguous
                  thing. */}
              <Field label="Safety critical plan">
                <input
                  type="checkbox"
                  checked={plan.safetyCritical}
                  disabled={!editable}
                  onChange={(event) => update(index, { safetyCritical: event.target.checked })}
                  className="h-4 w-4 rounded border-gray-300"
                />
              </Field>
              <Field label="Owner team" error={problemFor("ownerTeam")}>
                <input
                  type="text"
                  value={plan.ownerTeam}
                  disabled={!editable}
                  onChange={(event) => update(index, { ownerTeam: event.target.value })}
                  className={fieldClass(!editable, problemFor("ownerTeam"))}
                />
              </Field>
              <Field label="Vendor" error={problemFor("vendorName")}>
                <input
                  type="text"
                  value={plan.vendorName}
                  disabled={!editable}
                  onChange={(event) => update(index, { vendorName: event.target.value })}
                  className={fieldClass(!editable, problemFor("vendorName"))}
                />
              </Field>
              <Field label="Compliance ref" error={problemFor("complianceRef")}>
                <input
                  type="text"
                  value={plan.complianceRef}
                  disabled={!editable}
                  onChange={(event) => update(index, { complianceRef: event.target.value })}
                  className={fieldClass(!editable, problemFor("complianceRef"))}
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field label="Trigger summary" error={problemFor("triggerSummary")}>
                <textarea
                  rows={2}
                  value={plan.triggerSummary}
                  disabled={!editable}
                  placeholder="What makes this plan due."
                  onChange={(event) => update(index, { triggerSummary: event.target.value })}
                  className={fieldClass(!editable, problemFor("triggerSummary"))}
                />
              </Field>
              <Field label="Description" error={problemFor("description")}>
                <textarea
                  rows={2}
                  value={plan.description}
                  disabled={!editable}
                  onChange={(event) => update(index, { description: event.target.value })}
                  className={fieldClass(!editable, problemFor("description"))}
                />
              </Field>
            </div>

            {editable ? (
              <button
                type="button"
                onClick={() =>
                  setRows((current) => current.filter((_, position) => position !== index))
                }
                className="mt-3 rounded border border-red-200 px-3 py-1 text-[11px] font-semibold text-red-700"
              >
                Remove
              </button>
            ) : null}
          </section>
        );
      })}

      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={rows.length >= MAX_MAINTENANCE_ENTRIES}
            onClick={() => setRows((current) => [...current, blankMaintenanceRow()])}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-ink disabled:opacity-60"
          >
            Add a plan
          </button>
          <button
            type="button"
            disabled={blocked || !changed || saveM.isPending}
            onClick={() => saveM.mutate()}
            className="rounded bg-bms-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saveM.isPending ? "Saving…" : "Save maintenance"}
          </button>
          <span className="text-[11px] text-bms-muted">
            {blockedKeys.length > 0
              ? "Blocked by unwritable content."
              : problems.length > 0
                ? "Fix the problems above to save."
                : changed
                  ? "Sends this section; every other section is carried unchanged."
                  : "No changes yet."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function fieldClass(disabled: boolean, problem: string | undefined): string {
  const tone = problem ? "border-red-300 bg-red-50" : "border-gray-200";
  return `w-full rounded border px-2 py-1.5 text-xs ${tone} ${
    disabled ? "bg-gray-50 text-bms-muted" : ""
  }`;
}
