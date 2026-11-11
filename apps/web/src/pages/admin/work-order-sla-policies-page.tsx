import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  WORK_ORDER_SLA_DEFAULT_MINUTES,
  WORK_ORDER_SLA_MAX_MINUTES,
  formatSlaMinutes,
  type WorkOrderPriority,
  type WorkOrderSlaPoliciesResponse,
} from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  fetchWorkOrderSlaPolicies,
  putWorkOrderSlaPolicies,
  type WorkOrderSlaPolicyInput,
} from "../../api/admin/work-order-sla-policies";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { priorityLabels } from "../../components/work-orders/work-order-labels";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { canManageWorkOrderSettings } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type WorkOrderSlaPoliciesAdminPageProps = { user: AuthUser };

/** The organizations list the Locations and Trend Points pages read; one cache entry for all. */
const ORGANIZATIONS_KEY = ["admin", "organizations", "all"] as const;

function policiesKey(organizationId: string) {
  return ["admin", "work-order-sla-policies", organizationId] as const;
}

/** The order the screen shows the four priorities in. */
const ORDER: readonly WorkOrderPriority[] = ["critical", "high", "medium", "low"];

/**
 * `E3.1` (ADR 0122 decision 3, plan D8) — the organization-level screen for the
 * per-priority SLA of work orders: how many minutes each priority has, from creation to
 * resolved.
 *
 * **It fails closed at the page.** The route admits every master-data role, but the
 * routes answer only the global `admin` and the organization's `organization_admin`
 * (ruling S2). For any other role the page renders one status line and mounts no
 * query, so no request is made.
 */
export function WorkOrderSlaPoliciesAdminPage({ user }: WorkOrderSlaPoliciesAdminPageProps) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Work Order SLA"
        subtitle="How long each priority has, from creation to resolved"
      />
      {canManageWorkOrderSettings(user.role) ? (
        <SlaPoliciesEditor />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Work-order SLA policies are set by an organization administrator or a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function SlaPoliciesEditor() {
  const [chosen, setChosen] = useState<string>("");

  const orgsQ = useQuery({
    queryKey: ORGANIZATIONS_KEY,
    queryFn: () => fetchAdminOrganizations("all"),
  });
  const organizations = orgsQ.data?.items ?? [];
  // A scoped administrator's list holds only its own organizations; the first is the default.
  const organizationId = chosen || organizations[0]?.id || "";

  const policiesQ = useQuery({
    queryKey: policiesKey(organizationId),
    queryFn: () => fetchWorkOrderSlaPolicies(organizationId),
    enabled: organizationId !== "",
  });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="sla-policies-organization" className="block text-xs font-semibold text-ink-muted">
          Organization
        </label>
        <select
          id="sla-policies-organization"
          className="mt-1 surface-field px-3 py-2 text-sm"
          value={organizationId}
          onChange={(event) => setChosen(event.target.value)}
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.code} — {organization.name}
            </option>
          ))}
        </select>
      </div>

      {orgsQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(orgsQ.error)}
        </p>
      ) : null}
      {policiesQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(policiesQ.error)}
        </p>
      ) : null}
      {organizationId !== "" && policiesQ.isPending ? (
        <p className="text-sm text-ink-muted">Loading SLA policies…</p>
      ) : null}

      {policiesQ.data ? (
        <PolicyTable
          // A new organization or a saved set starts the draft again from the server.
          key={`${organizationId}:${policiesQ.data.items.map((item) => `${item.priority}=${item.resolutionMinutes}/${item.source}`).join(",")}`}
          organizationId={organizationId}
          data={policiesQ.data}
        />
      ) : null}
    </div>
  );
}

type Draft = { minutes: string; own: boolean };

/** Whole minutes from 1 to the cap, or `null` when the text is anything else. */
function parseMinutes(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= 1 && value <= WORK_ORDER_SLA_MAX_MINUTES ? value : null;
}

function PolicyTable({ organizationId, data }: { organizationId: string; data: WorkOrderSlaPoliciesResponse }) {
  const queryClient = useQueryClient();
  const initial = new Map<WorkOrderPriority, Draft>(
    data.items.map((item) => [item.priority, { minutes: String(item.resolutionMinutes), own: item.source === "organization" }]),
  );
  const [drafts, setDrafts] = useState<Map<WorkOrderPriority, Draft>>(initial);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (policies: WorkOrderSlaPolicyInput[]) => putWorkOrderSlaPolicies(organizationId, policies),
    onSuccess: (response) => {
      setError(null);
      queryClient.setQueryData(policiesKey(organizationId), response);
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const rows = ORDER.filter((priority) => drafts.has(priority));
  const policies: WorkOrderSlaPolicyInput[] = [];
  let invalid = false;
  let changed = false;
  for (const priority of rows) {
    const draft = drafts.get(priority) as Draft;
    const before = initial.get(priority) as Draft;
    if (draft.own !== before.own || (draft.own && draft.minutes !== before.minutes)) changed = true;
    if (!draft.own) continue;
    const minutes = parseMinutes(draft.minutes);
    if (minutes === null) invalid = true;
    else policies.push({ priority, resolutionMinutes: minutes });
  }

  function update(priority: WorkOrderPriority, draft: Draft): void {
    setDrafts(new Map(drafts).set(priority, draft));
  }

  return (
    <SectionCard title="Resolution time by priority" bodyClassName="p-3 space-y-3">
      <p className="text-sm text-ink-muted">
        The SLA is saved on each work order when it is created. A change here applies to work orders created from now on.
      </p>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-ink-muted">
            <th className="px-2 py-2">Priority</th>
            <th className="px-2 py-2">Minutes</th>
            <th className="px-2 py-2">Reads</th>
            <th className="px-2 py-2">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((priority) => {
            const draft = drafts.get(priority) as Draft;
            const label = priorityLabels[priority];
            const parsed = parseMinutes(draft.minutes);
            return (
              <tr key={priority} className="border-b border-well-deep">
                <td className="px-2 py-2">{label}</td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={1}
                    max={WORK_ORDER_SLA_MAX_MINUTES}
                    step={1}
                    className="surface-field w-32 px-3 py-2 text-sm"
                    aria-label={`Minutes for ${label}`}
                    value={draft.minutes}
                    onChange={(event) => update(priority, { minutes: event.target.value, own: true })}
                  />
                </td>
                <td className="px-2 py-2">{parsed === null ? "" : formatSlaMinutes(parsed)}</td>
                <td className="px-2 py-2">
                  {draft.own ? (
                    <span className="flex items-center gap-2">
                      <span>Set for this organization</span>
                      <button
                        type="button"
                        className="text-xs font-semibold text-accent-strong"
                        onClick={() =>
                          update(priority, { minutes: String(WORK_ORDER_SLA_DEFAULT_MINUTES[priority]), own: false })
                        }
                      >
                        Use default
                      </button>
                    </span>
                  ) : (
                    <span className="text-ink-muted">Platform default</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {invalid ? (
        <p className="text-sm text-critical-ink">{`Enter whole minutes from 1 to ${WORK_ORDER_SLA_MAX_MINUTES}.`}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-critical-ink">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="surface-button px-3 py-2 text-xs font-semibold disabled:opacity-60"
        disabled={save.isPending || !changed || invalid}
        aria-busy={save.isPending}
        onClick={() => save.mutate(policies)}
      >
        {save.isPending ? "Saving…" : "Save"}
      </button>
    </SectionCard>
  );
}
