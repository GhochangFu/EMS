import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  addAdminAssetGroupMember,
  adminAssetGroupMembersQueryKey,
  adminAssetGroupsQueryKey,
  createAdminAssetGroup,
  fetchAdminAssetGroupMembers,
  fetchAdminAssetGroups,
  removeAdminAssetGroupMember,
  setAdminAssetGroupMemberRole,
  updateAdminAssetGroup,
} from "../../api/admin/asset-groups";
import { fetchAdminAssets } from "../../api/admin/assets";
import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { isMasterDataAdmin } from "../../lib/admin-access";
// `F4.197`: an `ApiError` carries the whole response body; this reads the sentence out of it.
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type AssetGroupsAdminPageProps = { user: AuthUser };

type GroupForm = { locationId: string; code: string; name: string; description: string };
const EMPTY_FORM: GroupForm = { locationId: "", code: "", name: "", description: "" };

/**
 * `F3.37` (ADR 0049 decision 5) — set the role each asset plays in its group.
 *
 * **The role lives on the membership, not on the asset, so this page is
 * group-centric rather than a column on the asset screen.** The same pump is
 * the raw-water pump in the water group and a monitored load in the electrical
 * one; a control on the asset would assert one role everywhere.
 *
 * The role `<select>` is populated from `GET /api/v1/vocabularies`, never from
 * a hardcoded `<option>` list. A `<select>` whose value matches no option
 * renders its **first** option, so a hand-kept list falling behind does not
 * look broken — it looks like a different value. That is `F4.43`, and
 * `tests/f3.37-asset-role-vocabulary.test.ts` guards the same construct here.
 */
export function AssetGroupsAdminPage({ user }: AssetGroupsAdminPageProps) {
  const queryClient = useQueryClient();
  const canWrite = isMasterDataAdmin(user.role);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<HierarchySelection>({});

  // `F3.78`: null is closed; "create" and "edit" share one modal.
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<GroupForm>(EMPTY_FORM);
  const [addAssetId, setAddAssetId] = useState("");

  const locationId = selection.locationId ?? undefined;

  const groupsQ = useQuery({
    queryKey: adminAssetGroupsQueryKey(locationId),
    queryFn: () => fetchAdminAssetGroups(locationId),
  });

  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
  });

  const membersQ = useQuery({
    queryKey: adminAssetGroupMembersQueryKey(selectedGroupId ?? ""),
    queryFn: () => fetchAdminAssetGroupMembers(selectedGroupId as string),
    enabled: selectedGroupId !== null,
  });

  const groupLocationId =
    (groupsQ.data?.items ?? []).find((g) => g.id === selectedGroupId)?.locationId ?? null;

  const formLocationsQ = useQuery({
    queryKey: ["admin", "locations", "true", selection.organizationId],
    queryFn: () => fetchAdminLocations("true", selection.organizationId),
    enabled: modal === "create",
  });

  // `F3.78`: the member picker offers the assets of the group's own location
  // only. The server refuses any other (400), so offering one would be a
  // choice that can only fail.
  const pickerAssetsQ = useQuery({
    queryKey: ["admin", "assets", "true", groupLocationId],
    queryFn: () => fetchAdminAssets("true", groupLocationId ?? undefined),
    enabled: canWrite && groupLocationId !== null,
  });

  const invalidateGroups = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "asset-groups"] });

  const saveGroup = useMutation({
    mutationFn: async () => {
      const description = form.description.trim() === "" ? null : form.description.trim();
      if (modal === "create") {
        return createAdminAssetGroup({
          locationId: form.locationId,
          code: form.code,
          name: form.name,
          description,
        });
      }
      // No `code`: the update route is strict, and a code is the group's identity.
      return updateAdminAssetGroup(selectedGroupId as string, { name: form.name, description });
    },
    onSuccess: async (saved) => {
      setError(null);
      setModal(null);
      // The modal can save at a location other than the filter's. The list is keyed on the
      // filter, so move it to the saved group's location or the selected group is not in it.
      if (locationId !== undefined && saved.locationId !== locationId) {
        setSelection({ ...selection, locationId: saved.locationId });
      }
      await invalidateGroups();
      setSelectedGroupId(saved.id);
    },
    onError: (err: unknown) => {
      setError(apiErrorMessage(err));
    },
  });

  const addMember = useMutation({
    mutationFn: (assetId: string) =>
      addAdminAssetGroupMember(selectedGroupId as string, { assetId }),
    onSuccess: async () => {
      setError(null);
      setAddAssetId("");
      await invalidateGroups();
    },
    onError: (err: unknown) => {
      setError(apiErrorMessage(err));
    },
  });

  const removeMember = useMutation({
    mutationFn: (membershipId: string) => removeAdminAssetGroupMember(membershipId),
    onSuccess: async () => {
      setError(null);
      await invalidateGroups();
    },
    onError: (err: unknown) => {
      setError(apiErrorMessage(err));
    },
  });

  const setRole = useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: string; role: string | null }) =>
      setAdminAssetGroupMemberRole(membershipId, role),
    onSuccess: () => {
      setError(null);
      // The member list carries `roleCounts`, which this write changes, so the
      // whole read is invalidated rather than the one row patched in place.
      void queryClient.invalidateQueries({
        queryKey: adminAssetGroupMembersQueryKey(selectedGroupId ?? ""),
      });
    },
    onError: (err: unknown) => {
      // The API's 400 names the live codes; showing it beats "something failed".
      setError(apiErrorMessage(err));
    },
  });

  const groups = groupsQ.data?.items ?? [];
  const members = membersQ.data?.items ?? [];
  const roleCounts = membersQ.data?.roleCounts ?? {};
  const roles = vocabQ.data?.assetRoles ?? [];
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;
  const memberAssetIds = new Set(members.map((m) => m.assetId));
  const pickable = (pickerAssetsQ.data?.items ?? []).filter(
    (a) => a.active && !memberAssetIds.has(a.id),
  );

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Asset Groups"
        subtitle="Set the role each asset plays in its group — what a section dashboard binds to"
      />

      {error ? (
        <div role="alert" className="mb-4 rounded border border-critical-line-strong bg-critical-wash p-3 text-sm text-critical-ink-strong">
          {error}
        </div>
      ) : null}

      {/*
        §5: eight sibling `/admin/*` pages carry this bar, and the API has
        accepted `locationId` since the first commit. Without it the parameter
        was unreachable — a filter the server could honour and no user could
        ask for. `rtu` is omitted from the levels: a group hangs off a location,
        never off an RTU. `syncRoutes={false}`: the bar filters this screen;
        with the default it navigated to the organization's Locations page.
      */}
      <div className="mb-4">
        <HierarchyFilterBar
          user={user}
          levels={["organization", "location"]}
          selection={selection}
          syncRoutes={false}
          onNavigate={(next) => {
            setSelection(next);
            // The selected group may not survive the filter, and a stale id
            // would keep its member list on screen beside a list that no
            // longer contains it.
            setSelectedGroupId(null);
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <SectionCard title="Groups">
          {canWrite ? (
            <button
              type="button"
              className="surface-button mb-2 px-3 py-2 text-xs"
              onClick={() => {
                setForm({ ...EMPTY_FORM, locationId: selection.locationId ?? "" });
                setModal("create");
              }}
            >
              New group
            </button>
          ) : null}
          {groupsQ.isLoading ? <p className="text-sm text-ink-muted">Loading groups…</p> : null}
          {!groupsQ.isLoading && groups.length === 0 ? (
            <p className="text-sm text-ink-muted">No asset groups in your scope.</p>
          ) : null}
          <ul className="divide-y divide-line">
            {groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  aria-current={group.id === selectedGroupId ? "true" : undefined}
                  className={`w-full px-2 py-2 text-left text-sm ${
                    group.id === selectedGroupId ? "bg-canvas font-medium" : ""
                  }`}
                >
                  <span className="block">{group.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {group.locationName ?? "—"} · {group.memberCount}{" "}
                    {group.memberCount === 1 ? "member" : "members"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title={selectedGroup ? `Members — ${selectedGroup.name}` : "Members"}>
          {canWrite && selectedGroup ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="surface-button px-3 py-2 text-xs"
                onClick={() => {
                  setForm({
                    locationId: selectedGroup.locationId,
                    code: selectedGroup.code,
                    name: selectedGroup.name,
                    description: selectedGroup.description ?? "",
                  });
                  setModal("edit");
                }}
              >
                Edit group
              </button>
              <select
                aria-label="Asset to add"
                value={addAssetId}
                onChange={(event) => setAddAssetId(event.target.value)}
                className="surface-field px-2 py-1 text-sm"
              >
                <option value="">Add an asset…</option>
                {pickable.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name} ({asset.code})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="surface-button px-3 py-2 text-xs"
                disabled={addAssetId === "" || addMember.isPending}
                aria-busy={addMember.isPending}
                onClick={() => addMember.mutate(addAssetId)}
              >
                {addMember.isPending ? "Adding…" : "Add to group"}
              </button>
            </div>
          ) : null}
          {selectedGroupId === null ? (
            <p className="text-sm text-ink-muted">Select a group to set member roles.</p>
          ) : null}
          {selectedGroupId !== null && membersQ.isLoading ? (
            <p className="text-sm text-ink-muted">Loading members…</p>
          ) : null}
          {selectedGroupId !== null && !membersQ.isLoading && members.length === 0 ? (
            <p className="text-sm text-ink-muted">This group has no members.</p>
          ) : null}

          {members.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-ink-muted">
                  <th className="py-2">Asset</th>
                  <th className="py-2">Role</th>
                  <th className="py-2">Also in this group</th>
                  {canWrite ? <th className="py-2" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((member) => {
                  // removeMember is one mutation shared by every row: only
                  // the row whose id is in flight announces "Removing".
                  const removingThis =
                    removeMember.isPending && removeMember.variables === member.membershipId;
                  return (
                    <tr key={member.membershipId}>
                      <td className="py-2">
                        <span className="block">{member.assetName}</span>
                        <span className="block text-xs text-ink-muted">{member.assetCode}</span>
                      </td>
                      <td className="py-2">
                        <select
                          aria-label={`Role for ${member.assetName}`}
                          value={member.role ?? ""}
                          disabled={!canWrite || setRole.isPending}
                          onChange={(event) =>
                            setRole.mutate({
                              membershipId: member.membershipId,
                              // "" is the cleared state; the API takes an
                              // explicit null, never an empty string.
                              role: event.target.value === "" ? null : event.target.value,
                            })
                          }
                          className="surface-field px-2 py-1"
                        >
                          <option value="">No role</option>
                          {roles.map((role) => (
                            <option key={role.code} value={role.code}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 text-xs text-ink-muted">
                        {/*
                          ADR 0049 decision 6 ruled that an unresolved role imports
                          as a widget with zero bindings rendering "no data bound".
                          That was written for match/no-match. A role carried by
                          two of three chillers renders a widget that looks right
                          and is one short — visible only if something counts.
                        */}
                        {member.role
                          ? `${roleCounts[member.role] ?? 1} with this role`
                          : "—"}
                      </td>
                      {canWrite ? (
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            aria-label={
                              removingThis
                                ? `Removing ${member.assetName}…`
                                : `Remove ${member.assetName}`
                            }
                            aria-busy={removingThis}
                            className="surface-button px-2 py-1 text-xs"
                            disabled={removeMember.isPending}
                            onClick={() => removeMember.mutate(member.membershipId)}
                          >
                            {removingThis ? "Removing…" : "Remove"}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </SectionCard>
      </div>

      {modal !== null ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/40 p-4">
          <form
            role="dialog"
            aria-label={modal === "create" ? "New asset group" : "Edit asset group"}
            className="w-full max-w-md surface-dialog p-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveGroup.mutate();
            }}
          >
            <div className="grid gap-3">
              {modal === "create" ? (
                <>
                  <label className="block text-xs font-semibold text-ink-muted">
                    Location
                    <select
                      className="mt-1 w-full surface-field px-3 py-2 text-sm"
                      value={form.locationId}
                      required
                      onChange={(event) => setForm({ ...form, locationId: event.target.value })}
                    >
                      <option value="">Select a location</option>
                      {(formLocationsQ.data?.items ?? []).map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-ink-muted">
                    Code
                    <input
                      className="mt-1 w-full surface-field px-3 py-2 text-sm"
                      value={form.code}
                      required
                      maxLength={64}
                      onChange={(event) => setForm({ ...form, code: event.target.value })}
                    />
                  </label>
                </>
              ) : (
                <p className="text-xs text-ink-muted">
                  Code <span className="font-mono">{form.code}</span> cannot be changed: dashboards
                  and site templates find the group by it.
                </p>
              )}
              <label className="block text-xs font-semibold text-ink-muted">
                Name
                <input
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.name}
                  required
                  maxLength={255}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-ink-muted">
                Description
                <textarea
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.description}
                  maxLength={2000}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="surface-button px-3 py-2" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saveGroup.isPending}
                aria-busy={saveGroup.isPending}
                className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
              >
                {saveGroup.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </MasterDataLayout>
  );
}
