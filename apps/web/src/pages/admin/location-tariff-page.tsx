import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createLocationTariffBodySchema,
  loadUnitForBasis,
  type LocationTariffDto,
  type TariffLineDto,
  updateLocationTariffBodySchema,
} from "@bms/shared/contracts";

import { fetchAdminAssets } from "../../api/admin/assets";
import { fetchAdminLocationSummary } from "../../api/admin/locations";
import { fetchTariffLines, tariffLinesQueryKey } from "../../api/tariffs";
import {
  createLocationTariff,
  deleteLocationTariff,
  fetchLocationTariffs,
  locationTariffsQueryKey,
  updateLocationTariff,
} from "../../api/tariffs-location";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { TariffVerifyBadge } from "../../components/energy/tariff-verify-badge";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { canManageLocationTariffs } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  energyUnitLabel,
  fixedBasisLabel,
  fromMonthInput,
  loadUnitLabel,
  monthLabel,
  nextMonthStart,
  toMonthInput,
  currentMonthInput,
} from "../../lib/tariff-labels";
import type { AuthUser } from "../../stores/auth-store";

type LoadUnit = "kw" | "kva" | "hp";
const LOAD_UNITS: readonly LoadUnit[] = ["kw", "kva", "hp"];

type FormState = {
  state: string;
  search: string;
  tariffKey: string;
  billingMeterAssetId: string;
  /** Kept as text; `Number()` on submit. */
  sanctionedLoad: string;
  sanctionedLoadUnit: LoadUnit;
  /** `<input type="month">` values, `YYYY-MM`. */
  effectiveFrom: string;
  effectiveTo: string;
};

const actionClass = "text-xs font-semibold text-accent-strong";
const primaryClass = "surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent";
const fieldClass = "mt-1 w-full surface-field px-3 py-2 text-sm";
const labelClass = "block text-xs font-semibold text-ink-muted";

/** The first refusal of a client-side parse, as one sentence (`path: message`). */
function firstIssue(issues: readonly { path: readonly (string | number)[]; message: string }[]): string {
  const issue = issues[0];
  if (!issue) return "The form is not complete.";
  return issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`;
}

/** The load unit a line's fixed basis needs, or `null` when the load is not used by the bill. */
function lockedUnit(line: TariffLineDto | undefined): LoadUnit | null {
  return line ? loadUnitForBasis(line.fixedBasis) : null;
}

/**
 * `F4.365` U8 (ADR 0134 decision 3; plan Q10) — a location's tariff mappings, reached from the
 * "Tariff" row action on the Locations screen: which tariff line bills the location, through
 * which meter, at which sanctioned load, over which months. Each date is a month (plan D8); a
 * window's end is the first month it no longer covers.
 *
 * A line whose data status is not `official` carries the Verify badge (plan Q8). The line itself
 * is immutable on a mapping (`updateLocationTariffBodySchema`), so Edit restates it as text and a
 * change of line is End + Add. When the line's fixed basis is per load (kW, kVA, HP), the load
 * unit is that unit and its select is locked (`loadUnitForBasis`); the API refuses a mismatch.
 *
 * Write controls are absent for a role `canManageLocationTariffs` refuses; the server decides
 * per location (`canManageLocation`) and its refusal is rendered as its sentence.
 */
export function LocationTariffAdminPage({ user }: { user: AuthUser }) {
  const { locationId = "" } = useParams<{ locationId: string }>();
  const queryClient = useQueryClient();
  const canWrite = canManageLocationTariffs(user.role);
  const [dialog, setDialog] = useState<{ editing: LocationTariffDto | null } | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const summaryQ = useQuery({
    queryKey: ["admin", "location-summary", locationId],
    queryFn: () => fetchAdminLocationSummary(locationId),
    enabled: locationId !== "",
  });
  const organizationId = summaryQ.data?.organizationId ?? "";
  // The location's own zone (its organization's when it has none): "this month" is the bill's month.
  const zone = summaryQ.data?.timeZone;

  const mappingsQ = useQuery({
    queryKey: locationTariffsQueryKey(locationId),
    queryFn: () => fetchLocationTariffs(locationId),
    enabled: locationId !== "",
  });
  const rows = mappingsQ.data?.items ?? [];

  const linesQ = useQuery({
    queryKey: tariffLinesQueryKey(organizationId),
    queryFn: () => fetchTariffLines({ organizationId }),
    enabled: organizationId !== "",
  });
  const lines = linesQ.data?.items ?? [];
  const lineByKey = new Map(lines.map((line) => [line.key, line]));

  async function invalidate(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: locationTariffsQueryKey(locationId) });
  }

  const endMutation = useMutation({
    mutationFn: (row: LocationTariffDto) =>
      updateLocationTariff(locationId, row.id, updateLocationTariffBodySchema.parse({ effectiveTo: nextMonthStart(new Date(), zone) })),
    onSuccess: async () => {
      setListError(null);
      await invalidate();
    },
    onError: (cause: Error) => setListError(apiErrorMessage(cause)),
  });

  const deleteMutation = useMutation({
    mutationFn: (row: LocationTariffDto) => deleteLocationTariff(locationId, row.id),
    onSuccess: async () => {
      setListError(null);
      await invalidate();
    },
    onError: (cause: Error) => setListError(apiErrorMessage(cause)),
  });

  function end(row: LocationTariffDto): void {
    const next = nextMonthStart(new Date(), zone);
    if (!window.confirm(`End ${row.tariffName ?? row.tariffKey} after this month? It stops billing from ${monthLabel(next)}.`)) {
      return;
    }
    endMutation.mutate(row);
  }

  function remove(row: LocationTariffDto): void {
    if (!window.confirm(`Delete the mapping to ${row.tariffName ?? row.tariffKey}? This cannot be undone.`)) {
      return;
    }
    deleteMutation.mutate(row);
  }

  const locationName = summaryQ.data ? `${summaryQ.data.code} · ${summaryQ.data.name}` : "Location";

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title={`Tariff · ${locationName}`}
        subtitle="The utility tariff that prices this location's energy: the line, the billing meter, the sanctioned load and the months it covers"
        actions={
          canWrite ? (
            <button
              type="button"
              className={primaryClass}
              disabled={organizationId === ""}
              onClick={() => setDialog({ editing: null })}
            >
              Add tariff
            </button>
          ) : null
        }
      />

      <p className="text-xs">
        <Link className={actionClass} to="/admin/locations">
          Back to locations
        </Link>
      </p>

      {listError ? (
        <div role="alert" className="mb-4 rounded border border-critical-line-strong bg-critical-wash p-3 text-sm text-critical-ink-strong">
          {listError}
        </div>
      ) : null}

      <SectionCard title="Tariff mappings" bodyClassName="p-3 space-y-3">
        {mappingsQ.isLoading ? <p className="text-sm text-ink-muted">Loading mappings…</p> : null}
        {mappingsQ.isError ? (
          <p role="alert" className="text-sm text-critical-ink">
            {apiErrorMessage(mappingsQ.error)}
          </p>
        ) : null}
        {mappingsQ.isSuccess && rows.length === 0 ? (
          <p className="text-sm text-ink-muted">This location is not mapped to a tariff. Its cost uses the flat tariff parameter.</p>
        ) : null}

        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Tariff</th>
              <th className="px-2 py-2">Billing meter</th>
              <th className="px-2 py-2">Sanctioned load</th>
              <th className="px-2 py-2">From</th>
              <th className="px-2 py-2">Until (excl.)</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const endingThis = endMutation.isPending && endMutation.variables?.id === row.id;
              const deletingThis = deleteMutation.isPending && deleteMutation.variables?.id === row.id;
              const name = row.tariffName ?? row.tariffKey;
              return (
                <tr key={row.id} className="border-b border-well-deep">
                  <td className="px-2 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      {name}
                      {row.dataStatus !== null && row.dataStatus !== "official" ? <TariffVerifyBadge /> : null}
                    </span>
                    <code className="block text-xs text-ink-muted">{row.tariffKey}</code>
                  </td>
                  <td className="px-2 py-2">{row.billingMeterName ?? row.billingMeterAssetId}</td>
                  <td className="px-2 py-2 font-mono">
                    {row.sanctionedLoad} {loadUnitLabel(row.sanctionedLoadUnit)}
                  </td>
                  <td className="px-2 py-2">{monthLabel(row.effectiveFrom)}</td>
                  <td className="px-2 py-2">{row.effectiveTo ? monthLabel(row.effectiveTo) : "open"}</td>
                  <td className="px-2 py-2">
                    {canWrite ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={actionClass}
                          aria-label={`Edit ${name}`}
                          onClick={() => setDialog({ editing: row })}
                        >
                          Edit
                        </button>
                        {row.effectiveTo === null ? (
                          <button
                            type="button"
                            className={actionClass}
                            disabled={endMutation.isPending}
                            aria-busy={endingThis}
                            aria-label={endingThis ? `Ending ${name}…` : `End ${name}`}
                            onClick={() => end(row)}
                          >
                            {endingThis ? "Ending…" : "End"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-xs font-semibold text-critical-ink"
                          disabled={deleteMutation.isPending}
                          aria-busy={deletingThis}
                          aria-label={deletingThis ? `Deleting ${name}…` : `Delete ${name}`}
                          onClick={() => remove(row)}
                        >
                          {deletingThis ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-muted">Read only</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>

      {dialog && canWrite ? (
        <LocationTariffForm
          zone={zone}
          key={dialog.editing?.id ?? "create"}
          locationId={locationId}
          editing={dialog.editing}
          lines={lines}
          lineByKey={lineByKey}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await invalidate();
          }}
        />
      ) : null}
    </MasterDataLayout>
  );
}

type LocationTariffFormProps = {
  locationId: string;
  editing: LocationTariffDto | null;
  /** The location's zone (`AdminLocationSummaryDto.timeZone`); the browser's until it loads. */
  zone: string | undefined;
  lines: readonly TariffLineDto[];
  lineByKey: ReadonlyMap<string, TariffLineDto>;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

function initialForm(editing: LocationTariffDto | null, zone: string | undefined): FormState {
  if (editing) {
    return {
      state: "",
      search: "",
      tariffKey: editing.tariffKey,
      billingMeterAssetId: editing.billingMeterAssetId,
      sanctionedLoad: String(editing.sanctionedLoad),
      sanctionedLoadUnit: editing.sanctionedLoadUnit,
      effectiveFrom: toMonthInput(editing.effectiveFrom),
      effectiveTo: toMonthInput(editing.effectiveTo),
    };
  }
  return {
    state: "",
    search: "",
    tariffKey: "",
    billingMeterAssetId: "",
    sanctionedLoad: "",
    sanctionedLoadUnit: "kw",
    effectiveFrom: currentMonthInput(new Date(), zone),
    effectiveTo: "",
  };
}

/**
 * The add/edit modal. Add picks the line by state, then a search over key, name and code, then
 * the category; Edit restates the line. The meter list is the location's own active assets
 * (`fetchAdminAssets`). The body is parsed with the route's own schema before it is sent, so the
 * request is exactly the contract's shape, and a refusal is the server's sentence.
 */
function LocationTariffForm({ locationId, editing, zone, lines, lineByKey, onClose, onSaved }: LocationTariffFormProps) {
  const [form, setFormState] = useState<FormState>(() => initialForm(editing, zone));
  const [error, setError] = useState<string | null>(null);

  function setForm(next: FormState): void {
    setError(null);
    setFormState(next);
  }

  const assetsQ = useQuery({
    queryKey: ["admin", "assets", "true", locationId],
    queryFn: () => fetchAdminAssets("true", locationId),
  });
  const assets = assetsQ.data?.items ?? [];

  const states = [...new Set(lines.map((line) => line.state))].sort((a, b) => a.localeCompare(b));
  const needle = form.search.trim().toLowerCase();
  const candidates = lines.filter(
    (line) =>
      (form.state === "" || line.state === form.state) &&
      (needle === "" ||
        line.key.toLowerCase().includes(needle) ||
        line.name.toLowerCase().includes(needle) ||
        line.code.toLowerCase().includes(needle)),
  );
  const line = lineByKey.get(form.tariffKey);
  const unitLock = lockedUnit(line);
  const unit = unitLock ?? form.sanctionedLoadUnit;

  const saveMutation = useMutation({
    mutationFn: async (body: unknown) => {
      if (editing) {
        return updateLocationTariff(locationId, editing.id, updateLocationTariffBodySchema.parse(body));
      }
      return createLocationTariff(locationId, createLocationTariffBodySchema.parse(body));
    },
    onSuccess: onSaved,
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  function submit(): void {
    const fields = {
      billingMeterAssetId: form.billingMeterAssetId,
      sanctionedLoad: form.sanctionedLoad.trim() === "" ? undefined : Number(form.sanctionedLoad),
      sanctionedLoadUnit: unit,
      effectiveFrom: fromMonthInput(form.effectiveFrom) ?? undefined,
      effectiveTo: fromMonthInput(form.effectiveTo),
    };
    const body = editing ? fields : { tariffKey: form.tariffKey, ...fields };
    const parsed = editing ? updateLocationTariffBodySchema.safeParse(body) : createLocationTariffBodySchema.safeParse(body);
    if (!parsed.success) {
      setError(firstIssue(parsed.error.issues));
      return;
    }
    saveMutation.mutate(parsed.data);
  }

  const title = editing ? "Edit tariff mapping" : "Add tariff mapping";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <div role="dialog" aria-label={title} className="max-h-[90vh] w-full max-w-lg overflow-y-auto surface-dialog p-4">
        <h2 className="font-condensed text-lg font-bold">{title}</h2>
        <div className="mt-3 space-y-3">
          {editing ? (
            <p className="text-xs text-ink-muted">
              {editing.tariffName ?? editing.tariffKey} · <code>{editing.tariffKey}</code> — to change the tariff, end this
              mapping and add another.
            </p>
          ) : (
            <>
              <label className={labelClass}>
                State
                <select className={fieldClass} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value, tariffKey: "" })}>
                  <option value="">All states</option>
                  {states.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Search
                <input
                  type="search"
                  className={fieldClass}
                  value={form.search}
                  placeholder="Name, code or key"
                  onChange={(e) => setForm({ ...form, search: e.target.value })}
                />
              </label>
              <label className={labelClass}>
                Category
                <select
                  className={fieldClass}
                  value={form.tariffKey}
                  required
                  onChange={(e) => {
                    const picked = lineByKey.get(e.target.value);
                    const lock = lockedUnit(picked);
                    setForm({ ...form, tariffKey: e.target.value, sanctionedLoadUnit: lock ?? form.sanctionedLoadUnit });
                  }}
                >
                  <option value="">{candidates.length === 0 ? "No category matches" : "Select category"}</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {`${candidate.state} · ${candidate.code} · ${candidate.name}${candidate.source === "organization" ? " (organization)" : ""}`}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {line ? (
            <div className="rounded border border-well-deep p-2 text-xs" aria-label="Selected tariff">
              <span className="flex flex-wrap items-center gap-2 font-semibold">
                {line.name}
                {line.dataStatus !== "official" ? <TariffVerifyBadge /> : null}
              </span>
              <span className="block text-ink-muted">
                {`Billed in ${energyUnitLabel(line.energyUnit)} · fixed charge ${fixedBasisLabel(line.fixedBasis)} · ${line.slabCount} slab${line.slabCount === 1 ? "" : "s"} · from ${monthLabel(line.effectiveFrom)}`}
              </span>
            </div>
          ) : null}

          <label className={labelClass}>
            Billing meter
            <select
              className={fieldClass}
              value={form.billingMeterAssetId}
              required
              onChange={(e) => setForm({ ...form, billingMeterAssetId: e.target.value })}
            >
              <option value="">Select meter</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.code} · {asset.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-3">
            <label className={`${labelClass} flex-1`}>
              Sanctioned load
              <input
                type="number"
                min={0}
                step="any"
                className={fieldClass}
                value={form.sanctionedLoad}
                required
                onChange={(e) => setForm({ ...form, sanctionedLoad: e.target.value })}
              />
            </label>
            <label className={labelClass}>
              Load unit
              <select
                className={fieldClass}
                value={unit}
                disabled={unitLock !== null}
                onChange={(e) => setForm({ ...form, sanctionedLoadUnit: e.target.value as LoadUnit })}
              >
                {LOAD_UNITS.map((option) => (
                  <option key={option} value={option}>
                    {loadUnitLabel(option)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {unitLock !== null && line ? (
            <p className="text-2xs text-ink-muted">{`This tariff charges ${fixedBasisLabel(line.fixedBasis)}, so the load is in ${loadUnitLabel(unitLock)}.`}</p>
          ) : null}

          <div className="flex gap-3">
            <label className={`${labelClass} flex-1`}>
              From month
              <input
                type="month"
                className={fieldClass}
                value={form.effectiveFrom}
                required
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
            </label>
            <label className={`${labelClass} flex-1`}>
              Until month (excl.)
              <input
                type="month"
                className={fieldClass}
                value={form.effectiveTo}
                onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
              />
            </label>
          </div>
          <p className="text-2xs text-ink-muted">Leave Until empty for an open-ended mapping; otherwise it is the first month not billed.</p>

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
