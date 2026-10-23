import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";
import type { AssetRoleDto, CreateAssetRoleBody, UpdateAssetRoleBody } from "@bms/shared";

import { createAssetRole, updateAssetRole } from "../../api/admin/asset-roles";
import { apiErrorMessage } from "../../lib/api-error-message";
import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame, fieldClass, labelClass, numberOf } from "./admin-wizard-frame";

/**
 * `F3.87` PR 6b (ADR 0099 decision 6, Amendment 3 A1; owner ruling Q2(a)) —
 * `assetRole.create` on the shared `WizardShell` (Role → Review), opened by the
 * global-admin-only "Add a unit role" action on `/admin/mimic-layouts` and, since
 * `F4.282`, on the Unit Roles page (`/admin/unit-roles`). Submit sends the plain request; the route's
 * `requireGlobalAdmin` still decides. The `<WizardShell>` writes the literal
 * `entry={wizardEntry("assetRole.create")}` (the stepper gate's form).
 */

/**
 * `F4.282`: the Sort order text as shown. The typed text stays while it means the value, so a
 * half-typed number is not rewritten; a copilot fill changes `values.sortOrder` alone, and then
 * the input shows the filled number, never a stale one beside what Submit sends.
 */
function sortOrderText(typed: string, value: unknown): string {
  // `Number.isFinite`: a typed "abc" is NaN in `values`, and NaN never equals itself.
  return typeof value === "number" && Number.isFinite(value) && numberOf(typed) !== value ? String(value) : typed;
}

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.87: the catalog has no entry "${id}"`);
  return entry;
}

export function AssetRoleWizard({ onCancel, onDone }: { onCancel: () => void; onDone: () => Promise<void> | void }) {
  const [values, setValues] = useState<Record<string, unknown>>({ code: "", label: "" });
  const [sortOrder, setSortOrder] = useState("");
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => createAssetRole(body as CreateAssetRoleBody),
    onSuccess: async () => onDone(),
  });
  const text = (field: string) => (typeof values[field] === "string" ? (values[field] as string) : "");
  return (
    <AdminWizardFrame title="Add a unit role">
      <WizardShell
        entry={wizardEntry("assetRole.create")}
        params={{}}
        values={values}
        onChange={setValues}
        renderStep={() => (
          <>
            <label className={labelClass}>
              Code
              <input aria-label="Code" maxLength={64} value={text("code")} onChange={(e) => setValues({ ...values, code: e.target.value })} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Label
              <input aria-label="Label" maxLength={128} value={text("label")} onChange={(e) => setValues({ ...values, label: e.target.value })} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Sort order
              <input
                aria-label="Sort order"
                inputMode="numeric"
                value={sortOrderText(sortOrder, values.sortOrder)}
                onChange={(e) => {
                  setSortOrder(e.target.value);
                  setValues({ ...values, sortOrder: numberOf(e.target.value) });
                }}
                className={fieldClass}
              />
            </label>
            <p className="text-xs text-ink-muted">
              The code is lower-case letters, digits and hyphens, starting with a letter — like cooling-tower. Every
              organization's layouts share this vocabulary.
            </p>
          </>
        )}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        summary={wizardEntry("assetRole.create").summary({ body: values, params: {}, targetName: "", organizationName: "" })}
      />
    </AdminWizardFrame>
  );
}

type RoleWizardProps = { role: AssetRoleDto; onCancel: () => void; onDone: () => Promise<void> | void };

/**
 * `F4.282` (ADR 0099 Amendment 8 Q17) — `assetRole.update` (Role → Review) on the Unit Roles
 * page: label and sort order only. The entry's step has no `active` and `fill_step` refuses it;
 * `fixedFields` is the page's second line. Retirement is the two direction wizards below.
 */
export function AssetRoleEditWizard({ role, onCancel, onDone }: RoleWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>({ label: role.label, sortOrder: role.sortOrder });
  const [sortOrder, setSortOrder] = useState(String(role.sortOrder));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateAssetRole(role.code, body as UpdateAssetRoleBody),
    onSuccess: async () => onDone(),
  });
  const label = typeof values.label === "string" ? values.label : "";
  return (
    <AdminWizardFrame title="Edit a unit role">
      <WizardShell
        entry={wizardEntry("assetRole.update")}
        params={{ code: role.code }}
        fixedFields={["active"]}
        values={values}
        onChange={setValues}
        renderStep={() => (
          <>
            <label className={labelClass}>
              Label
              <input aria-label="Label" maxLength={128} value={label} onChange={(e) => setValues({ ...values, label: e.target.value })} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Sort order
              <input
                aria-label="Sort order"
                inputMode="numeric"
                value={sortOrderText(sortOrder, values.sortOrder)}
                onChange={(e) => {
                  setSortOrder(e.target.value);
                  setValues({ ...values, sortOrder: numberOf(e.target.value) });
                }}
                className={fieldClass}
              />
            </label>
          </>
        )}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        current={{ label: role.label, sortOrder: role.sortOrder }}
        summary={wizardEntry("assetRole.update").summary({ body: values, params: { code: role.code }, targetName: role.label, organizationName: "" })}
      />
    </AdminWizardFrame>
  );
}

/**
 * `F4.282` — `assetRole.deactivate` / `assetRole.reactivate`, each the Review step alone: the
 * entry's `fixedBody` (`{ active: false }` or `{ active: true }`) is the whole PATCH body.
 */
export function AssetRoleToggleWizard({ role, onCancel, onDone }: RoleWizardProps) {
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateAssetRole(role.code, body as UpdateAssetRoleBody),
    onSuccess: async () => onDone(),
  });
  const shared = {
    params: { code: role.code },
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: (body: Record<string, unknown>) => save.mutate(body),
    onCancel,
    submitting: save.isPending,
    submitError: save.error ? apiErrorMessage(save.error) : null,
  };
  const summaryOf = (id: string) =>
    wizardEntry(id).summary({ body: {}, params: { code: role.code }, targetName: role.label, organizationName: "" });
  return role.active ? (
    <AdminWizardFrame title="Deactivate a unit role">
      <WizardShell
        entry={wizardEntry("assetRole.deactivate")}
        {...shared}
        values={{ active: false }}
        summary={summaryOf("assetRole.deactivate")}
      />
    </AdminWizardFrame>
  ) : (
    <AdminWizardFrame title="Reactivate a unit role">
      <WizardShell
        entry={wizardEntry("assetRole.reactivate")}
        {...shared}
        values={{ active: true }}
        summary={summaryOf("assetRole.reactivate")}
      />
    </AdminWizardFrame>
  );
}
