import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AdminOrganizationDto, MasterDataActiveFilter } from "@bms/shared";

import {
  createAdminOrganization,
  deactivateAdminOrganization,
  fetchAdminOrganizations,
  reactivateAdminOrganization,
  updateAdminOrganization,
} from "../../api/admin/organizations";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canWriteOrganizations, canAccessOnboarding } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

type OrganizationsAdminPageProps = {
  user: AuthUser;
};

/** Organization master data list with drill-down to locations. */
export function OrganizationsAdminPage({ user }: OrganizationsAdminPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = canWriteOrganizations(user.role);
  const canOnboard = canAccessOnboarding(user.role);
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminOrganizationDto | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "organizations", activeFilter],
    queryFn: () => fetchAdminOrganizations(activeFilter),
  });

  const filtered = useMemo(() => {
    const items = listQ.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) {
      return items;
    }
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q),
    );
  }, [listQ.data?.items, search]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        return updateAdminOrganization(editing.id, { name });
      }
      return createAdminOrganization({ code: code.toUpperCase(), name });
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setCode("");
      setName("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminOrganizationDto) =>
      item.active
        ? deactivateAdminOrganization(item.id)
        : reactivateAdminOrganization(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] });
    },
  });

  function openCreate(): void {
    setEditing(null);
    setCode("");
    setName("");
    setError(null);
    setModalOpen(true);
  }

  function openEdit(item: AdminOrganizationDto): void {
    setEditing(item);
    setCode(item.code);
    setName(item.name);
    setError(null);
    setModalOpen(true);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    saveMutation.mutate();
  }

  return (
    <MasterDataLayout user={user}>
        <PageHeader
          eyebrow="Administration"
          title="Organizations"
          subtitle="Select an organization to manage locations and downstream master data"
          actions={
            canWrite ? (
              <button
                type="button"
                className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
                onClick={openCreate}
              >
                Add organization
              </button>
            ) : null
          }
        />
        <SectionCard title="Organization list" bodyClassName="p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
            <input
              className="rounded border border-gray-200 px-3 py-1.5 text-sm"
              placeholder="Search code or name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {listQ.isLoading ? (
            <div className="text-sm text-bms-muted">Loading...</div>
          ) : listQ.isError ? (
            <div className="text-sm text-red-700">Failed to load organizations.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase text-bms-muted">
                    <th className="px-2 py-2">Code</th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                      onClick={() => navigate(`/admin/organizations/${item.id}/locations`)}
                    >
                      <td className="px-2 py-2 font-mono">{item.code}</td>
                      <td className="px-2 py-2 font-semibold text-bms-green">{item.name}</td>
                      <td className="px-2 py-2">
                        <StatusPill
                          label={item.active ? "Active" : "Inactive"}
                          tone={item.active ? "ok" : "offline"}
                        />
                      </td>
                      <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                        <div className="flex gap-2">
                          {canOnboard && item.active ? (
                            <button
                              type="button"
                              className="text-xs font-semibold text-bms-green"
                              onClick={() =>
                                navigate(`/admin/organizations/${item.id}/onboarding`)
                              }
                            >
                              Onboard with AI
                            </button>
                          ) : null}
                          {canWrite ? (
                            <>
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
                            </>
                          ) : (
                            <span className="text-xs text-bms-muted">View only</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
            onSubmit={handleSubmit}
          >
            <h2 className="font-condensed text-lg font-bold text-bms-ink">
              {editing ? "Edit organization" : "Add organization"}
            </h2>
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-semibold text-bms-muted">
                Code
                <input
                  className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                  value={code}
                  disabled={Boolean(editing)}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  required
                />
              </label>
              <label className="block text-xs font-semibold text-bms-muted">
                Name
                <input
                  className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              {error ? <div className="text-xs text-red-700">{error}</div> : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-gray-200 px-3 py-2 text-xs"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
                disabled={saveMutation.isPending}
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
