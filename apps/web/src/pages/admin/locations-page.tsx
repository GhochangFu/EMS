import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AdminLocationDto, CreateLocationBody, MasterDataActiveFilter, UpdateLocationBody } from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  createAdminLocation,
  deactivateAdminLocation,
  fetchAdminLocations,
  reactivateAdminLocation,
  updateAdminLocation,
} from "../../api/admin/locations";
import { refreshScope } from "../../api/login";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import { ControlRoomViewWizard } from "../../components/admin/control-room-view-wizard";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { LocationStatusWizard, LocationWizard } from "../../components/admin/location-wizards";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canCreateLocations, canMoveLocations, isGlobalAdmin } from "../../lib/admin-access";
import { locationTreeOptions } from "../../lib/location-tree";
import { apiErrorMessage } from "../../lib/api-error-message";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";

type LocationsAdminPageProps = { user: AuthUser };

/**
 * Admin screen for location master data with org drill-down.
 *
 * `F3.86` PR 3a (ADR 0099 decision 6) — Add and Edit are the
 * `location.create` and `location.update` wizards, and Deactivate and
 * Reactivate are Review-only wizards (ruling Q9); all four live in
 * `components/admin/location-wizards.tsx`. This page sends what Review
 * parsed, with no `X-Copilot-Change` header.
 */
export function LocationsAdminPage({ user }: LocationsAdminPageProps) {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCreate = canCreateLocations(user.role);
  /** `F2.10` (ADR 0098 decision 12) — only an organization-level administrator moves a node. */
  const canMove = canMoveLocations(user.role);
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [selection, setSelection] = useState<HierarchySelection>({ organizationId: orgId });
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminLocationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** `F2.10` (decision 5) — a refused deactivate or reactivate, in the server's sentence. */
  const [listError, setListError] = useState<string | null>(null);
  /** `F3.86` PR 3d — the location whose Control Room view wizard is open; `null` while none is. */
  const [viewing, setViewing] = useState<AdminLocationDto | null>(null);
  /** `F3.86` PR 3a — the location whose deactivate or reactivate wizard is open. */
  const [statusTarget, setStatusTarget] = useState<AdminLocationDto | null>(null);

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

  // `F2.10` (ADR 0098 B10) — the rows in tree order, siblings in the API's name order; a search
  // keeps the relative order. The Parent column names from the status-filtered list before the
  // search, so a search that hides the parent still names it; a parent the status filter hides
  // reads "(not in this list)", and its child is drawn at the top level of this list.
  const rows = useMemo(() => {
    const byItemId = new Map(filtered.map((item) => [item.id, item]));
    return locationTreeOptions(filtered).map((option) => ({
      item: byItemId.get(option.id)!,
      label: option.label,
    }));
  }, [filtered]);
  const byId = useMemo(
    () => new Map((listQ.data?.items ?? []).map((item) => [item.id, item])),
    [listQ.data?.items],
  );

  const saveMutation = useMutation({
    /**
     * The body the wizard's Review parsed. An edit names `parentId` only for a move the
     * administrator confirmed; any body that names it is a 403 below the organization level
     * (ADR 0098 decision 12).
     */
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) return updateAdminLocation(editing.id, body as UpdateLocationBody);
      return createAdminLocation(body as CreateLocationBody);
    },
    onSuccess: async (_data, body) => {
      const createdOrMoved = !editing || "parentId" in body;
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "locations"] });
      // `F2.10` (B8) — the tree changed, so the scope every picker reads is stale. A failed
      // refresh never fails the save; the next app load refreshes it (B9).
      const accessToken = useAuthStore.getState().accessToken;
      if (createdOrMoved && accessToken) {
        await refreshScope(accessToken).catch(() => undefined);
      }
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminLocationDto) =>
      item.active ? deactivateAdminLocation(item.id) : reactivateAdminLocation(item.id),
    onSuccess: async () => {
      setListError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "locations"] });
    },
    // `F2.10` (ADR 0098 decision 5) — e.g. a deactivate refused while an active child exists.
    onError: (err: unknown) => setListError(apiErrorMessage(err)),
  });

  function openCreate(): void {
    setEditing(null);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(item: AdminLocationDto): void {
    setEditing(item);
    setError(null);
    setModalOpen(true);
  }

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Locations"
        subtitle="Sites, campuses and the nodes under them, per organization"
        actions={
          canCreate ? (
            <button
              type="button"
              className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
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
            className="surface-field px-3 py-1.5 text-sm"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {listError ? (
          <div role="alert" className="text-xs text-critical-ink">
            {listError}
          </div>
        ) : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Org</th>
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Parent</th>
              <th className="px-2 py-2">Slug</th>
              <th className="px-2 py-2">Timezone</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, label }) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-well-deep hover:bg-well"
                onClick={() => navigate(`/admin/locations/${item.id}/rtus`)}
              >
                <td className="px-2 py-2">{item.organizationCode}</td>
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2 font-semibold text-accent-strong">{label}</td>
                <td className="px-2 py-2">
                  {item.parentId
                    ? (byId.get(item.parentId)?.name ?? "(not in this list)")
                    : "—"}
                </td>
                <td className="px-2 py-2 font-mono text-xs">{item.slug}</td>
                <td className="px-2 py-2 font-mono text-xs">{item.timezone ?? "—"}</td>
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
                      className="text-xs font-semibold text-accent-strong"
                      onClick={() => openEdit(item)}
                    >
                      Edit
                    </button>
                    {/* `F3.86` PR 3d — the view is its own wizard; the Edit form sends one write. */}
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent-strong"
                      onClick={() => setViewing(item)}
                    >
                      Control Room view
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink-muted"
                      onClick={() => setStatusTarget(item)}
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
        <LocationWizard
          key={editing?.id ?? "create"}
          editing={editing}
          organizationId={orgFilter}
          organizations={orgsQ.data?.items ?? []}
          canMove={canMove}
          parentName={(editing?.parentId ? byId.get(editing.parentId)?.name : undefined) ?? "—"}
          pending={saveMutation.isPending}
          error={error}
          onSubmit={(body) => saveMutation.mutate(body)}
          onCancel={() => setModalOpen(false)}
        />
      ) : null}

      {statusTarget ? (
        <LocationStatusWizard
          target={statusTarget}
          onCancel={() => setStatusTarget(null)}
          onSubmit={() => {
            setStatusTarget(null);
            toggleMutation.mutate(statusTarget);
          }}
        />
      ) : null}

      {viewing ? (
        <ControlRoomViewWizard
          key={viewing.id}
          location={viewing}
          canSetBuiltin={isGlobalAdmin(user.role)}
          onClose={() => setViewing(null)}
        />
      ) : null}

    </MasterDataLayout>
  );
}
