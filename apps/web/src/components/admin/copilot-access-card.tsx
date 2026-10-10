import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CopilotAccessDto, CopilotSwitchableRole } from "@bms/shared";

import { type CopilotAccessPutBody, fetchCopilotAccess, putCopilotAccess } from "../../api/admin/copilot-access";
import { fetchAdminUsers } from "../../api/admin/users";
import { isGlobalAdmin } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";
import { SectionCard } from "../section-card";

/** The roles an exception can name — the server refuses any other. */
const EXCEPTION_ROLES = ["organization_admin", "location_admin", "asset_group_admin"] as const;

const ROLE_LABELS: Record<CopilotSwitchableRole, string> = {
  location_admin: "Location admins",
  asset_group_admin: "Asset group admins",
};

type CopilotAccessCardProps = {
  orgId: string;
  user: AuthUser;
};

export function copilotAccessQueryKey(orgId: string): readonly unknown[] {
  return ["admin", "copilot-access", orgId];
}

/**
 * Who may use the administrator copilot in one organization (`F3.85` PR 3,
 * ADR 0099 decision 5): the organization switch, the two role switches and the
 * named-user exceptions. The organization switch is the global admin's to set;
 * an organization admin sees its state. A refusal shows the server's sentence.
 */
export function CopilotAccessCard({ orgId, user }: CopilotAccessCardProps) {
  const queryClient = useQueryClient();
  const accessQ = useQuery({
    queryKey: copilotAccessQueryKey(orgId),
    queryFn: () => fetchCopilotAccess(orgId),
    enabled: orgId !== "",
  });
  const usersQ = useQuery({ queryKey: ["admin", "users"], queryFn: fetchAdminUsers });
  const [error, setError] = useState<string | null>(null);
  const [pickedUser, setPickedUser] = useState("");

  const saveMutation = useMutation({
    mutationFn: (body: CopilotAccessPutBody) => putCopilotAccess(orgId, body),
    onSuccess: (dto: CopilotAccessDto) => {
      queryClient.setQueryData(copilotAccessQueryKey(orgId), dto);
      setError(null);
      // A saved pick leaves the options; a kept selection would leave Allow and Deny live for it.
      setPickedUser("");
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const access = accessQ.data;
  const candidates = (usersQ.data?.items ?? []).filter(
    (item) =>
      item.organizationId === orgId &&
      (EXCEPTION_ROLES as readonly string[]).includes(item.role) &&
      !access?.overrides.some((override) => override.userId === item.id),
  );
  const nameOf = (userId: string): string => {
    const found = usersQ.data?.items.find((item) => item.id === userId);
    return found ? `${found.displayName} (${found.email})` : userId;
  };
  const busy = saveMutation.isPending;

  return (
    <SectionCard title="Copilot access" bodyClassName="p-4 space-y-4">
      {accessQ.isLoading ? (
        <div className="text-sm text-ink-muted">Loading...</div>
      ) : accessQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(accessQ.error)}
        </p>
      ) : access ? (
        <>
          <p className="text-sm text-ink-muted">
            The administrator copilot answers questions and proposes changes for an administrator to confirm. A new
            organization starts with it off.
          </p>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={access.enabled}
              disabled={!isGlobalAdmin(user.role) || busy}
              onChange={(event) => saveMutation.mutate({ enabled: event.target.checked })}
            />
            Copilot on for this organization
          </label>
          {!isGlobalAdmin(user.role) ? (
            <p className="text-xs text-ink-muted">Only the global admin switches the copilot on or off for an organization.</p>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase text-ink-muted">Roles</legend>
            {(Object.keys(ROLE_LABELS) as CopilotSwitchableRole[]).map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={access.roles[role]}
                  disabled={busy}
                  onChange={(event) => saveMutation.mutate({ roles: { [role]: event.target.checked } })}
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase text-ink-muted">Named-user exceptions</legend>
            {access.overrides.length === 0 ? (
              <p className="text-sm text-ink-muted">No exceptions.</p>
            ) : (
              <ul className="space-y-1">
                {access.overrides.map((override) => (
                  <li key={override.userId} className="flex flex-wrap items-center gap-3 text-sm text-ink">
                    <span>{nameOf(override.userId)}</span>
                    <span className="font-semibold">{override.allow ? "Allowed" : "Denied"}</span>
                    <button
                      type="button"
                      className="text-xs font-semibold text-critical-ink disabled:opacity-60"
                      disabled={busy}
                      aria-busy={busy}
                      onClick={() => saveMutation.mutate({ override: { userId: override.userId, allow: null } })}
                    >
                      {busy ? "Saving…" : `Remove exception for ${nameOf(override.userId)}`}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-xs font-semibold text-ink-muted">
                Administrator
                <select
                  className="mt-1 surface-field px-3 py-2 text-sm"
                  value={pickedUser}
                  onChange={(event) => setPickedUser(event.target.value)}
                >
                  <option value="">Choose an administrator</option>
                  {candidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName} ({item.email})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="surface-button px-3 py-2 text-xs font-semibold disabled:opacity-60"
                disabled={pickedUser === "" || busy}
                aria-busy={busy}
                onClick={() => saveMutation.mutate({ override: { userId: pickedUser, allow: true } })}
              >
                {busy ? "Saving…" : "Allow"}
              </button>
              <button
                type="button"
                className="surface-button px-3 py-2 text-xs font-semibold disabled:opacity-60"
                disabled={pickedUser === "" || busy}
                aria-busy={busy}
                onClick={() => saveMutation.mutate({ override: { userId: pickedUser, allow: false } })}
              >
                {busy ? "Saving…" : "Deny"}
              </button>
            </div>
          </fieldset>
          {error ? (
            <div
              role="alert"
              className="rounded border border-critical-line-strong bg-critical-wash p-3 text-sm text-critical-ink-strong"
            >
              {error}
            </div>
          ) : null}
        </>
      ) : null}
    </SectionCard>
  );
}
