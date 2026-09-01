import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import type { AdminPointKeyDto, MasterDataActiveFilter } from "@bms/shared";

import {
  createAdminPointKey,
  deactivateAdminPointKey,
  fetchAdminPointKeys,
  reactivateAdminPointKey,
  updateAdminPointKey,
} from "../../api/admin/point-keys";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canWritePointKeys } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

type PointKeysAdminPageProps = { user: AuthUser };

/**
 * Admin screen for the fleet-wide point key catalog.
 *
 * **`F3.39` / ADR 0051 — this screen lost its organization axis entirely.** The
 * organization column, the `HierarchyFilterBar`, the `?organizationId=` deep
 * link and the create form's organization picker all named a column migration
 * `0057` drops. What is left is one list for the whole fleet, which is what
 * makes a stock dashboard template's `pointKey` resolvable anywhere.
 *
 * `canWritePointKeys` narrowed to the global `admin` in the same row, so an
 * organization administrator reads this screen and cannot edit it.
 */
export function PointKeysAdminPage({ user }: PointKeysAdminPageProps) {
  const queryClient = useQueryClient();
  const canWrite = canWritePointKeys(user.role);
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPointKeyDto | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    domain: "",
    unit: "",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "point-keys", activeFilter],
    queryFn: () => fetchAdminPointKeys(activeFilter),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = listQ.data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.domain ?? "").toLowerCase().includes(q),
    );
  }, [listQ.data?.items, search]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        return updateAdminPointKey(editing.id, {
          name: form.name,
          domain: form.domain || undefined,
          unit: form.unit || undefined,
          description: form.description || undefined,
        });
      }
      return createAdminPointKey({
        code: form.code,
        name: form.name,
        domain: form.domain || undefined,
        unit: form.unit || undefined,
        description: form.description || undefined,
      });
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "point-keys"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminPointKeyDto) =>
      item.active ? deactivateAdminPointKey(item.id) : reactivateAdminPointKey(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "point-keys"] });
    },
  });

  function openCreate(): void {
    setEditing(null);
    setForm({
      code: "",
      name: "",
      domain: "",
      unit: "",
      description: "",
    });
    setError(null);
    setModalOpen(true);
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Point Keys"
        subtitle="Fleet-wide catalog of telemetry point keys used in asset mappings"
        actions={
          canWrite ? (
            <button
              type="button"
              className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
              onClick={openCreate}
            >
              Add point key
            </button>
          ) : null
        }
      />
      <SectionCard title="Point key catalog" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
          <input
            className="rounded border px-3 py-1.5 text-sm"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-bms-muted">
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Domain</th>
              <th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2">{item.name}</td>
                <td className="px-2 py-2">{item.domain ?? "—"}</td>
                <td className="px-2 py-2">{item.unit ?? "—"}</td>
                <td className="px-2 py-2">
                  <StatusPill
                    label={item.active ? "Active" : "Inactive"}
                    tone={item.active ? "ok" : "offline"}
                  />
                </td>
                <td className="px-2 py-2">
                  {canWrite ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs font-semibold text-bms-green"
                        onClick={() => {
                          setEditing(item);
                          setForm({
                            code: item.code,
                            name: item.name,
                            domain: item.domain ?? "",
                            unit: item.unit ?? "",
                            description: item.description ?? "",
                          });
                          setModalOpen(true);
                        }}
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
                  ) : (
                    <span className="text-xs text-bms-muted">Read only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {modalOpen && canWrite ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-lg rounded-lg border bg-white p-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              saveMutation.mutate();
            }}
          >
            <h2 className="font-condensed text-lg font-bold">
              {editing ? "Edit point key" : "Add point key"}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-bms-muted">
                Code
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm disabled:bg-gray-50"
                  value={form.code}
                  disabled={Boolean(editing)}
                  required
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Name
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.name}
                  required
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Domain
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.domain}
                  onChange={(event) => setForm({ ...form, domain: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Unit
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
                Description
                <textarea
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.description}
                  rows={3}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>
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
    </MasterDataLayout>
  );
}
