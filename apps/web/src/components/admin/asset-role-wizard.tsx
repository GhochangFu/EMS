import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";
import type { CreateAssetRoleBody } from "@bms/shared";

import { createAssetRole } from "../../api/admin/asset-roles";
import { apiErrorMessage } from "../../lib/api-error-message";
import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame, fieldClass, labelClass, numberOf } from "./admin-wizard-frame";

/**
 * `F3.87` PR 6b (ADR 0099 decision 6, Amendment 3 A1; owner ruling Q2(a)) —
 * `assetRole.create` on the shared `WizardShell` (Role → Review), opened by the
 * global-admin-only "Add a unit role" action on `/admin/mimic-layouts`; the
 * vocabulary has no admin page. Submit sends the plain request; the route's
 * `requireGlobalAdmin` still decides. The `<WizardShell>` writes the literal
 * `entry={wizardEntry("assetRole.create")}` (the stepper gate's form).
 */

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
                value={sortOrder}
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
