import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { AdminLocationTypeDto, MasterDataActiveFilter } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  createLocationType,
  deactivateLocationType,
  fetchLocationTypeCatalog,
  reactivateLocationType,
  updateLocationType,
} from "../../api/admin/location-types";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { WizardShell } from "../../components/wizard/wizard-shell";
import { canManageLocationTypes } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type LocationTypesAdminPageProps = { user: AuthUser };

/** The API body's `.max()` (`contracts/location-type-writes.ts`). */
const SORT_ORDER_MAX = 100000;

/** The dropdown the locations form reads (`GET /admin/location-types`). */
const DROPDOWN_KEY = ["admin", "location-types"] as const;
/** This page's own read (`GET /admin/vocabularies/location-types`). */
const CATALOG_KEY = ["admin", "location-types-catalog"] as const;

/**
 * The form's sort-order text to the body value, the `rankValue` shape
 * (`point-keys-page.tsx`). Empty means "not sent": the create keeps the
 * column default (0) and the edit keeps the stored value. Text that is not a
 * whole number in range stays text, so the Type step's own check refuses it
 * before a request is made.
 */
function sortOrderValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed) || Number(trimmed) > SORT_ORDER_MAX) return trimmed;
  return Number(trimmed);
}

/**
 * `F4.282` (ADR 0099 Amendment 8 Q17) — the catalog entry a wizard submits.
 * Each `WizardShell` writes the literal id on its `entry` prop, the form the
 * stepper gate (`tests/f3.85-stepper-coverage`) detects. A missing entry is a
 * build defect, so it throws.
 */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.282: the catalog has no entry "${id}"`);
  return entry;
}

type FormState = { code: string; label: string; sortOrder: string };

const EMPTY_FORM: FormState = { code: "", label: "", sortOrder: "" };

/** A copilot `fill_step` (merged by the shell into the Type step) written back into the form's text. */
function formWithValues(form: FormState, values: Readonly<Record<string, unknown>>): FormState {
  const next = { ...form };
  if (typeof values.code === "string") next.code = values.code;
  if (typeof values.label === "string") next.label = values.label;
  if (typeof values.sortOrder === "number") next.sortOrder = String(values.sortOrder);
  return next;
}

/**
 * `F4.162` (ADR 0077 Amendment 1, plan D7) — the global-admin screen for the
 * location-type vocabulary, `bms.location_types`.
 *
 * **It fails closed at the page.** The tab is hidden from every role but
 * `admin` (the sidebar reaches it only through its Reference Data area, `F3.76`), but a typed URL still reaches this route
 * through `AdminRoute`, which admits every master-data role. For those roles
 * the page renders one status line and mounts no query: the catalog component
 * below is never rendered, so its read never starts (the API would answer
 * 403 anyway).
 *
 * `F4.282` (ADR 0099 Amendment 8 Q17) — Add and Edit are the
 * `locationType.create` / `locationType.update` wizards (Type → Review), and
 * Deactivate / Reactivate are Review-alone wizards whose sentence states how
 * many locations use the type, so every write here is the catalog route the
 * copilot proposes. A wizard used alone sends no `X-Copilot-Change` header.
 */
export function LocationTypesAdminPage({ user }: LocationTypesAdminPageProps) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Location Types"
        subtitle="Fleet-wide vocabulary of location types offered by the locations form and onboarding"
      />
      {canManageLocationTypes(user.role) ? (
        <LocationTypesCatalog />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Location types are managed by a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function LocationTypesCatalog() {
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminLocationTypeDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  // The type whose deactivate or reactivate Review is open.
  const [toggling, setToggling] = useState<AdminLocationTypeDto | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: CATALOG_KEY,
    queryFn: fetchLocationTypeCatalog,
  });

  const filtered = useMemo(() => {
    const items = listQ.data?.items ?? [];
    if (activeFilter === "all") return items;
    const wanted = activeFilter === "true";
    return items.filter((item) => item.active === wanted);
  }, [listQ.data?.items, activeFilter]);

  /** D6 — both reads: the locations form's dropdown and this page's list. */
  async function invalidateBoth(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: DROPDOWN_KEY });
    await queryClient.invalidateQueries({ queryKey: CATALOG_KEY });
  }

  // The wizard's body is the route's, parsed whole on Review before Submit.
  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      editing
        ? updateLocationType(editing.code, body as Parameters<typeof updateLocationType>[1])
        : createLocationType(body as Parameters<typeof createLocationType>[0]),
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await invalidateBoth();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminLocationTypeDto) =>
      item.active ? deactivateLocationType(item.code) : reactivateLocationType(item.code),
    onSuccess: async () => {
      setToggling(null);
      setToggleError(null);
      await invalidateBoth();
    },
    onError: (err: unknown) => setToggleError(apiErrorMessage(err)),
  });

  function openCreate(): void {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(item: AdminLocationTypeDto): void {
    setEditing(item);
    setForm({ code: item.code, label: item.label, sortOrder: String(item.sortOrder) });
    setError(null);
    setModalOpen(true);
  }

  function openToggle(item: AdminLocationTypeDto): void {
    setToggleError(null);
    setToggling(item);
  }

  const createValues = { code: form.code, label: form.label, sortOrder: sortOrderValue(form.sortOrder) };
  const updateValues = { label: form.label, sortOrder: sortOrderValue(form.sortOrder) };

  const typeFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      {editing ? null : (
        <div>
          <label htmlFor="location-type-code" className="block text-xs font-semibold text-ink-muted">
            Code
          </label>
          <input
            id="location-type-code"
            className="mt-1 surface-field w-full px-3 py-2 text-sm"
            value={form.code}
            required
            maxLength={32}
            aria-describedby="location-type-code-hint"
            onChange={(event) => setForm({ ...form, code: event.target.value })}
          />
          <p id="location-type-code-hint" className="mt-1 text-xs text-ink-muted">
            Lower-case letters, digits and _, starting with a letter — like pump_station. It cannot
            change after it is saved.
          </p>
        </div>
      )}
      <label className="block text-xs font-semibold text-ink-muted">
        Label
        <input
          className="mt-1 w-full surface-field px-3 py-2 text-sm"
          value={form.label}
          required
          maxLength={128}
          onChange={(event) => setForm({ ...form, label: event.target.value })}
        />
      </label>
      <div className="sm:col-span-2">
        <label htmlFor="location-type-sort-order" className="block text-xs font-semibold text-ink-muted">
          Sort order
        </label>
        <input
          id="location-type-sort-order"
          type="text"
          inputMode="numeric"
          aria-describedby="location-type-sort-order-hint"
          className="mt-1 w-full surface-field px-3 py-2 text-sm"
          value={form.sortOrder}
          onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
        />
        <p id="location-type-sort-order-hint" className="mt-1 text-xs text-ink-muted">
          Lower shows first in the locations form. Leave empty to keep the current value (0 for a new type).
        </p>
      </div>
    </div>
  );

  const toggleProps = {
    values: {},
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: () => {
      if (toggling) toggleMutation.mutate(toggling);
    },
    onCancel: () => setToggling(null),
    submitting: toggleMutation.isPending,
    submitError: toggleError,
  };
  const toggleSummary = (id: string) =>
    toggling
      ? wizardEntry(id).summary({
          body: {},
          params: { code: toggling.code },
          targetName: toggling.label,
          organizationName: "",
          usageCount: toggling.locationCount,
        })
      : undefined;

  return (
    <>
      <SectionCard title="Location type catalog" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            onClick={openCreate}
          >
            Add location type
          </button>
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Label</th>
              <th className="px-2 py-2">Sort order</th>
              <th className="px-2 py-2">Locations</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.code} className="border-b border-well-deep">
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2">{item.label}</td>
                <td className="px-2 py-2">{item.sortOrder}</td>
                <td className="px-2 py-2">{item.locationCount}</td>
                <td className="px-2 py-2">
                  <StatusPill
                    label={item.active ? "Active" : "Inactive"}
                    tone={item.active ? "ok" : "offline"}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent-strong"
                      onClick={() => openEdit(item)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink-muted"
                      onClick={() => openToggle(item)}
                    >
                      {item.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <div
            role="dialog"
            aria-label={editing ? "Edit location type" : "Add location type"}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto surface-dialog p-4"
          >
            <h2 className="font-condensed text-lg font-bold">
              {editing ? `Edit location type ${editing.code}` : "Add location type"}
            </h2>
            <div className="mt-3">
              {editing ? (
                <WizardShell
                  key={`update-${editing.code}`}
                  entry={wizardEntry("locationType.update")}
                  params={{ code: editing.code }}
                  values={updateValues}
                  onChange={(values) => setForm(formWithValues(form, values))}
                  renderStep={() => typeFields}
                  onSubmit={(body) => saveMutation.mutate(body)}
                  onCancel={() => setModalOpen(false)}
                  submitting={saveMutation.isPending}
                  submitError={error}
                  current={{ label: editing.label, sortOrder: editing.sortOrder }}
                />
              ) : (
                <WizardShell
                  key="create"
                  entry={wizardEntry("locationType.create")}
                  params={{}}
                  values={createValues}
                  onChange={(values) => setForm(formWithValues(form, values))}
                  renderStep={() => typeFields}
                  onSubmit={(body) => saveMutation.mutate(body)}
                  onCancel={() => setModalOpen(false)}
                  submitting={saveMutation.isPending}
                  submitError={error}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {toggling !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <div
            role="dialog"
            aria-label={toggling.active ? "Deactivate location type" : "Reactivate location type"}
            className="w-full max-w-lg surface-dialog p-4"
          >
            <h2 className="font-condensed text-lg font-bold">
              {toggling.active ? "Deactivate" : "Reactivate"} {toggling.code}
            </h2>
            <div className="mt-3">
              {toggling.active ? (
                <WizardShell
                  key={`deactivate-${toggling.code}`}
                  entry={wizardEntry("locationType.deactivate")}
                  {...toggleProps}
                  params={{ code: toggling.code }}
                  summary={toggleSummary("locationType.deactivate")}
                />
              ) : (
                <WizardShell
                  key={`reactivate-${toggling.code}`}
                  entry={wizardEntry("locationType.reactivate")}
                  {...toggleProps}
                  params={{ code: toggling.code }}
                  summary={toggleSummary("locationType.reactivate")}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
