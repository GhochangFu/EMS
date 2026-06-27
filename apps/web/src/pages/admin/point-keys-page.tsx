import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminPointKeyDto, MasterDataActiveFilter } from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  createAdminPointKey,
  deactivateAdminPointKey,
  fetchAdminPointKeys,
  reactivateAdminPointKey,
  updateAdminPointKey,
} from "../../api/admin/point-keys";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canWritePointKeys, isGlobalAdmin } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

type PointKeysAdminPageProps = { user: AuthUser };

/** Admin screen for org-scoped point key catalog entries. */
export function PointKeysAdminPage({ user }: PointKeysAdminPageProps) {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const canWrite = canWritePointKeys(user.role);
  const initialOrgId = searchParams.get("organizationId") ?? "";
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [selection, setSelection] = useState<HierarchySelection>({
    organizationId: initialOrgId || undefined,
  });
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPointKeyDto | null>(null);
  const [form, setForm] = useState({
    organizationId: initialOrgId,
    code: "",
    name: "",
    domain: "",
    unit: "",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);

  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
  });

  const orgFilter = selection.organizationId ?? "";

  const listQ = useQuery({
    queryKey: ["admin", "point-keys", activeFilter, orgFilter],
    queryFn: () => fetchAdminPointKeys(activeFilter, orgFilter || undefined),
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
        organizationId: form.organizationId,
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
    const defaultOrg =
      orgFilter ||
      (!isGlobalAdmin(user.role) ? orgsQ.data?.items[0]?.id : "") ||
      "";
    setEditing(null);
    setForm({
      organizationId: defaultOrg,
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
        subtitle="Organization catalog of telemetry point keys used in asset mappings"
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
          <HierarchyFilterBar
            user={user}
            levels={["organization"]}
            selection={selection}
            onNavigate={setSelection}
            syncRoutes={false}
          />
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
              <th className="px-2 py-2">Org</th>
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
                <td className="px-2 py-2">{item.organizationCode}</td>
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
                            organizationId: item.organizationId,
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
              {!editing ? (
                <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
                  Organization
                  <select
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                    value={form.organizationId}
                    required
                    disabled={!isGlobalAdmin(user.role)}
                    onChange={(event) =>
                      setForm({ ...form, organizationId: event.target.value })
                    }
                  >
                    <option value="">Select organization</option>
                    {(orgsQ.data?.items ?? []).map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.code} · {org.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
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
