import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import type { AdminLocationTypeDto, MasterDataActiveFilter } from "@bms/shared";

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
import { canManageLocationTypes } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

type LocationTypesAdminPageProps = { user: AuthUser };

/** The API body's `.max()` (`location-types.schema.ts`). */
const SORT_ORDER_MAX = 100000;
const SORT_ORDER_ERROR = `Sort order must be a whole number from 0 to ${SORT_ORDER_MAX}.`;

/** The dropdown the locations form reads (`GET /admin/location-types`). */
const DROPDOWN_KEY = ["admin", "location-types"] as const;
/** This page's own read (`GET /admin/vocabularies/location-types`). */
const CATALOG_KEY = ["admin", "location-types-catalog"] as const;

/**
 * The modal's sort-order text to the body value, the `parseHeadlineRank` shape
 * (`point-keys-page.tsx`). Empty means "not sent": the create keeps the
 * column default (0) and the edit keeps the stored value. Anything that is not
 * a whole number in range is refused here, before a request is made.
 */
function parseSortOrder(text: string): number | undefined | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const value = Number(trimmed);
  return value <= SORT_ORDER_MAX ? value : "invalid";
}

/**
 * `F4.162` (ADR 0077 Amendment 1, plan D7) — the global-admin screen for the
 * location-type vocabulary, `bms.location_types`.
 *
 * **It fails closed at the page.** The tab and the sidebar entry are hidden
 * from every role but `admin`, but a typed URL still reaches this route
 * through `AdminRoute`, which admits every master-data role. For those roles
 * the page renders one status line and mounts no query: the catalog component
 * below is never rendered, so its read never starts (the API would answer
 * 403 anyway).
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
        <p role="status" className="text-sm text-bms-muted">
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
  const [form, setForm] = useState({ code: "", label: "", sortOrder: "" });
  const [error, setError] = useState<string | null>(null);

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

  const saveMutation = useMutation({
    mutationFn: async (sortOrder: number | undefined) => {
      if (editing) {
        return updateLocationType(editing.code, { label: form.label, sortOrder });
      }
      return createLocationType({ code: form.code, label: form.label, sortOrder });
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await invalidateBoth();
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminLocationTypeDto) =>
      item.active ? deactivateLocationType(item.code) : reactivateLocationType(item.code),
    onSuccess: invalidateBoth,
  });

  function openCreate(): void {
    setEditing(null);
    setForm({ code: "", label: "", sortOrder: "" });
    setError(null);
    setModalOpen(true);
  }

  function openEdit(item: AdminLocationTypeDto): void {
    setEditing(item);
    setForm({ code: item.code, label: item.label, sortOrder: String(item.sortOrder) });
    setError(null);
    setModalOpen(true);
  }

  return (
    <>
      <SectionCard title="Location type catalog" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
          <button
            type="button"
            className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
            onClick={openCreate}
          >
            Add location type
          </button>
        </div>
        {toggleMutation.error ? (
          <div className="text-xs text-red-700">{toggleMutation.error.message}</div>
        ) : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-bms-muted">
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
              <tr key={item.code} className="border-b border-gray-100">
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
                      className="text-xs font-semibold text-bms-green"
                      onClick={() => openEdit(item)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-bms-muted"
                      onClick={() => toggleMutation.mutate(item)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-lg rounded-lg border bg-white p-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              const sortOrder = parseSortOrder(form.sortOrder);
              if (sortOrder === "invalid") {
                setError(SORT_ORDER_ERROR);
                return;
              }
              saveMutation.mutate(sortOrder);
            }}
          >
            <h2 className="font-condensed text-lg font-bold">
              {editing ? "Edit location type" : "Add location type"}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="location-type-code" className="block text-xs font-semibold text-bms-muted">
                  Code
                </label>
                <input
                  id="location-type-code"
                  className="mt-1 w-full rounded border px-3 py-2 text-sm disabled:bg-gray-50"
                  value={form.code}
                  disabled={Boolean(editing)}
                  required
                  maxLength={32}
                  aria-describedby="location-type-code-hint"
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
                <p id="location-type-code-hint" className="mt-1 text-xs text-bms-muted">
                  Lower-case letters, digits and _, starting with a letter — like pump_station. It cannot
                  change after it is saved.
                </p>
              </div>
              <label className="block text-xs font-semibold text-bms-muted">
                Label
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.label}
                  required
                  maxLength={128}
                  onChange={(event) => setForm({ ...form, label: event.target.value })}
                />
              </label>
              <div className="sm:col-span-2">
                <label htmlFor="location-type-sort-order" className="block text-xs font-semibold text-bms-muted">
                  Sort order
                </label>
                <input
                  id="location-type-sort-order"
                  type="text"
                  inputMode="numeric"
                  aria-describedby="location-type-sort-order-hint"
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.sortOrder}
                  onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
                />
                <p id="location-type-sort-order-hint" className="mt-1 text-xs text-bms-muted">
                  Lower shows first in the locations form. Leave empty to keep the current value (0 for a new type).
                </p>
              </div>
            </div>
            {error ? <div className="mt-2 text-xs text-red-700">{error}</div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border px-3 py-2 text-xs"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
