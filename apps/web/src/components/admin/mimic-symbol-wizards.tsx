import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  MIMIC_SYMBOL_GROUP_CODES,
  type MimicOrgSymbolDto,
  type MimicOrgSymbolLibraryDto,
  type MimicSymbolGroupCode,
} from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { updateMimicOrgSymbol, uploadMimicOrgSymbol, type UpdateMimicOrgSymbolBody } from "../../api/mimic-symbol-libraries";
import { apiErrorMessage } from "../../lib/api-error-message";
import { MIMIC_SYMBOL_GROUPS } from "../../lib/mimic-symbols";
import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame, fieldClass, labelClass } from "./admin-wizard-frame";

/**
 * `F3.87` PR 6b (ADR 0099 decision 6, Amendment 3 A3; plan D6) — the symbol
 * writes on the shared `WizardShell`: the upload (`mimicSymbol.upload`, Symbol
 * → Review) in place of the inline form, and the symbol edit
 * (`mimicSymbol.update`, Symbol → Review) behind the table's group select and
 * Active box.
 *
 * **The file is never a wizard value** (critique A6 item 4): `WizardShell`
 * builds the body from `values` and checks it with `bodyProblems` against the
 * strict fields schema, so a `File` in `values` would fail Review. The file
 * input sits beside the shell in this component's own state, and Submit
 * refuses until a file is chosen; the upload is sent through
 * `uploadMimicOrgSymbol`, a plain multipart request with no
 * `X-Copilot-Change` header.
 *
 * Each `<WizardShell>` writes the literal `entry={wizardEntry("<id>")}` (the
 * stepper gate's form).
 */

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.87: the catalog has no entry "${id}"`);
  return entry;
}

/** A group code's label, from the palette's table. */
function groupLabel(code: MimicSymbolGroupCode): string {
  return MIMIC_SYMBOL_GROUPS.find((group) => group.key === code)?.label ?? code;
}

/** Submit's sentence while no file is chosen. */
export const CHOOSE_A_FILE = "Choose an SVG file to upload.";

type Done = { onCancel: () => void; onDone: () => Promise<void> | void };

/**
 * The upload wizard's body from its values: the text fields only — the `File` is not among
 * them (a value left empty is left out, so the API takes it from the file name).
 */
export function uploadWizardBody(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of ["name", "label", "group"] as const) {
    if (typeof values[key] === "string" && values[key] !== "") body[key] = values[key];
  }
  return body;
}

/** `mimicSymbol.upload` — one SVG per symbol; name, label and group are optional. */
export function SymbolUploadWizard({ library, onCancel, onDone }: Done & { library: MimicOrgSymbolLibraryDto }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [file, setFile] = useState<File | null>(null);
  const [missingFile, setMissingFile] = useState(false);
  const save = useMutation({
    mutationFn: (input: { file: File; body: Record<string, unknown> }) =>
      uploadMimicOrgSymbol(library.id, {
        file: input.file,
        name: input.body.name as string | undefined,
        label: input.body.label as string | undefined,
        group: input.body.group as MimicSymbolGroupCode | undefined,
      }),
    onSuccess: async () => onDone(),
  });
  const text = (field: string) => (typeof values[field] === "string" ? (values[field] as string) : "");
  const set = (field: string, value: string) => setValues(uploadWizardBody({ ...values, [field]: value }));
  const submitError = save.error ? apiErrorMessage(save.error) : missingFile ? CHOOSE_A_FILE : null;
  return (
    <AdminWizardFrame title={`Upload a symbol to ${library.label}`}>
      <label className={labelClass}>
        SVG file
        <input
          type="file"
          accept="image/svg+xml"
          aria-label="Symbol file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setMissingFile(false);
          }}
          className="mt-1 block w-full text-xs text-ink"
        />
      </label>
      <WizardShell
        entry={wizardEntry("mimicSymbol.upload")}
        params={{ id: library.id }}
        values={values}
        onChange={setValues}
        renderStep={() => (
          <>
            <label className={labelClass}>
              Name
              <input aria-label="Symbol name" value={text("name")} onChange={(e) => set("name", e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Label
              <input aria-label="Symbol label" value={text("label")} onChange={(e) => set("label", e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Group
              <select aria-label="Symbol group" value={text("group")} onChange={(e) => set("group", e.target.value)} className={fieldClass}>
                <option value="">General (default)</option>
                {MIMIC_SYMBOL_GROUP_CODES.map((code) => (
                  <option key={code} value={code}>
                    {groupLabel(code)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-ink-muted">
              The API parses the SVG into geometry and refuses anything else; an empty name or label is taken from the
              file name.
            </p>
          </>
        )}
        onSubmit={(body) => {
          if (file === null) setMissingFile(true);
          else save.mutate({ file, body });
        }}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={submitError}
        dirty={file !== null}
        summary={wizardEntry("mimicSymbol.upload").summary({ body: values, params: { id: library.id }, targetName: library.label, organizationName: "" })}
      />
    </AdminWizardFrame>
  );
}

/**
 * `mimicSymbol.update` — one symbol's label, group or Active switch. `start` is the change the
 * table's control made (`{ group }` or `{ active }`); every other field starts unset and shows
 * the stored value.
 */
export function SymbolUpdateWizard({
  library,
  symbol,
  start,
  onCancel,
  onDone,
}: Done & { library: MimicOrgSymbolLibraryDto; symbol: MimicOrgSymbolDto; start: Record<string, unknown> }) {
  const [values, setValues] = useState<Record<string, unknown>>(start);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateMimicOrgSymbol(library.id, symbol.id, body as UpdateMimicOrgSymbolBody),
    onSuccess: async () => onDone(),
  });
  const label = typeof values.label === "string" ? values.label : symbol.label;
  const group = typeof values.group === "string" ? values.group : symbol.group;
  const active = typeof values.active === "boolean" ? values.active : symbol.active;
  return (
    <AdminWizardFrame title={`Edit ${symbol.label}`}>
      <WizardShell
        entry={wizardEntry("mimicSymbol.update")}
        params={{ id: library.id, symbolId: symbol.id }}
        values={values}
        onChange={setValues}
        renderStep={() => (
          <>
            <label className={labelClass}>
              Label
              <input aria-label="Label" maxLength={64} value={label} onChange={(e) => setValues({ ...values, label: e.target.value })} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Group
              <select
                aria-label="Group"
                value={group}
                onChange={(e) => setValues({ ...values, group: e.target.value as MimicSymbolGroupCode })}
                className={fieldClass}
              >
                {MIMIC_SYMBOL_GROUP_CODES.map((code) => (
                  <option key={code} value={code}>
                    {groupLabel(code)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" aria-label="Active" checked={active} onChange={(e) => setValues({ ...values, active: e.target.checked })} />
              Active — a retired symbol stays in every drawing that uses it.
            </label>
          </>
        )}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        current={{ label: symbol.label, group: symbol.group, active: symbol.active }}
        summary={wizardEntry("mimicSymbol.update").summary({ body: values, params: { id: library.id, symbolId: symbol.id }, targetName: library.label, organizationName: "" })}
      />
    </AdminWizardFrame>
  );
}
