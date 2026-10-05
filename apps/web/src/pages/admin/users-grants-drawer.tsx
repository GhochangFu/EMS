import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { userGrantKindSchema } from "@bms/shared/contracts";
import type { AdminUserDto, UserGrantDto, UserGrantKind } from "@bms/shared";

import { fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import { fetchAdminLocations } from "../../api/admin/locations";
import {
  addAdminUserGrant,
  adminUserGrantsQueryKey,
  fetchAdminUserGrants,
  removeAdminUserGrant,
} from "../../api/admin/users";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { roleLabel } from "../../lib/role-label";
import {
  FeedbackBox,
  KIND_LABELS,
  failureFeedback,
  fieldClass,
  labelClass,
  type Feedback,
  type Organizations,
} from "./users-feedback";

/** Grants touch only the database, so local sign-in still manages them (ADR 0089 decision 11). */
export function GrantsDrawer({
  target,
  organizations,
  onClose,
}: {
  target: AdminUserDto;
  organizations: Organizations;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [kind, setKind] = useState<UserGrantKind>("location");
  const [targetId, setTargetId] = useState("");
  const [removing, setRemoving] = useState<UserGrantDto | null>(null); // `F4.202`: asks first

  const grantsQ = useQuery({
    queryKey: adminUserGrantsQueryKey(target.id),
    queryFn: () => fetchAdminUserGrants(target.id),
  });
  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true"],
    queryFn: () => fetchAdminLocations("true"),
    enabled: kind === "location",
  });
  const groupsQ = useQuery({
    queryKey: ["admin", "asset-groups", "all"],
    queryFn: () => fetchAdminAssetGroups(),
    enabled: kind === "asset_group",
  });

  // `F4.201`: an asset group is "Group · Location" — two locations can each have an "HVAC".
  const options: { id: string; label: string }[] =
    kind === "organization"
      ? organizations.map((org) => ({ id: org.id, label: org.name }))
      : kind === "location"
        ? (locationsQ.data?.items ?? []).map((loc) => ({ id: loc.id, label: loc.name }))
        : (groupsQ.data?.items ?? []).map((g) => ({ id: g.id, label: `${g.name} · ${g.locationName ?? "—"}` }));

  const settle = {
    onSuccess: (response: { items: UserGrantDto[] }) => {
      queryClient.setQueryData(adminUserGrantsQueryKey(target.id), response);
      setFeedback(null);
    },
    onError: (err: unknown) => setFeedback(failureFeedback(err, "grant")),
  };
  const add = useMutation({
    mutationFn: () => addAdminUserGrant(target.id, { kind, targetId }),
    ...settle,
    onSuccess: (response) => {
      settle.onSuccess(response);
      setTargetId("");
    },
  });
  const remove = useMutation({
    mutationFn: (grant: UserGrantDto) => removeAdminUserGrant(target.id, grant.kind, grant.id),
    ...settle,
  });

  const grants = grantsQ.data?.items ?? [];

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto surface-dialog p-4">
      <div role="dialog" aria-label={`Grants for ${target.displayName}`}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-condensed text-lg font-bold text-ink">Grants for {target.displayName}</h2>
          <button type="button" className="surface-button px-3 py-1 text-xs" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-muted">Role: {roleLabel(target.role)}</p>

        <div className="mt-3 space-y-3">
          <FeedbackBox feedback={feedback} />
          {grantsQ.isLoading ? <p className="text-sm text-ink-muted">Loading grants…</p> : null}
          {grantsQ.isError ? (
            <p role="alert" className="text-sm text-critical-ink">
              {failureFeedback(grantsQ.error).messages.join(" ")}
            </p>
          ) : null}
          {!grantsQ.isLoading && !grantsQ.isError && grants.length === 0 ? (
            <p className="text-sm text-ink-muted">This user has no grants.</p>
          ) : null}
          <ul className="divide-y divide-line">
            {grants.map((grant) => {
              // F4.168 D4: the name keys on the grant being removed; `disabled` stays shared.
              const removingThis =
                remove.isPending &&
                remove.variables?.kind === grant.kind &&
                remove.variables?.id === grant.id;
              const grantName = `${KIND_LABELS[grant.kind]} grant ${grant.targetName}`;
              return (
              <li key={`${grant.kind}-${grant.id}`} className="flex items-start justify-between gap-2 py-2">
                <div className="text-sm">
                  <span className="block font-semibold">{grant.targetName}</span>
                  <span className="block text-xs text-ink-muted">
                    {`${KIND_LABELS[grant.kind]}${grant.locationName ? ` · ${grant.locationName}` : ""}`}
                  </span>
                  {grant.effective ? null : (
                    <span className="block text-xs text-warning-ink">
                      Not used by the {roleLabel(target.role)} role.
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={removingThis ? `Removing ${grantName}` : `Remove ${grantName}`}
                  aria-busy={removingThis}
                  disabled={remove.isPending}
                  className="text-xs font-semibold text-critical-ink disabled:opacity-50"
                  onClick={() => setRemoving(grant)}
                >
                  Remove
                </button>
              </li>
              );
            })}
          </ul>
        </div>

        <form
          className="mt-4 space-y-3 border-t border-line pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <h3 className="text-sm font-semibold">Add a grant</h3>
          <label className={labelClass}>
            Grant kind
            <select
              className={fieldClass}
              value={kind}
              onChange={(event) => {
                setKind(userGrantKindSchema.parse(event.target.value));
                setTargetId("");
              }}
            >
              {userGrantKindSchema.options.map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Grant target
            <select
              className={fieldClass}
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">Select a target</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
            disabled={targetId === "" || add.isPending}
            aria-busy={add.isPending}
          >
            {add.isPending ? "Adding…" : "Add grant"}
          </button>
        </form>
        {removing ? (
          <ConfirmDialog
            title={`Remove ${KIND_LABELS[removing.kind]} grant ${removing.targetName}`}
            body="The user loses the access this grant gives."
            confirmLabel="Confirm remove"
            onClose={() => setRemoving(null)}
            onConfirm={() => { setRemoving(null); remove.mutate(removing); }}
          />
        ) : null}
      </div>
    </div>
  );
}
