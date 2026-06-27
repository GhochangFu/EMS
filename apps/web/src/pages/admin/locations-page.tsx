import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AdminLocationDto, MasterDataActiveFilter } from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  createAdminLocation,
  deactivateAdminLocation,
  fetchAdminLocations,
  reactivateAdminLocation,
  updateAdminLocation,
} from "../../api/admin/locations";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canCreateLocations } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

type LocationsAdminPageProps = { user: AuthUser };

const emptyForm = {
  organizationId: "",
  code: "",
  slug: "",
  name: "",
  type: "rsmoc" as AdminLocationDto["type"],
  province: "",
  capital: "",
  latitude: "0",
  longitude: "0",
};

/** Admin screen for location master data with org drill-down. */
export function LocationsAdminPage({ user }: LocationsAdminPageProps) {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCreate = canCreateLocations(user.role);
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [selection, setSelection] = useState<HierarchySelection>({ organizationId: orgId });
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminLocationDto | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelection((current) => ({ ...current, organizationId: orgId }));
  }, [orgId]);

  const orgFilter = orgId ?? selection.organizationId ?? "";

  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "all"],
    queryFn: () => fetchAdminOrganizations("all"),
  });

  const listQ = useQuery({
    queryKey: ["admin", "locations", activeFilter, orgFilter],
    queryFn: () => fetchAdminLocations(activeFilter, orgFilter || undefined),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = listQ.data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.slug.toLowerCase().includes(q),
    );
  }, [listQ.data?.items, search]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        organizationId: form.organizationId,
        code: form.code,
        slug: form.slug,
        name: form.name,
        type: form.type,
        province: form.province || null,
        capital: form.capital || null,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      };
      if (editing) {
        const { organizationId: _org, ...updatePayload } = payload;
        return updateAdminLocation(editing.id, updatePayload);
      }
      return createAdminLocation(payload);
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setForm(emptyForm);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "locations"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminLocationDto) =>
      item.active ? deactivateAdminLocation(item.id) : reactivateAdminLocation(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "locations"] });
    },
  });

  function openCreate(): void {
    setEditing(null);
    setForm({ ...emptyForm, organizationId: orgFilter });
    setError(null);
    setModalOpen(true);
  }

  function openEdit(item: AdminLocationDto): void {
    setEditing(item);
    setForm({
      organizationId: item.organizationId,
      code: item.code,
      slug: item.slug,
      name: item.name,
      type: item.type,
      province: item.province ?? "",
      capital: item.capital ?? "",
      latitude: String(item.latitude),
      longitude: String(item.longitude),
    });
    setError(null);
    setModalOpen(true);
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Locations"
        subtitle="Stations and SMOC campuses under organizations"
        actions={
          canCreate ? (
            <button
              type="button"
              className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
              onClick={openCreate}
            >
              Add location
            </button>
          ) : null
        }
      />
      <SectionCard title="Location list" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
          <HierarchyFilterBar
            user={user}
            levels={["organization"]}
            selection={selection}
            onNavigate={setSelection}
          />
          <input
            className="rounded border border-gray-200 px-3 py-1.5 text-sm"
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
              <th className="px-2 py-2">Slug</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                onClick={() => navigate(`/admin/locations/${item.id}/rtus`)}
              >
                <td className="px-2 py-2">{item.organizationCode}</td>
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2 font-semibold text-bms-green">{item.name}</td>
                <td className="px-2 py-2 font-mono text-xs">{item.slug}</td>
                <td className="px-2 py-2">
                  <StatusPill
                    label={item.active ? "Active" : "Inactive"}
                    tone={item.active ? "ok" : "offline"}
                  />
                </td>
                <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
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
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-white p-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              saveMutation.mutate();
            }}
          >
            <h2 className="font-condensed text-lg font-bold">
              {editing ? "Edit location" : "Add location"}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {!editing ? (
                <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
                  Organization
                  <select
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                    value={form.organizationId}
                    required
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
              {(["code", "slug", "name"] as const).map((field) => (
                <label key={field} className="block text-xs font-semibold text-bms-muted">
                  {field}
                  <input
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                    value={form[field]}
                    required
                    onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                  />
                </label>
              ))}
              <label className="block text-xs font-semibold text-bms-muted">
                Type
                <select
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.type}
                  onChange={(event) =>
                    setForm({ ...form, type: event.target.value as AdminLocationDto["type"] })
                  }
                >
                  <option value="rsmoc">rsmoc</option>
                  <option value="csmoc">csmoc</option>
                  <option value="smoc_campus">smoc_campus</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Province
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.province}
                  onChange={(event) => setForm({ ...form, province: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Latitude
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.latitude}
                  required
                  onChange={(event) => setForm({ ...form, latitude: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Longitude
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.longitude}
                  required
                  onChange={(event) => setForm({ ...form, longitude: event.target.value })}
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
