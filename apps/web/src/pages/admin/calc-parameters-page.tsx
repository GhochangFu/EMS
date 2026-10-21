import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CalcParameterDto, CalcParameterKeyDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchAdminAssets } from "../../api/admin/assets";
import {
  calcParameterKeysQueryKey,
  calcParametersQueryKey,
  createAdminCalcParameter,
  type CreateCalcParameterInput,
  deleteAdminCalcParameter,
  fetchAdminCalcParameters,
  fetchCalcParameterKeys,
  updateAdminCalcParameter,
  type UpdateCalcParameterInput,
} from "../../api/admin/calc-parameters";
import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { WizardShell } from "../../components/wizard/wizard-shell";
import {
  canWriteCalcParameters,
  canWriteOrganizationScopedCalcParameter,
  isGlobalAdmin,
} from "../../lib/admin-access";
import { toLocalDateTimeInputValue } from "../../lib/alarm-details";
import { apiErrorMessage } from "../../lib/api-error-message";
import { locationTreeOptions } from "../../lib/location-tree";
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
 *
 * An empty input is `undefined` (not set yet — the wizard's Review names it),
 * and an unreadable one is passed through as typed, so the body's schema
 * refuses it rather than `toISOString()` throwing during render.
 */
function localInputToIso(local: string): string | undefined {
  if (local === "") return undefined;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? local : at.toISOString();
}

/** The number the Value input holds; empty is `undefined`, never `Number("") === 0`. */
function valueOf(text: string): number | undefined {
  return text.trim() === "" ? undefined : Number(text);
}

/**
 * `F3.85` PR 11b (ADR 0099 decision 6) — the catalog entry a modal wizard
 * submits. The modal writes the literal id on the `entry` prop
 * (`entry={wizardEntry("calcParameter.create")}`), the form PR 9's stepper
 * gate detects. A missing entry is a build defect, so it throws rather than
 * rendering a shell with no steps.
 */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.85: the catalog has no entry "${id}"`);
  return entry;
}

/**
 * The `calcParameter.create` wizard's values, from the form's text.
 *
 * The scope NOT chosen is `null`, as before (at most one scope column; the
 * API's `superRefine` refuses both). The scope chosen with nothing picked
 * stays `""`, never `undefined`: `""` fails the uuid check and holds the
 * wizard on Scope, where `undefined` would drop the key and Review would
 * accept the body as an ORGANIZATION-scoped row the author never chose (the
 * old form's `scopeReady` gate).
 */
function createValues(form: FormState, organizationId: string): Record<string, unknown> {
  return {
    key: form.key === "" ? undefined : form.key,
    value: valueOf(form.value),
    organizationId,
    locationId: form.scope === "location" ? form.locationId : null,
    assetId: form.scope === "asset" ? form.assetId : null,
    effectiveFrom: localInputToIso(form.effectiveFrom),
    effectiveTo: form.effectiveTo === "" ? null : localInputToIso(form.effectiveTo),
  };
}

/**
 * The `calcParameter.update` wizard's values. A `datetime-local` input holds
 * minutes, so a stored 10:30:45 comes back as 10:30 — a PATCH that always sent
 * both dates would move the boundary 45 s earlier on a value-only edit and
 * could 409 against an abutting neighbour (PR 2 code review). A date is a
 * value only when the input differs from the stored instant's own round trip.
 *
 * An emptied start stays `""`, never `undefined`: the start is required, and
 * `undefined` would drop the key, so the PATCH would keep the stored start and
 * the author's edit would vanish without a message (the old input's `required`
 * blocked Save inside a `<form>`; the wizard is not one). `""` fails the
 * instant schema and holds the wizard on Effective dates, as create does.
 */
function updateValues(form: FormState, editing: CalcParameterDto): Record<string, unknown> {
  const fromUnchanged = form.effectiveFrom === toLocalDateTimeInputValue(editing.effectiveFrom);
  const toUnchanged =
    form.effectiveTo === (editing.effectiveTo ? toLocalDateTimeInputValue(editing.effectiveTo) : "");
  let effectiveFrom: string | undefined;
  if (!fromUnchanged) effectiveFrom = form.effectiveFrom === "" ? "" : localInputToIso(form.effectiveFrom);
  return {
    value: valueOf(form.value),
    effectiveFrom,
    effectiveTo: toUnchanged ? undefined : form.effectiveTo === "" ? null : localInputToIso(form.effectiveTo),
  };
}

/**
 * The copilot's `fill_step` values (`WizardShell` merges them into the named
 * step and hands the whole set back) written into the form's text. A field
 * the fill did not carry, or carried with the wrong type, keeps its text.
 * A scope follows the id that was filled.
 */
function formWithValues(form: FormState, values: Readonly<Record<string, unknown>>): FormState {
  const next = { ...form };
  if (typeof values.key === "string") next.key = values.key;
  if (typeof values.value === "number") next.value = String(values.value);
  if (typeof values.assetId === "string" && values.assetId !== "" && values.assetId !== form.assetId) {
    next.scope = "asset";
    next.assetId = values.assetId;
  } else if (
    typeof values.locationId === "string" &&
    values.locationId !== "" &&
    values.locationId !== form.locationId
  ) {
    next.scope = "location";
    next.locationId = values.locationId;
    next.assetId = "";
  }
  // `""` is the edit's emptied start (`updateValues`); it stays empty rather
  // than becoming `toLocalDateTimeInputValue("")`'s "NaN-NaN-…".
  if (values.effectiveFrom === "") next.effectiveFrom = "";
  else if (typeof values.effectiveFrom === "string" && localInputToIso(form.effectiveFrom) !== values.effectiveFrom) {
    next.effectiveFrom = toLocalDateTimeInputValue(values.effectiveFrom);
  }
  if (values.effectiveTo === null) next.effectiveTo = "";
  else if (typeof values.effectiveTo === "string" && localInputToIso(form.effectiveTo) !== values.effectiveTo) {
    next.effectiveTo = toLocalDateTimeInputValue(values.effectiveTo);
  }
  return next;
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
 * predicate's call — the page READS the predicate; the gate itself (the radio
 * absent from the DOM) is held by the jsdom spec alone, and a scan cannot
 * hold it (post-merge sweep F1: an unconditional radio kept the scan green).
 *
 * **Edit cannot change key or scope** (design decision 12): the PATCH body
 * carries `value`, `effectiveFrom`, `effectiveTo` only and is `.strict()`,
 * so a re-scope is delete + create. Since `F3.85` PR 11b the modal is a
 * wizard on the shared shell (ADR 0099 decision 6) — see `CalcParameterForm`.
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

  // `F3.85` PR 11b — the wizard's Review parsed `body` against the catalog
  // entry's schema, and the request is that body: what Review showed is what
  // is sent. No `X-Copilot-Change` — a wizard used alone is not a copilot
  // change (plan §10.5 as built).
  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) {
        return updateAdminCalcParameter(editing.id, body as UpdateCalcParameterInput);
      }
      return createAdminCalcParameter(body as CreateCalcParameterInput);
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
              className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
              onClick={openCreate}
              disabled={organizationId === ""}
            >
              Add parameter
            </button>
          ) : null
        }
      />

      {listError ? (
        <div role="alert" className="mb-4 rounded border border-critical-line-strong bg-critical-wash p-3 text-sm text-critical-ink-strong">
          {listError}
        </div>
      ) : null}

      <SectionCard title="Parameter values" bodyClassName="p-3 space-y-3">
        {!orgLocked ? (
          <div className="flex flex-wrap gap-3">
            <label className="text-xs font-semibold text-ink-muted">
              Organization
              <select
                className="ml-2 surface-field px-3 py-1.5 text-xs font-normal"
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

        {listQ.isLoading ? <p className="text-sm text-ink-muted">Loading parameters…</p> : null}
        {listQ.isError ? (
          <p role="alert" className="text-sm text-critical-ink">
            {apiErrorMessage(listQ.error)}
          </p>
        ) : null}
        {organizationId !== "" && !listQ.isLoading && !listQ.isError && rows.length === 0 ? (
          <p className="text-sm text-ink-muted">No parameter values for this organization.</p>
        ) : null}

        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
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
              const deletingThis =
                deleteMutation.isPending && deleteMutation.variables?.id === row.id;
              return (
                <tr key={row.id} className="border-b border-well-deep">
                  <td className="px-2 py-2">
                    <span className="block">
                      {key?.label ?? row.key}
                      {key?.unit ? <span className="text-ink-muted"> ({key.unit})</span> : null}
                    </span>
                    <code className="block text-xs text-ink-muted">{row.key}</code>
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
                          className="text-xs font-semibold text-accent-strong"
                          onClick={() => openEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-critical-ink"
                          disabled={deleteMutation.isPending}
                          aria-busy={deletingThis}
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

      {modalOpen && canWrite ? (
        <CalcParameterForm
          editing={editing}
          keys={keys}
          organizationId={organizationId}
          canOrgScope={canOrgScope}
          form={form}
          setForm={(next) => {
            // A refusal names the values it refused; once they change it is stale.
            setError(null);
            setForm(next);
          }}
          error={error}
          pending={saveMutation.isPending}
          onCancel={() => setModalOpen(false)}
          onSubmit={(body) => saveMutation.mutate(body)}
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
  onSubmit: (body: Record<string, unknown>) => void;
};

/**
 * The modal. Its own component so the location and asset reads are mounted
 * only while it is open, and only for the scope that needs them.
 *
 * `F3.85` PR 11b (ADR 0099 decision 6) — the modal is a wizard on the shared
 * shell: Add is `calcParameter.create` (Basics → Scope → Effective dates →
 * Review), Edit is `calcParameter.update` (Value → Effective dates → Review,
 * the stored value beside the new one). The page keeps the form's text in
 * `FormState`; the wizard's values are mapped from it on every render, and a
 * copilot fill is mapped back. A refused request's sentence is the Review
 * card's error.
 *
 * Edit has no key or scope step (design decision 12): the PATCH body carries
 * `value`, `effectiveFrom`, `effectiveTo` only and is `.strict()`, so the row's
 * key and scope are restated as text, because a re-scope is delete + create.
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

  const keyField = (
    <label className="block text-xs font-semibold text-ink-muted">
      Key
      <select
        className="mt-1 surface-field w-full px-3 py-2 text-sm"
        value={form.key}
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
  );

  const valueField = (
    <label className="block text-xs font-semibold text-ink-muted">
      Value
      <input
        type="number"
        step="any"
        className="mt-1 w-full surface-field px-3 py-2 text-sm"
        value={form.value}
        required
        onChange={(event) => setForm({ ...form, value: event.target.value })}
      />
    </label>
  );

  const scopeFields = (
    <>
      <fieldset>
        <legend className="text-xs font-semibold text-ink-muted">Scope</legend>
        <div className="mt-1 flex flex-wrap gap-4">
          {scopeOptions.map((option) => (
            <label key={option.value} className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                name="scope"
                value={option.value}
                checked={form.scope === option.value}
                onChange={() => setForm({ ...form, scope: option.value, locationId: "", assetId: "" })}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {form.scope !== "organization" ? (
        <label className="block text-xs font-semibold text-ink-muted">
          Location
          <select
            className="mt-1 w-full surface-field px-3 py-2 text-sm"
            value={form.locationId}
            required
            onChange={(event) => setForm({ ...form, locationId: event.target.value, assetId: "" })}
          >
            <option value="">Select location</option>
            {/* `F2.10` (ADR 0098 B11) — the tree depth-first, the code inside the dashes. */}
            {locationTreeOptions(
              locationsQ.data?.items ?? [],
              (location) => `${location.code} · ${location.name}`,
            ).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {form.scope === "asset" ? (
        <label className="block text-xs font-semibold text-ink-muted">
          Asset
          <select
            className="mt-1 w-full surface-field px-3 py-2 text-sm"
            value={form.assetId}
            required
            disabled={form.locationId === ""}
            onChange={(event) => setForm({ ...form, assetId: event.target.value })}
          >
            <option value="">{form.locationId === "" ? "Select a location first" : "Select asset"}</option>
            {(assetsQ.data?.items ?? []).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.code} · {asset.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );

  const dateFields = (
    <>
      <label className="block text-xs font-semibold text-ink-muted">
        Effective from
        <input
          type="datetime-local"
          className="mt-1 w-full surface-field px-3 py-2 text-sm"
          value={form.effectiveFrom}
          required
          onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
        />
      </label>
      <div>
        <label className="block text-xs font-semibold text-ink-muted">
          Effective to
          <input
            type="datetime-local"
            className="mt-1 w-full surface-field px-3 py-2 text-sm"
            value={form.effectiveTo}
            onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })}
          />
        </label>
        <p className="mt-1 text-[11px] text-ink-muted">Leave empty for an open-ended value.</p>
      </div>
    </>
  );

  const basicsFields = (
    <>
      {keyField}
      {valueField}
    </>
  );

  // Every step's elements are built above, in this render, and `renderStep`
  // only picks one. Built inside `renderStep`, they would be new elements on
  // every shell render, and a new element on a render between a `<select>`'s
  // events re-commits the controlled value and can lose the first pick in a
  // clean wizard. (The shell marks itself dirty on the bubbled `onChange`
  // since `F3.85` PR 9, not on `input`; stable elements keep that safe.)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <div
        role="dialog"
        aria-label={editing ? "Edit parameter value" : "Add parameter value"}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto surface-dialog p-4"
      >
        <h2 className="font-condensed text-lg font-bold">
          {editing ? "Edit parameter value" : "Add parameter value"}
        </h2>
        {editing ? (
          <>
            <p className="mt-1 text-xs text-ink-muted">
              {keys.find((key) => key.code === editing.key)?.label ?? editing.key} ·{" "}
              <code>{editing.key}</code>
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {scopeLabel(editing)} — to move a value to another scope, delete it and add it again.
            </p>
            <div className="mt-3">
              <WizardShell
                key={`update-${editing.id}`}
                entry={wizardEntry("calcParameter.update")}
                params={{ id: editing.id }}
                values={updateValues(form, editing)}
                onChange={(values) => setForm(formWithValues(form, values))}
                renderStep={(step) => (step.id === "value" ? valueField : dateFields)}
                onSubmit={onSubmit}
                onCancel={onCancel}
                submitting={pending}
                submitError={error}
                current={{
                  value: editing.value,
                  effectiveFrom: editing.effectiveFrom,
                  effectiveTo: editing.effectiveTo,
                }}
              />
            </div>
          </>
        ) : (
          <div className="mt-3">
            <WizardShell
              key="create"
              entry={wizardEntry("calcParameter.create")}
              params={{}}
              values={createValues(form, organizationId)}
              onChange={(values) => setForm(formWithValues(form, values))}
              renderStep={(step) => {
                if (step.id === "basics") return basicsFields;
                return step.id === "scope" ? scopeFields : dateFields;
              }}
              onSubmit={onSubmit}
              onCancel={onCancel}
              submitting={pending}
              submitError={error}
            />
          </div>
        )}
      </div>
    </div>
  );
}
