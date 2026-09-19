import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import type { CalcParameterDto, CalcParameterKeyDto } from "@bms/shared";

import { fetchAdminAssets } from "../../api/admin/assets";
import {
  calcParameterKeysQueryKey,
  calcParametersQueryKey,
  createAdminCalcParameter,
  deleteAdminCalcParameter,
  fetchAdminCalcParameters,
  fetchCalcParameterKeys,
  updateAdminCalcParameter,
} from "../../api/admin/calc-parameters";
import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import {
  canWriteCalcParameters,
  canWriteOrganizationScopedCalcParameter,
  isGlobalAdmin,
} from "../../lib/admin-access";
import { toLocalDateTimeInputValue } from "../../lib/alarm-details";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type CalcParametersAdminPageProps = { user: AuthUser };

/** The three scopes a row can carry (ADR 0070 decision 2): at most one column set. */
type ScopeKind = "organization" | "location" | "asset";

type FormState = {
  key: string;
  scope: ScopeKind;
  locationId: string;
  assetId: string;
  /** Kept as text; `Number()` on submit, so a half-typed `-` does not become `NaN` in state. */
  value: string;
  /** `datetime-local` wall-clock strings; converted to ISO with an offset on submit. */
  effectiveFrom: string;
  effectiveTo: string;
};

const ISO_LABEL = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function scopeOf(row: Pick<CalcParameterDto, "locationId" | "assetId">): ScopeKind {
  if (row.assetId) return "asset";
  if (row.locationId) return "location";
  return "organization";
}

/** "Organization", "Location · <name>" or "Asset · <code>" — the table's scope cell. */
function scopeLabel(row: CalcParameterDto): string {
  switch (scopeOf(row)) {
    case "asset":
      return `Asset · ${row.assetCode ?? row.assetId}`;
    case "location":
      return `Location · ${row.locationName ?? row.locationId}`;
    default:
      return "Organization";
  }
}

function keyOptionLabel(key: CalcParameterKeyDto): string {
  return key.unit ? `${key.label} (${key.unit}) · ${key.code}` : `${key.label} · ${key.code}`;
}

/**
 * A `datetime-local` value is an unzoned wall-clock string. The API's
 * `z.string().datetime({ offset: true })` refuses it as-is, so the browser's
 * own zone is applied here — `new Date("YYYY-MM-DDTHH:mm")` reads local time —
 * and the instant is sent as UTC with the `Z` offset.
 */
function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

function emptyForm(canOrgScope: boolean): FormState {
  return {
    key: "",
    // The default is the FIRST scope the role is offered. For a role without
    // the organization option that is Location; defaulting to "organization"
    // and hiding the radio would submit a scope the form never showed.
    scope: canOrgScope ? "organization" : "location",
    locationId: "",
    assetId: "",
    value: "",
    effectiveFrom: toLocalDateTimeInputValue(new Date().toISOString()),
    effectiveTo: "",
  };
}

/**
 * `E4.1a` U9 (ADR 0070 decision 2) — the calc parameter store's admin screen:
 * one organization's rows, each a value of one key at one scope over one
 * validity window, and a modal form to add, edit or delete one.
 *
 * **The Organization scope radio is absent, not disabled, for a role
 * `canWriteOrganizationScopedCalcParameter` refuses** (plan design decision
 * 11; the `F3.1d` finding). A `location_admin` writing an organization-scoped
 * row is a 403 on the API, and an option that is shown and then clamped on
 * submit would silently write a different row from the one the author chose.
 * `tests/e4.1a-calc-parameters-surface-reachable.test.ts` scans for the
 * predicate's call so the gate outlives the jsdom spec.
 *
 * **Edit keeps key and scope disabled** (design decision 12): the PATCH body
 * carries `value`, `effectiveFrom`, `effectiveTo` only and is `.strict()`,
 * so a re-scope is delete + create.
 *
 * The organization `<select>` is hidden for a single-organization user, the
 * rule `HierarchyFilterBar` applies (`orgLocked`); that bar itself is not
 * used here because its organization change navigates away to the locations
 * screen. The list defaults to the first organization so the screen is never
 * empty behind a placeholder.
 */
export function CalcParametersAdminPage({ user }: CalcParametersAdminPageProps) {
  const queryClient = useQueryClient();
  const canWrite = canWriteCalcParameters(user.role);
  const canOrgScope = canWriteOrganizationScopedCalcParameter(user.role);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CalcParameterDto | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(canOrgScope));
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
  });
  const orgs = orgsQ.data?.items ?? [];
  const orgLocked = !isGlobalAdmin(user.role) && orgs.length <= 1;
  const organizationId = selectedOrgId || orgs[0]?.id || "";

  const keysQ = useQuery({
    queryKey: calcParameterKeysQueryKey,
    queryFn: fetchCalcParameterKeys,
  });
  const keys = keysQ.data?.items ?? [];
  const keyByCode = new Map(keys.map((key) => [key.code, key]));

  const listQ = useQuery({
    queryKey: calcParametersQueryKey(organizationId),
    queryFn: () => fetchAdminCalcParameters(organizationId),
    enabled: organizationId !== "",
  });
  const rows = listQ.data?.items ?? [];

  async function invalidateList(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["admin", "calc-parameters"] });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const edit = {
        value: Number(form.value),
        effectiveFrom: localInputToIso(form.effectiveFrom),
        effectiveTo: form.effectiveTo ? localInputToIso(form.effectiveTo) : null,
      };
      if (editing) {
        // A `datetime-local` input holds minutes, so a stored 10:30:45 comes
        // back as 10:30 — a PATCH that always sent both dates would move the
        // boundary 45 s earlier on a value-only edit and could 409 against an
        // abutting neighbour (PR 2 code review). A date is sent only when the
        // input differs from the stored instant's own round trip.
        const fromUnchanged = form.effectiveFrom === toLocalDateTimeInputValue(editing.effectiveFrom);
        const toUnchanged =
          form.effectiveTo === (editing.effectiveTo ? toLocalDateTimeInputValue(editing.effectiveTo) : "");
        return updateAdminCalcParameter(editing.id, {
          value: edit.value,
          ...(fromUnchanged ? {} : { effectiveFrom: edit.effectiveFrom }),
          ...(toUnchanged ? {} : { effectiveTo: edit.effectiveTo }),
        });
      }
      return createAdminCalcParameter({
        organizationId,
        key: form.key,
        // At most one scope column; the API's `superRefine` refuses both.
        locationId: form.scope === "location" ? form.locationId : null,
        assetId: form.scope === "asset" ? form.assetId : null,
        ...edit,
      });
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await invalidateList();
    },
    // The 409 names the clashing window; the author reads that sentence, not JSON.
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  const deleteMutation = useMutation({
    mutationFn: (row: CalcParameterDto) => deleteAdminCalcParameter(row.id),
    onSuccess: async () => {
      setListError(null);
      await invalidateList();
    },
    onError: (cause: Error) => setListError(apiErrorMessage(cause)),
  });

  /** Whether this role may write THIS row — an organization-scoped row needs the organization gate. */
  function canWriteRow(row: CalcParameterDto): boolean {
    return canWrite && (scopeOf(row) !== "organization" || canOrgScope);
  }

  function openCreate(): void {
    setEditing(null);
    setForm(emptyForm(canOrgScope));
    setError(null);
    setModalOpen(true);
  }

  function openEdit(row: CalcParameterDto): void {
    setEditing(row);
    setForm({
      key: row.key,
      scope: scopeOf(row),
      locationId: row.locationId ?? "",
      assetId: row.assetId ?? "",
      value: String(row.value),
      effectiveFrom: toLocalDateTimeInputValue(row.effectiveFrom),
      effectiveTo: row.effectiveTo ? toLocalDateTimeInputValue(row.effectiveTo) : "",
    });
    setError(null);
    setModalOpen(true);
  }

  function remove(row: CalcParameterDto): void {
    const key = keyByCode.get(row.key)?.label ?? row.key;
    if (!window.confirm(`Delete the ${key} value at ${scopeLabel(row)}? This cannot be undone.`)) {
      return;
    }
    deleteMutation.mutate(row);
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Calc Parameters"
        subtitle="Named values a v3 formula reads as $key — tariffs, factors, baselines, ratings — by scope and validity window"
        actions={
          canWrite ? (
            <button
              type="button"
              className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
              onClick={openCreate}
              disabled={organizationId === ""}
            >
              Add parameter
            </button>
          ) : null
        }
      />

      {listError ? (
        <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {listError}
        </div>
      ) : null}

      <SectionCard title="Parameter values" bodyClassName="p-3 space-y-3">
        {!orgLocked ? (
          <div className="flex flex-wrap gap-3">
            <label className="text-xs font-semibold text-bms-muted">
              Organization
              <select
                className="ml-2 rounded border border-gray-200 px-3 py-1.5 text-xs font-normal"
                value={organizationId}
                onChange={(event) => setSelectedOrgId(event.target.value)}
              >
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.code} · {org.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {listQ.isLoading ? <p className="text-sm text-slate-500">Loading parameters…</p> : null}
        {listQ.isError ? (
          <p role="alert" className="text-sm text-red-700">
            {apiErrorMessage(listQ.error)}
          </p>
        ) : null}
        {organizationId !== "" && !listQ.isLoading && !listQ.isError && rows.length === 0 ? (
          <p className="text-sm text-slate-500">No parameter values for this organization.</p>
        ) : null}

        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-bms-muted">
              <th className="px-2 py-2">Key</th>
              <th className="px-2 py-2">Scope</th>
              <th className="px-2 py-2">Value</th>
              <th className="px-2 py-2">From</th>
              <th className="px-2 py-2">To</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = keyByCode.get(row.key);
              return (
                <tr key={row.id} className="border-b border-gray-100">
                  <td className="px-2 py-2">
                    <span className="block">
                      {key?.label ?? row.key}
                      {key?.unit ? <span className="text-bms-muted"> ({key.unit})</span> : null}
                    </span>
                    <code className="block text-xs text-bms-muted">{row.key}</code>
                  </td>
                  <td className="px-2 py-2">{scopeLabel(row)}</td>
                  <td className="px-2 py-2 font-mono">{row.value}</td>
                  <td className="px-2 py-2">{ISO_LABEL.format(new Date(row.effectiveFrom))}</td>
                  <td className="px-2 py-2">
                    {row.effectiveTo ? ISO_LABEL.format(new Date(row.effectiveTo)) : "open"}
                  </td>
                  <td className="px-2 py-2">
                    {canWriteRow(row) ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="text-xs font-semibold text-bms-green"
                          onClick={() => openEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-700"
                          disabled={deleteMutation.isPending}
                          onClick={() => remove(row)}
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-bms-muted">Read only</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>

      {modalOpen && canWrite ? (
        <CalcParameterForm
          editing={editing}
          keys={keys}
          organizationId={organizationId}
          canOrgScope={canOrgScope}
          form={form}
          setForm={setForm}
          error={error}
          pending={saveMutation.isPending}
          onCancel={() => setModalOpen(false)}
          onSubmit={() => saveMutation.mutate()}
        />
      ) : null}
    </MasterDataLayout>
  );
}

type CalcParameterFormProps = {
  editing: CalcParameterDto | null;
  keys: readonly CalcParameterKeyDto[];
  organizationId: string;
  canOrgScope: boolean;
  form: FormState;
  setForm: (next: FormState) => void;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
};

/**
 * The modal form. Its own component so the location and asset reads are
 * mounted only while the form is open, and only for the scope that needs them.
 *
 * In edit mode the key `<select>` and every scope control are `disabled`
 * (design decision 12) and the row's scope is restated as text, because an
 * asset-scoped row carries no `locationId` to seed the location `<select>`.
 */
function CalcParameterForm({
  editing,
  keys,
  organizationId,
  canOrgScope,
  form,
  setForm,
  error,
  pending,
  onCancel,
  onSubmit,
}: CalcParameterFormProps) {
  const locked = editing !== null;

  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true", organizationId],
    queryFn: () => fetchAdminLocations("true", organizationId),
    enabled: !locked && form.scope !== "organization" && organizationId !== "",
  });
  const assetsQ = useQuery({
    queryKey: ["admin", "assets", "true", form.locationId],
    queryFn: () => fetchAdminAssets("true", form.locationId),
    enabled: !locked && form.scope === "asset" && form.locationId !== "",
  });

  const scopeOptions: ReadonlyArray<{ value: ScopeKind; label: string }> = [
    // Absent from the DOM for a role the API would refuse, never disabled
    // (`F3.1d` §6.2 "forms, not buttons"; plan design decision 11).
    ...(canOrgScope ? [{ value: "organization" as const, label: "Organization" }] : []),
    { value: "location" as const, label: "Location" },
    { value: "asset" as const, label: "Asset" },
  ];

  const scopeReady =
    form.scope === "organization" ||
    (form.scope === "location" && form.locationId !== "") ||
    (form.scope === "asset" && form.assetId !== "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-white p-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <h2 className="font-condensed text-lg font-bold">
          {editing ? "Edit parameter value" : "Add parameter value"}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
            Key
            <select
              className="mt-1 w-full rounded border px-3 py-2 text-sm disabled:bg-gray-50"
              value={form.key}
              disabled={locked}
              required
              onChange={(event) => setForm({ ...form, key: event.target.value })}
            >
              <option value="">Select key</option>
              {keys.map((key) => (
                <option key={key.code} value={key.code}>
                  {keyOptionLabel(key)}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-semibold text-bms-muted">Scope</legend>
            <div className="mt-1 flex flex-wrap gap-4">
              {scopeOptions.map((option) => (
                <label key={option.value} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name="scope"
                    value={option.value}
                    checked={form.scope === option.value}
                    disabled={locked}
                    onChange={() =>
                      setForm({ ...form, scope: option.value, locationId: "", assetId: "" })
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {locked && editing ? (
              <p className="mt-1 text-xs text-bms-muted">
                {scopeLabel(editing)} — to move a value to another scope, delete it and add it again.
              </p>
            ) : null}
          </fieldset>

          {!locked && form.scope !== "organization" ? (
            <label className="block text-xs font-semibold text-bms-muted">
              Location
              <select
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={form.locationId}
                required
                onChange={(event) =>
                  setForm({ ...form, locationId: event.target.value, assetId: "" })
                }
              >
                <option value="">Select location</option>
                {(locationsQ.data?.items ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} · {location.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {!locked && form.scope === "asset" ? (
            <label className="block text-xs font-semibold text-bms-muted">
              Asset
              <select
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={form.assetId}
                required
                disabled={form.locationId === ""}
                onChange={(event) => setForm({ ...form, assetId: event.target.value })}
              >
                <option value="">
                  {form.locationId === "" ? "Select a location first" : "Select asset"}
                </option>
                {(assetsQ.data?.items ?? []).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.code} · {asset.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
            Value
            <input
              type="number"
              step="any"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={form.value}
              required
              onChange={(event) => setForm({ ...form, value: event.target.value })}
            />
          </label>
          <label className="block text-xs font-semibold text-bms-muted">
            Effective from
            <input
              type="datetime-local"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={form.effectiveFrom}
              required
              onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
            />
          </label>
          <div>
            <label className="block text-xs font-semibold text-bms-muted">
              Effective to
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={form.effectiveTo}
                onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })}
              />
            </label>
            <p className="mt-1 text-[11px] text-bms-muted">Leave empty for an open-ended value.</p>
          </div>
        </div>
        {error ? (
          <div role="alert" className="mt-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-2 text-xs" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={pending || (!locked && !scopeReady)}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
