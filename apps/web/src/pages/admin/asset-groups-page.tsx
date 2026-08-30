import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  adminAssetGroupMembersQueryKey,
  adminAssetGroupsQueryKey,
  fetchAdminAssetGroupMembers,
  fetchAdminAssetGroups,
  setAdminAssetGroupMemberRole,
} from "../../api/admin/asset-groups";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { isMasterDataAdmin } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

type AssetGroupsAdminPageProps = { user: AuthUser };

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

  const groupsQ = useQuery({
    queryKey: adminAssetGroupsQueryKey,
    queryFn: () => fetchAdminAssetGroups(),
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
      setError(err instanceof Error ? err.message : "Could not set the role");
    },
  });

  const groups = groupsQ.data?.items ?? [];
  const members = membersQ.data?.items ?? [];
  const roleCounts = membersQ.data?.roleCounts ?? {};
  const roles = vocabQ.data?.assetRoles ?? [];
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Asset Groups"
        subtitle="Set the role each asset plays in its group — what a section dashboard binds to"
      />

      {error ? (
        <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <SectionCard title="Groups">
          {groupsQ.isLoading ? <p className="text-sm text-slate-500">Loading groups…</p> : null}
          {!groupsQ.isLoading && groups.length === 0 ? (
            <p className="text-sm text-slate-500">No asset groups in your scope.</p>
          ) : null}
          <ul className="divide-y divide-slate-200">
            {groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  aria-current={group.id === selectedGroupId ? "true" : undefined}
                  className={`w-full px-2 py-2 text-left text-sm ${
                    group.id === selectedGroupId ? "bg-slate-100 font-medium" : ""
                  }`}
                >
                  <span className="block">{group.name}</span>
                  <span className="block text-xs text-slate-500">
                    {group.locationName ?? "—"} · {group.memberCount}{" "}
                    {group.memberCount === 1 ? "member" : "members"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title={selectedGroup ? `Members — ${selectedGroup.name}` : "Members"}>
          {selectedGroupId === null ? (
            <p className="text-sm text-slate-500">Select a group to set member roles.</p>
          ) : null}
          {selectedGroupId !== null && membersQ.isLoading ? (
            <p className="text-sm text-slate-500">Loading members…</p>
          ) : null}
          {selectedGroupId !== null && !membersQ.isLoading && members.length === 0 ? (
            <p className="text-sm text-slate-500">This group has no members.</p>
          ) : null}

          {members.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="py-2">Asset</th>
                  <th className="py-2">Role</th>
                  <th className="py-2">Also in this group</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {members.map((member) => (
                  <tr key={member.membershipId}>
                    <td className="py-2">
                      <span className="block">{member.assetName}</span>
                      <span className="block text-xs text-slate-500">{member.assetCode}</span>
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
                        className="rounded border border-slate-300 px-2 py-1"
                      >
                        <option value="">No role</option>
                        {roles.map((role) => (
                          <option key={role.code} value={role.code}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 text-xs text-slate-500">
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
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </SectionCard>
      </div>
    </MasterDataLayout>
  );
}
