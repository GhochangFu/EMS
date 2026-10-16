import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { MimicGlobalLibraryStatusDto, MimicOrgSymbolLibraryDto, MimicSymbolStyle } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  createMimicOrgSymbolLibrary,
  putMimicLibrarySetting,
  updateMimicOrgSymbolLibrary,
  type CreateMimicOrgSymbolLibraryBody,
  type UpdateMimicOrgSymbolLibraryBody,
} from "../../api/mimic-symbol-libraries";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { WizardStep } from "../../lib/wizard-steps";
import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame, fieldClass, labelClass } from "./admin-wizard-frame";

/**
 * `F3.87` PR 6b (ADR 0099 decision 6, Amendment 3 A1; plan D6) — the symbol
 * libraries page's library writes on the shared `WizardShell`: create
 * (`mimicLibrary.create`, Library → Licence → Review), edit, retire and
 * reactivate (`mimicLibrary.update`, Details → Status → Review), and the
 * built-in library switch (`mimicLibrary.setting`, Setting → Review) in place
 * of the checkbox's direct write — one write path per route, as `F3.86`
 * ruling Q9 made the deactivate wizards.
 *
 * Each `<WizardShell>` writes the literal `entry={wizardEntry("<id>")}` (the
 * stepper gate's form). Submit sends the plain request — never an
 * `X-Copilot-Change` header: a wizard used alone is not a copilot change. An
 * edit's fields start unset and show the stored value; only a field the
 * administrator changes is sent.
 */

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.87: the catalog has no entry "${id}"`);
  return entry;
}

type Done = { onCancel: () => void; onDone: () => Promise<void> | void };

/** `mimicLibrary.setting` — turn one built-in library on or off for the organization. */
export function LibrarySettingWizard({
  library,
  organizationId,
  organizationName,
  enabled,
  onCancel,
  onDone,
}: Done & { library: MimicGlobalLibraryStatusDto; organizationId: string; organizationName: string; enabled: boolean }) {
  const [values, setValues] = useState<Record<string, unknown>>({ organizationId, enabled });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      putMimicLibrarySetting(library.code, { organizationId, enabled: body.enabled === true }),
    onSuccess: async () => onDone(),
  });
  const entry = wizardEntry("mimicLibrary.setting");
  const title = `Turn ${library.label} ${enabled ? "on" : "off"} for this organization`;
  return (
    <AdminWizardFrame title={title}>
      <WizardShell
        entry={wizardEntry("mimicLibrary.setting")}
        values={values}
        onChange={setValues}
        renderStep={() => (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={`${library.label} enabled`}
              checked={values.enabled === true}
              onChange={(event) => setValues({ ...values, enabled: event.target.checked })}
            />
            {`${library.label} enabled for ${organizationName}`}
          </label>
        )}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        summary={entry.summary({ body: values, params: { libraryCode: library.code }, targetName: organizationName, organizationName })}
      />
    </AdminWizardFrame>
  );
}

/** `mimicLibrary.create` — a new organization library. */
export function LibraryCreateWizard({ organizationId, organizationName, onCancel, onDone }: Done & { organizationId: string; organizationName: string }) {
  const [values, setValues] = useState<Record<string, unknown>>({ organizationId, code: "", label: "", style: "stroke", licence: "" });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => createMimicOrgSymbolLibrary(body as CreateMimicOrgSymbolLibraryBody),
    onSuccess: async () => onDone(),
  });
  const text = (field: string) => (typeof values[field] === "string" ? (values[field] as string) : "");
  const renderStep = (step: WizardStep) =>
    step.id === "library" ? (
      <>
        <label className={labelClass}>
          Code
          <input aria-label="Code" maxLength={27} value={text("code")} onChange={(e) => setValues({ ...values, code: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Label
          <input aria-label="Label" maxLength={64} value={text("label")} onChange={(e) => setValues({ ...values, label: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Style
          <select
            aria-label="Style"
            value={text("style")}
            onChange={(e) => setValues({ ...values, style: e.target.value as MimicSymbolStyle })}
            className={fieldClass}
          >
            <option value="stroke">stroke — outlines</option>
            <option value="fill">fill — filled shapes</option>
          </select>
        </label>
        <p className="text-xs text-ink-muted">
          The code is lower-case letters and digits, starting with a letter — like plant. A layout names the library
          org.&lt;code&gt;, and the code cannot change after it is saved.
        </p>
      </>
    ) : (
      <LicenceFields values={values} onChange={setValues} clearedUrl={undefined} />
    );
  return (
    <AdminWizardFrame title="New organization library">
      <WizardShell
        entry={wizardEntry("mimicLibrary.create")}
        values={values}
        onChange={setValues}
        renderStep={renderStep}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        summary={wizardEntry("mimicLibrary.create").summary({ body: values, params: {}, targetName: organizationName, organizationName })}
      />
    </AdminWizardFrame>
  );
}

/** The licence, attribution and source URL inputs; each shows `shown` while its value is unset (an edit). */
function LicenceFields({
  values,
  onChange,
  shown = {},
  clearedUrl,
}: {
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  shown?: Partial<Record<"licence" | "attribution" | "sourceUrl", string>>;
  /** What an emptied source URL becomes: `undefined` on a create (left out), `null` on an edit (cleared). */
  clearedUrl: undefined | null;
}) {
  const text = (field: "licence" | "attribution" | "sourceUrl") =>
    typeof values[field] === "string" ? (values[field] as string) : values[field] === null ? "" : (shown[field] ?? "");
  return (
    <>
      <label className={labelClass}>
        Licence
        <input aria-label="Licence" maxLength={64} value={text("licence")} onChange={(e) => onChange({ ...values, licence: e.target.value })} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Attribution
        <textarea
          aria-label="Attribution"
          maxLength={2000}
          rows={2}
          value={text("attribution")}
          onChange={(e) => onChange({ ...values, attribution: e.target.value })}
          className={fieldClass}
        />
      </label>
      <label className={labelClass}>
        Source URL
        <input
          type="url"
          aria-label="Source URL"
          maxLength={255}
          value={text("sourceUrl")}
          onChange={(e) => onChange({ ...values, sourceUrl: e.target.value === "" ? clearedUrl : e.target.value })}
          className={fieldClass}
        />
      </label>
    </>
  );
}

/**
 * `mimicLibrary.update` — edit, retire or reactivate one organization library. `start` is the
 * patch the page's button means (`{ active: false }` for Retire); every other field starts unset.
 */
export function LibraryUpdateWizard({
  library,
  start,
  onCancel,
  onDone,
}: Done & { library: MimicOrgSymbolLibraryDto; start: Record<string, unknown> }) {
  const [values, setValues] = useState<Record<string, unknown>>(start);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateMimicOrgSymbolLibrary(library.id, body as UpdateMimicOrgSymbolLibraryBody),
    onSuccess: async () => onDone(),
  });
  const current = {
    label: library.label,
    licence: library.licence,
    attribution: library.attribution,
    sourceUrl: library.sourceUrl,
    active: library.active,
  };
  const label = typeof values.label === "string" ? values.label : library.label;
  const active = typeof values.active === "boolean" ? values.active : library.active;
  const renderStep = (step: WizardStep) =>
    step.id === "details" ? (
      <>
        <label className={labelClass}>
          Label
          <input aria-label="Label" maxLength={64} value={label} onChange={(e) => setValues({ ...values, label: e.target.value })} className={fieldClass} />
        </label>
        <LicenceFields
          values={values}
          onChange={setValues}
          clearedUrl={null}
          shown={{ licence: library.licence, attribution: library.attribution, sourceUrl: library.sourceUrl ?? "" }}
        />
      </>
    ) : (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" aria-label="Active" checked={active} onChange={(e) => setValues({ ...values, active: e.target.checked })} />
        Active — a retired library stays in every drawing that uses it, and no new drawing can pick it.
      </label>
    );
  const title = Object.keys(start).length === 1 && start.active === false ? `Retire ${library.label}` : start.active === true ? `Reactivate ${library.label}` : `Edit ${library.label}`;
  return (
    <AdminWizardFrame title={title}>
      <WizardShell
        entry={wizardEntry("mimicLibrary.update")}
        values={values}
        onChange={setValues}
        renderStep={renderStep}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        current={current}
        summary={wizardEntry("mimicLibrary.update").summary({ body: values, params: { id: library.id }, targetName: library.label, organizationName: "" })}
      />
    </AdminWizardFrame>
  );
}
