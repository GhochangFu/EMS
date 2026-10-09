import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AdminLocationDto, MasterDataActiveFilter } from "@bms/shared";

import { adminAssetGroupsQueryKey, fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  createAdminLocation,
  deactivateAdminLocation,
  fetchAdminLocations,
  fetchAdminLocationTypes,
  fetchSiteControlRoomView,
  putSiteControlRoomView,
  reactivateAdminLocation,
  updateAdminLocation,
} from "../../api/admin/locations";
import { fetchDashboards } from "../../api/dashboards";
import { refreshScope } from "../../api/login";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import { ControlRoomViewField } from "../../components/admin/control-room-view-field";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { LocationMoveDialog } from "../../components/admin/location-move-dialog";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canCreateLocations, canMoveLocations, isGlobalAdmin } from "../../lib/admin-access";
import { locationTreeOptions, subtreeIds } from "../../lib/location-tree";
import {
  isEligibleSiteViewDashboard,
  siteViewDraftChanged,
  siteViewDraftFromSetting,
  siteViewPayloadFromDraft,
  type SiteViewDraft,
} from "../../lib/site-control-room-view";
import { apiErrorMessage } from "../../lib/api-error-message";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";

type LocationsAdminPageProps = { user: AuthUser };

const emptyForm = {
  organizationId: "",
  code: "",
  slug: "",
  name: "",
  type: "",
  province: "",
  capital: "",
  timezone: "",
  // `F3.79` (owner ruling 2026-10-04): Mumbai, not (0,0). Every active location is a map pin,
  // and a pin at (0,0) sat in the Gulf of Guinea and stretched the map's box.
  latitude: "19.076",
  longitude: "72.8777",
  /** `F2.10` (ADR 0098) — the parent's id; `""` is a root. */
  parentId: "",
};

/**
 * E4.1b (plan Q13): the zone list the form OFFERS is the browser's — no
 * endpoint; the server validates against `pg_timezone_names` on write.
 * Guarded: `Intl.supportedValuesOf` is ES2022 and absent on older engines,
 * where the input stays a free-text field.
 */
function browserTimezones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
}

/** Admin screen for location master data with org drill-down. */
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
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  /** `F2.10` (decision 5) — a refused deactivate or reactivate, in the server's sentence. */
  const [listError, setListError] = useState<string | null>(null);
  /** `F2.10` — the move the administrator is asked to confirm; `null` while none is pending. */
  const [pendingMove, setPendingMove] = useState<{ toParentId: string | null } | null>(null);
  /** `F3.67` — `null` until the admin touches the Control Room view field, so an untouched
   * field is never "changed" and never `PUT`. */
  const [viewDraft, setViewDraft] = useState<SiteViewDraft | null>(null);
  const timezones = useMemo(browserTimezones, []);

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

  // `F4.157` (D9) — the Type select's vocabulary; the admin write paths refuse a code that is
  // not one of these active rows.
  const typesQ = useQuery({
    queryKey: ["admin", "location-types"],
    queryFn: fetchAdminLocationTypes,
  });
  const types = typesQ.data?.items ?? [];
  /** The one resolved value: `form.type` once the admin has picked, otherwise the list's first
   * code — feeds both the `<select value>` and the create/update payload, so the two never
   * disagree about what an untouched form submits. */
  const resolvedType = form.type || types[0]?.code || "";

  // `F2.10` (ADR 0098 B6) — the Parent select's vocabulary: the organization's ACTIVE nodes (an
  // inactive parent is a guaranteed 409). On edit only a role that may move reads it. The move
  // dialog reads its chains from the same list, never from the filtered page list.
  const parentsEnabled = modalOpen && Boolean(form.organizationId) && (!editing || canMove);
  const parentsQ = useQuery({
    queryKey: ["admin", "locations", "true", form.organizationId],
    queryFn: () => fetchAdminLocations("true", form.organizationId),
    enabled: parentsEnabled,
  });
  const parentNodes = useMemo(() => parentsQ.data?.items ?? [], [parentsQ.data?.items]);
  const parentOptions = useMemo(() => {
    // Editing: never the node itself or one of its descendants (the server refuses a cycle too).
    const excluded = editing ? subtreeIds(parentNodes, editing.id) : new Set<string>();
    return locationTreeOptions(parentNodes.filter((n) => !excluded.has(n.id)));
  }, [editing, parentNodes]);
  /** On edit, whether the administrator picked another parent — the only save that sends `parentId`. */
  const parentChanged =
    editing !== null && canMove && form.parentId !== (editing.parentId ?? "");

  // `F3.67` / ADR 0076 decision 3 — the Control Room view field, Edit modal only. The
  // setting's key sits under `["admin", "locations"]`, so the save's invalidation refreshes it.
  const viewEnabled = modalOpen && editing !== null;
  const viewQ = useQuery({
    queryKey: ["admin", "locations", editing?.id, "control-room-view"],
    queryFn: () => fetchSiteControlRoomView(editing!.id),
    enabled: viewEnabled,
  });
  const viewDashboardsQ = useQuery({
    queryKey: ["dashboards", "list", editing?.organizationId],
    queryFn: () => fetchDashboards(editing!.organizationId),
    enabled: viewEnabled,
  });
  const viewGroupsQ = useQuery({
    queryKey: adminAssetGroupsQueryKey(editing?.id),
    queryFn: () => fetchAdminAssetGroups(editing!.id),
    enabled: viewEnabled,
  });
  const storedView = viewQ.data ? siteViewDraftFromSetting(viewQ.data) : null;
  const eligibleDashboards = useMemo(() => {
    if (!editing) return [];
    const groupIds = new Set(
      (viewGroupsQ.data?.items ?? [])
        .filter((group) => group.locationId === editing.id)
        .map((group) => group.id),
    );
    return (viewDashboardsQ.data?.items ?? []).filter((dashboard) =>
      isEligibleSiteViewDashboard(dashboard, editing.id, groupIds),
    );
  }, [editing, viewDashboardsQ.data?.items, viewGroupsQ.data?.items]);

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
  // keeps the relative order. The Parent column names from the whole list, so a search that
  // hides the parent still names it.
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
     * `toParentId` is `undefined` for every save but a confirmed move: the PATCH then has no
     * `parentId` key, which any role may send. A body that names `parentId`, whatever the value,
     * is a 403 below the organization level (ADR 0098 decision 12).
     */
    mutationFn: async (toParentId: string | null | undefined) => {
      const payload = {
        organizationId: form.organizationId,
        code: form.code,
        slug: form.slug,
        name: form.name,
        type: resolvedType,
        province: form.province || null,
        capital: form.capital || null,
        timezone: form.timezone || null,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      };
      if (editing) {
        const { organizationId: _org, type: _type, ...rest } = payload;
        // D8 (F4.162) — send `type` only when the administrator changed it; an untouched
        // retired current type must not be re-posted, since it is not among the active codes.
        const typedPayload =
          resolvedType === editing.type ? rest : { ...rest, type: resolvedType };
        // `F2.10` — a move rides in the same body as the other changed fields (Drafter choice 5).
        const updatePayload =
          toParentId === undefined ? typedPayload : { ...typedPayload, parentId: toParentId };
        const updated = await updateAdminLocation(editing.id, updatePayload);
        if (storedView && viewDraft && siteViewDraftChanged(storedView, viewDraft)) {
          await putSiteControlRoomView(editing.id, siteViewPayloadFromDraft(viewDraft));
        }
        return updated;
      }
      return createAdminLocation({ ...payload, parentId: form.parentId || null });
    },
    onSuccess: async (_data, toParentId) => {
      const createdOrMoved = !editing || toParentId !== undefined;
      setModalOpen(false);
      setEditing(null);
      setForm(emptyForm);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "locations"] });
      // `F2.10` (B8) — the tree changed, so the scope every picker reads is stale. A failed
      // refresh never fails the save; the next app load refreshes it (B9).
      const accessToken = useAuthStore.getState().accessToken;
      if (createdOrMoved && accessToken) {
        await refreshScope(accessToken).catch(() => undefined);
      }
    },
    onError: async (err: unknown) => {
      setError(apiErrorMessage(err));
      // The location update may have landed before the view `PUT` failed.
      await queryClient.invalidateQueries({ queryKey: ["admin", "locations"] });
    },
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
    setForm({ ...emptyForm, organizationId: orgFilter });
    setViewDraft(null);
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
      timezone: item.timezone ?? "",
      latitude: String(item.latitude),
      longitude: String(item.longitude),
      parentId: item.parentId ?? "",
    });
    setViewDraft(null);
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
                  {(item.parentId ? byId.get(item.parentId)?.name : undefined) ?? "—"}
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
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink-muted"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <form
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto surface-dialog p-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              // `F2.10` — a changed parent is confirmed in the move dialog first.
              if (parentChanged) {
                setPendingMove({ toParentId: form.parentId || null });
                return;
              }
              saveMutation.mutate(undefined);
            }}
          >
            <h2 className="font-condensed text-lg font-bold">
              {editing ? "Edit location" : "Add location"}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {!editing ? (
                <label className="block text-xs font-semibold text-ink-muted sm:col-span-2">
                  Organization
                  <select
                    className="mt-1 w-full surface-field px-3 py-2 text-sm"
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
              {!editing || canMove ? (
                <label className="block text-xs font-semibold text-ink-muted sm:col-span-2">
                  Parent
                  <select
                    className="mt-1 w-full surface-field px-3 py-2 text-sm"
                    value={form.parentId}
                    disabled={!form.organizationId}
                    onChange={(event) => setForm({ ...form, parentId: event.target.value })}
                  >
                    <option value="">No parent (root)</option>
                    {parentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="text-xs text-ink-muted sm:col-span-2">
                  {`Parent: ${(editing.parentId ? byId.get(editing.parentId)?.name : undefined) ?? "—"}`}
                </div>
              )}
              {(["code", "slug", "name"] as const).map((field) => (
                <label key={field} className="block text-xs font-semibold text-ink-muted">
                  {field}
                  <input
                    className="mt-1 w-full surface-field px-3 py-2 text-sm"
                    value={form[field]}
                    required
                    onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                  />
                </label>
              ))}
              <label className="block text-xs font-semibold text-ink-muted">
                Type
                <select
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={resolvedType}
                  disabled={types.length === 0}
                  onChange={(event) => setForm({ ...form, type: event.target.value })}
                >
                  {/* Only once the list has loaded: while it is pending or failed, `types` is
                      empty and every row's own type would read as "(retired)". */}
                  {typesQ.isSuccess &&
                  editing &&
                  !types.some((locationType) => locationType.code === editing.type) ? (
                    <option value={editing.type}>{editing.typeLabel} (retired)</option>
                  ) : null}
                  {types.map((locationType) => (
                    <option key={locationType.code} value={locationType.code}>
                      {locationType.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-ink-muted">
                Province
                <input
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.province}
                  onChange={(event) => setForm({ ...form, province: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-ink-muted">
                Timezone (IANA)
                <input
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  list="tz-list"
                  placeholder="Asia/Kolkata"
                  value={form.timezone}
                  onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                />
                <datalist id="tz-list">
                  {timezones.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </label>
              <label className="block text-xs font-semibold text-ink-muted">
                Latitude
                <input
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.latitude}
                  required
                  onChange={(event) => setForm({ ...form, latitude: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-ink-muted">
                Longitude
                <input
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.longitude}
                  required
                  onChange={(event) => setForm({ ...form, longitude: event.target.value })}
                />
              </label>
              {editing ? (
                viewQ.data && storedView ? (
                  <ControlRoomViewField
                    value={viewDraft ?? storedView}
                    onChange={setViewDraft}
                    dashboards={eligibleDashboards}
                    dashboardsLoaded={!viewDashboardsQ.isPending && !viewGroupsQ.isPending}
                    touched={viewDraft !== null}
                    stored={storedView}
                    canSetBuiltin={isGlobalAdmin(user.role)}
                  />
                ) : (
                  <div className="text-xs text-ink-muted sm:col-span-2">
                    {viewQ.isError
                      ? "The Control Room view could not be loaded."
                      : "Loading the Control Room view…"}
                  </div>
                )
              ) : null}
            </div>
            {error ? <div className="mt-2 text-xs text-critical-ink">{error}</div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="surface-button px-3 py-2"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingMove && editing ? (
        <LocationMoveDialog
          node={{ id: editing.id, name: editing.name, organizationId: editing.organizationId }}
          fromParentId={editing.parentId}
          toParentId={pendingMove.toParentId}
          nodes={parentNodes}
          onClose={() => setPendingMove(null)}
          onConfirm={() => {
            const { toParentId } = pendingMove;
            setPendingMove(null);
            saveMutation.mutate(toParentId);
          }}
        />
      ) : null}
    </MasterDataLayout>
  );
}
