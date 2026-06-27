import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AdminRtuDto, MasterDataActiveFilter } from "@bms/shared";

import { fetchAdminLocationSummary, fetchAdminLocations } from "../../api/admin/locations";
import {
  createAdminRtu,
  deactivateAdminRtu,
  fetchAdminRtus,
  reactivateAdminRtu,
  updateAdminRtu,
} from "../../api/admin/rtus";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import type { AuthUser } from "../../stores/auth-store";

type RtusAdminPageProps = { user: AuthUser };

/** Admin screen for RTU master data with location drill-down. */
export function RtusAdminPage({ user }: RtusAdminPageProps) {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [selection, setSelection] = useState<HierarchySelection>({ locationId });
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRtuDto | null>(null);
  const [form, setForm] = useState({
    locationId: locationId ?? "",
    code: "",
    displayName: "",
    sourceType: "catalog" as AdminRtuDto["sourceType"],
    domain: "",
    ingestEnabled: false,
  });
  const [error, setError] = useState<string | null>(null);

  const locationSummaryQ = useQuery({
    queryKey: ["admin", "location-summary", locationId],
    queryFn: () => fetchAdminLocationSummary(locationId ?? ""),
    enabled: Boolean(locationId),
  });

  const formLocationsQ = useQuery({
    queryKey: ["admin", "locations", "true", selection.organizationId],
    queryFn: () => fetchAdminLocations("true", selection.organizationId),
    enabled: modalOpen && !editing,
  });

  useEffect(() => {
    if (locationId) {
      setSelection({
        organizationId: locationSummaryQ.data?.organizationId,
        locationId,
      });
      setForm((current) => ({ ...current, locationId }));
    }
  }, [locationId, locationSummaryQ.data?.organizationId]);

  const listQ = useQuery({
    queryKey: ["admin", "rtus", activeFilter, locationId ?? selection.locationId],
    queryFn: () =>
      fetchAdminRtus(activeFilter, locationId ?? selection.locationId ?? undefined),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = listQ.data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) || item.displayName.toLowerCase().includes(q),
    );
  }, [listQ.data?.items, search]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        return updateAdminRtu(editing.id, {
          code: form.code,
          displayName: form.displayName,
          sourceType: form.sourceType,
          domain: form.domain || undefined,
          ingestEnabled: form.ingestEnabled,
        });
      }
      return createAdminRtu({
        locationId: form.locationId,
        code: form.code,
        displayName: form.displayName,
        sourceType: form.sourceType,
        domain: form.domain || undefined,
        ingestEnabled: form.ingestEnabled,
      });
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "rtus"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminRtuDto) =>
      item.active ? deactivateAdminRtu(item.id) : reactivateAdminRtu(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "rtus"] });
    },
  });

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="RTUs"
        subtitle="Gateways and domain simulators under locations"
        actions={
          <button
            type="button"
            className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
            onClick={() => {
              setEditing(null);
              setForm({
                locationId: locationId ?? selection.locationId ?? "",
                code: "",
                displayName: "",
                sourceType: "catalog",
                domain: "",
                ingestEnabled: false,
              });
              setModalOpen(true);
            }}
          >
            Add RTU
          </button>
        }
      />
      <SectionCard title="RTU list" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
          <HierarchyFilterBar
            user={user}
            levels={["organization", "location"]}
            selection={selection}
            onNavigate={setSelection}
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
              <th className="px-2 py-2">Location</th>
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Source</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                onClick={() =>
                  navigate(`/admin/locations/${item.locationId}/rtus/${item.id}/assets`)
                }
              >
                <td className="px-2 py-2">{item.locationName}</td>
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2 font-semibold text-bms-green">{item.displayName}</td>
                <td className="px-2 py-2">{item.sourceType}</td>
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
                      onClick={() => {
                        setEditing(item);
                        setForm({
                          locationId: item.locationId,
                          code: item.code,
                          displayName: item.displayName,
                          sourceType: item.sourceType,
                          domain: item.domain ?? "",
                          ingestEnabled: item.ingestEnabled,
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
              saveMutation.mutate();
            }}
          >
            <h2 className="font-condensed text-lg font-bold">
              {editing ? "Edit RTU" : "Add RTU"}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {!editing ? (
                <label className="block text-xs font-semibold text-bms-muted sm:col-span-2">
                  Location
                  <select
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                    value={form.locationId}
                    required
                    onChange={(event) =>
                      setForm({ ...form, locationId: event.target.value })
                    }
                  >
                    <option value="">Select location</option>
                    {(formLocationsQ.data?.items ?? []).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-xs font-semibold text-bms-muted">
                Code
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.code}
                  required
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Display name
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.displayName}
                  required
                  onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Source type
                <select
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.sourceType}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      sourceType: event.target.value as AdminRtuDto["sourceType"],
                    })
                  }
                >
                  <option value="catalog">catalog</option>
                  <option value="mqtt">mqtt</option>
                  <option value="simulator">simulator</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Domain
                <input
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={form.domain}
                  onChange={(event) => setForm({ ...form, domain: event.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-bms-muted sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.ingestEnabled}
                  onChange={(event) =>
                    setForm({ ...form, ingestEnabled: event.target.checked })
                  }
                />
                Ingest enabled
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
