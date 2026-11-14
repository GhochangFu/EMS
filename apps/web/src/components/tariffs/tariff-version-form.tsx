import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  createTariffVersionBodySchema,
  CUSTOM_TARIFF_KEY_PREFIX,
  TARIFF_MAX_SLABS,
  type TariffSlab,
  type TariffVersionDto,
  updateTariffVersionBodySchema,
} from "@bms/shared/contracts";

import { createTariffVersion, updateTariffVersion } from "../../api/tariffs";
import { apiErrorMessage } from "../../lib/api-error-message";
import { FIXED_BASES, fixedBasisLabel, fromMonthInput, monthLabel, toMonthInput } from "../../lib/tariff-labels";

/**
 * `F4.365` U9 (ADR 0134 decision 8, Amendment 1) — the form that writes an organization's own
 * tariff version. The dialog that deletes one is `tariff-version-delete-dialog.tsx`.
 *
 * - **New revision** copies the line's current slabs into the grid; the body carries
 *   `kind: "revision"`, the key, the month, the reason and the slabs — never a descriptive field,
 *   which the API copies from the line (`org-tariff-versions.service.ts`).
 * - **New custom tariff** takes the descriptive fields too, and the key is `custom:` + a suffix.
 * - **Edit** changes a version that is not yet in force (`editable`); the API refuses the rest.
 *
 * The slab grid holds each slab's upper bound and rates; each slab's lower bound is derived —
 * 0 for the first, the previous upper bound + 1 after — so a grid cannot express a gap
 * (`tariffSlabsSchema`). An empty upper bound is open-ended, which only the last slab may be.
 * Every body is parsed with the route's own schema before it is sent: a refusal on this side
 * names the field, and the request is exactly the contract's shape.
 */

export type SlabRow = { toUnits: string; energyRate: string; fixedRate: string; wheelingRate: string; notes: string };

export type TariffVersionFormMode =
  | { kind: "revision"; lineKey: string; seed: TariffVersionDto | null }
  | { kind: "custom" }
  | { kind: "edit"; version: TariffVersionDto };

const fieldClass = "mt-1 w-full surface-field px-3 py-2 text-sm";
const cellClass = "w-full surface-field px-2 py-1 text-sm";
const labelClass = "block text-xs font-semibold text-ink-muted";
const primaryClass = "surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent";

const EMPTY_ROW: SlabRow = { toUnits: "", energyRate: "", fixedRate: "", wheelingRate: "", notes: "" };

/** The grid rows a version's slabs start from. */
export function rowsFromSlabs(slabs: readonly TariffSlab[]): SlabRow[] {
  if (slabs.length === 0) return [{ ...EMPTY_ROW }];
  return slabs.map((slab) => ({
    toUnits: slab.toUnits === null ? "" : String(slab.toUnits),
    energyRate: String(slab.energyRate),
    fixedRate: String(slab.fixedRate),
    wheelingRate: String(slab.wheelingRate),
    notes: slab.notes ?? "",
  }));
}

/** A rate cell: empty is 0 (the workbook's blank); anything else is `Number()`, so text is `NaN` and refused. */
function rate(text: string): number {
  return text.trim() === "" ? 0 : Number(text);
}

/** The lower bound of each row: 0, then the previous upper bound + 1 (`NaN` while that is empty or not a number). */
export function derivedFromUnits(rows: readonly SlabRow[]): number[] {
  return rows.map((_, i) => {
    if (i === 0) return 0;
    const prev = rows[i - 1]!.toUnits.trim();
    return prev === "" ? Number.NaN : Number(prev) + 1;
  });
}

/** The grid as the contract's slabs: numbered 1..n with derived lower bounds. */
export function slabsFromRows(rows: readonly SlabRow[]): TariffSlab[] {
  const from = derivedFromUnits(rows);
  return rows.map((row, i) => ({
    slabNo: i + 1,
    fromUnits: from[i]!,
    toUnits: row.toUnits.trim() === "" ? null : Number(row.toUnits),
    energyRate: rate(row.energyRate),
    fixedRate: rate(row.fixedRate),
    wheelingRate: rate(row.wheelingRate),
    notes: row.notes.trim() === "" ? null : row.notes.trim(),
  }));
}

function firstIssue(issues: readonly { path: readonly (string | number)[]; message: string }[]): string {
  const issue = issues[0];
  if (!issue) return "The form is not complete.";
  return issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`;
}

const blankToNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

type CustomFields = {
  keySuffix: string;
  name: string;
  code: string;
  state: string;
  areaId: string;
  discoms: string;
  ownership: string;
  segment: string;
  supply: string;
  energyUnit: "kwh" | "kvah";
  fixedBasis: TariffVersionDto["fixedBasis"];
  dataStatus: TariffVersionDto["dataStatus"];
};

const EMPTY_CUSTOM: CustomFields = {
  keySuffix: "",
  name: "",
  code: "",
  state: "",
  areaId: "",
  discoms: "",
  ownership: "",
  segment: "",
  supply: "",
  energyUnit: "kwh",
  fixedBasis: "none",
  dataStatus: "official",
};

type TariffVersionFormProps = {
  mode: TariffVersionFormMode;
  organizationId: string;
  onClose: () => void;
  /** Called with the saved version; the caller re-reads and may open its line. */
  onSaved: (saved: TariffVersionDto) => void | Promise<void>;
};

export function TariffVersionForm({ mode, organizationId, onClose, onSaved }: TariffVersionFormProps) {
  const seedSlabs = mode.kind === "edit" ? mode.version.slabs : mode.kind === "revision" ? (mode.seed?.slabs ?? []) : [];
  const [rows, setRows] = useState<SlabRow[]>(() => rowsFromSlabs(seedSlabs));
  const [effectiveFrom, setEffectiveFrom] = useState(mode.kind === "edit" ? toMonthInput(mode.version.effectiveFrom) : "");
  const [reason, setReason] = useState("");
  const [tariffOrder, setTariffOrder] = useState(mode.kind === "edit" ? (mode.version.tariffOrder ?? "") : "");
  const [sourceUrl, setSourceUrl] = useState(mode.kind === "edit" ? (mode.version.sourceUrl ?? "") : "");
  const [custom, setCustom] = useState<CustomFields>(EMPTY_CUSTOM);
  const [error, setError] = useState<string | null>(null);

  const from = derivedFromUnits(rows);

  const saveMutation = useMutation({
    mutationFn: async (body: unknown) => {
      if (mode.kind === "edit") {
        return updateTariffVersion(mode.version.id, updateTariffVersionBodySchema.parse(body));
      }
      return createTariffVersion(createTariffVersionBodySchema.parse(body));
    },
    onSuccess: onSaved,
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  function edited<T>(apply: (value: T) => void): (value: T) => void {
    return (value) => {
      setError(null);
      apply(value);
    };
  }

  function setCell(index: number, field: keyof SlabRow, value: string): void {
    setError(null);
    setRows(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function body(): unknown {
    const common = {
      effectiveFrom: fromMonthInput(effectiveFrom) ?? "",
      reason: reason.trim(),
      slabs: slabsFromRows(rows),
    };
    if (mode.kind === "edit") {
      return { ...common, tariffOrder: blankToNull(tariffOrder), sourceUrl: blankToNull(sourceUrl) };
    }
    if (mode.kind === "revision") {
      // No descriptive field: the API copies them from the line (decision 8).
      return {
        kind: "revision",
        organizationId,
        key: mode.lineKey,
        ...common,
        ...(blankToNull(tariffOrder) === null ? {} : { tariffOrder: tariffOrder.trim() }),
        ...(blankToNull(sourceUrl) === null ? {} : { sourceUrl: sourceUrl.trim() }),
      };
    }
    const { keySuffix, ...descriptive } = custom;
    return {
      kind: "custom",
      organizationId,
      key: `${CUSTOM_TARIFF_KEY_PREFIX}${keySuffix.trim()}`,
      ...common,
      ...descriptive,
      name: descriptive.name.trim(),
      code: descriptive.code.trim(),
      state: descriptive.state.trim(),
      tariffOrder: blankToNull(tariffOrder),
      sourceUrl: blankToNull(sourceUrl),
      notes: null,
    };
  }

  function submit(): void {
    const candidate = body();
    const parsed =
      mode.kind === "edit" ? updateTariffVersionBodySchema.safeParse(candidate) : createTariffVersionBodySchema.safeParse(candidate);
    if (!parsed.success) {
      setError(firstIssue(parsed.error.issues));
      return;
    }
    if (mode.kind === "custom" && (custom.keySuffix.trim() === "" || custom.name.trim() === "" || custom.state.trim() === "")) {
      setError("A custom tariff needs a key, a name and a state.");
      return;
    }
    saveMutation.mutate(parsed.data);
  }

  const title =
    mode.kind === "edit"
      ? `Edit version from ${monthLabel(mode.version.effectiveFrom)}`
      : mode.kind === "revision"
        ? "New revision"
        : "New custom tariff";

  const text = (label: string, field: Exclude<keyof CustomFields, "energyUnit" | "fixedBasis" | "dataStatus">) => (
    <label className={labelClass}>
      {label}
      <input
        type="text"
        className={fieldClass}
        value={custom[field]}
        onChange={(e) => edited(setCustom)({ ...custom, [field]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <div role="dialog" aria-label={title} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto surface-dialog p-4">
        <h2 className="font-condensed text-lg font-bold">{title}</h2>
        {mode.kind === "revision" ? (
          <p className="mt-1 text-xs text-ink-muted">
            <code>{mode.lineKey}</code> — the slabs are copied from the version in force; this organization's revision
            replaces them from its month, past or future.
          </p>
        ) : null}

        <div className="mt-3 space-y-3">
          {mode.kind === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <label className={labelClass}>
                Key
                <span className="mt-1 flex items-center gap-1">
                  <code className="text-sm">{CUSTOM_TARIFF_KEY_PREFIX}</code>
                  <input
                    type="text"
                    aria-label="Key suffix"
                    className="w-full surface-field px-3 py-2 text-sm"
                    value={custom.keySuffix}
                    onChange={(e) => edited(setCustom)({ ...custom, keySuffix: e.target.value })}
                  />
                </span>
              </label>
              {text("Name", "name")}
              {text("Code", "code")}
              {text("State", "state")}
              {text("Area ID", "areaId")}
              {text("Discoms", "discoms")}
              {text("Ownership", "ownership")}
              {text("Segment", "segment")}
              {text("Supply", "supply")}
              <label className={labelClass}>
                Billed in
                <select
                  className={fieldClass}
                  value={custom.energyUnit}
                  onChange={(e) => edited(setCustom)({ ...custom, energyUnit: e.target.value as CustomFields["energyUnit"] })}
                >
                  <option value="kwh">kWh</option>
                  <option value="kvah">kVAh</option>
                </select>
              </label>
              <label className={labelClass}>
                Fixed charge basis
                <select
                  className={fieldClass}
                  value={custom.fixedBasis}
                  onChange={(e) => edited(setCustom)({ ...custom, fixedBasis: e.target.value as CustomFields["fixedBasis"] })}
                >
                  {FIXED_BASES.map((basis) => (
                    <option key={basis} value={basis}>
                      {fixedBasisLabel(basis)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Data status
                <select
                  className={fieldClass}
                  value={custom.dataStatus}
                  onChange={(e) => edited(setCustom)({ ...custom, dataStatus: e.target.value as CustomFields["dataStatus"] })}
                >
                  <option value="official">Official</option>
                  <option value="secondary">Secondary</option>
                  <option value="indicative">Indicative</option>
                </select>
              </label>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Effective month
              <input
                type="month"
                className={fieldClass}
                value={effectiveFrom}
                required
                onChange={(e) => edited(setEffectiveFrom)(e.target.value)}
              />
            </label>
            <label className={labelClass}>
              Tariff order
              <input type="text" className={fieldClass} value={tariffOrder} onChange={(e) => edited(setTariffOrder)(e.target.value)} />
            </label>
            <label className={`${labelClass} col-span-2`}>
              Source URL
              <input
                type="url"
                className={fieldClass}
                value={sourceUrl}
                placeholder="https://"
                onChange={(e) => edited(setSourceUrl)(e.target.value)}
              />
            </label>
          </div>

          <table className="min-w-full text-sm" aria-label="Slabs">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-ink-muted">
                <th className="px-1 py-1">Slab</th>
                <th className="px-1 py-1">From</th>
                <th className="px-1 py-1">To</th>
                <th className="px-1 py-1">Energy rate</th>
                <th className="px-1 py-1">Fixed rate</th>
                <th className="px-1 py-1">Wheeling rate</th>
                <th className="px-1 py-1">Notes</th>
                <th className="px-1 py-1">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-well-deep">
                  <td className="px-1 py-1 font-mono">{i + 1}</td>
                  <td className="px-1 py-1 font-mono" aria-label={`Slab ${i + 1} from`}>
                    {Number.isNaN(from[i]) ? "—" : from[i]}
                  </td>
                  {(["toUnits", "energyRate", "fixedRate", "wheelingRate"] as const).map((field) => (
                    <td key={field} className="px-1 py-1">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className={cellClass}
                        aria-label={`Slab ${i + 1} ${field === "toUnits" ? "to" : field.replace("Rate", " rate")}`}
                        placeholder={field === "toUnits" ? "open" : "0"}
                        value={row[field]}
                        onChange={(e) => setCell(i, field, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <input
                      type="text"
                      className={cellClass}
                      aria-label={`Slab ${i + 1} notes`}
                      value={row.notes}
                      onChange={(e) => setCell(i, "notes", e.target.value)}
                    />
                  </td>
                  <td className="px-1 py-1">
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-critical-ink"
                        aria-label={`Remove slab ${i + 1}`}
                        onClick={() => {
                          setError(null);
                          setRows(rows.filter((_, j) => j !== i));
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length < TARIFF_MAX_SLABS ? (
            <button
              type="button"
              className="text-xs font-semibold text-accent-strong"
              onClick={() => {
                setError(null);
                setRows([...rows, { ...EMPTY_ROW }]);
              }}
            >
              Add slab
            </button>
          ) : null}
          <p className="text-2xs text-ink-muted">
            Each slab starts one unit above the previous one&apos;s upper bound. Leave the last slab&apos;s To empty for no upper
            bound. An empty rate is 0.
          </p>

          <label className={labelClass}>
            Reason
            <textarea
              className={fieldClass}
              rows={2}
              value={reason}
              required
              placeholder="Why this version — kept in the audit log"
              onChange={(e) => edited(setReason)(e.target.value)}
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-critical-ink">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-2 text-xs font-semibold text-ink-muted" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={primaryClass}
              disabled={saveMutation.isPending}
              aria-busy={saveMutation.isPending}
              onClick={submit}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
