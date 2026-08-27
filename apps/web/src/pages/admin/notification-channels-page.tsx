import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { NotificationChannelDto, NotificationTestResult } from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  createNotificationChannel,
  deleteNotificationChannel,
  fetchNotificationChannels,
  fetchNotificationReadiness,
  testNotificationChannel,
  updateNotificationChannel,
} from "../../api/notifications";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import {
  blankChannelForm,
  channelFormToPatch,
  channelFormToPayload,
  channelOrganizationOptions,
  formFromChannel,
  organizationLabel,
  sendTestRefusal,
  targetFromConfig,
  testResultMessage,
  type ChannelForm,
} from "../../lib/notification-channels";
import type { AuthUser } from "../../stores/auth-store";

type NotificationChannelsPageProps = { user: AuthUser };

/**
 * `F3.8` — the channels admin screen (ADR 0041 decision 10), split org-scoped
 * from fleet-wide by `E7.1d` (ADR 0043 Consequences).
 *
 * The secret field is **write-only**. The DTO carries `hasSecret` and never the
 * value, so an existing channel shows "secret set" and an empty box: there is
 * nothing to populate it with, and a placeholder pretending otherwise would
 * teach an operator that the value is retrievable.
 *
 * The **Send test** button is the reason this screen is inside `F3.8` rather
 * than after it. It performs a real dispatch through the real transport, so a
 * webhook the egress guard refuses says so here, at configuration time, instead
 * of failing silently at 3am.
 *
 * **`E7.1d` — who this screen is for, and what it can create.** The API stopped
 * being global-admin-only in `E7.1c`: an `organization_admin` administers its
 * own organizations' channels, and `ChannelsService.list` already filters the
 * rows. Three things follow, and all three are decisions rather than
 * conveniences:
 *
 * 1. **The organization is chosen at create and fixed afterwards.**
 *    `updateNotificationChannelBodySchema` declares no `organizationId`, so the
 *    field renders disabled while editing — the same treatment `code` gets —
 *    rather than being hidden. An operator editing ACME's channel should be
 *    able to see that it is ACME's.
 * 2. **Fleet-wide stays creatable, by an `admin` only.** `organization_id IS
 *    NULL` is a legitimate ongoing state per the DTO, not a migration
 *    leftover. `canManageNotificationChannel` refuses it to an
 *    `organization_admin`, so that role is never offered it.
 * 3. **Send test is disabled on a fleet-wide channel, with the reason beside
 *    it.** `NotificationsService.sendTest` answers 400 there — a delivery row
 *    has carried `organization_id NOT NULL` since migration `0048` and there
 *    is nothing to attribute the attempt to. Leaving the button live would put
 *    that refusal after the click, by which point the operator has already
 *    assumed a message went out.
 *
 * The readiness banner below is untouched and must stay so: ADR 0041 decision
 * 10 leaves it ungated on purpose, one boolean and one sentence per kind, and
 * it names no host and no credential.
 */
export function NotificationChannelsPage({ user }: NotificationChannelsPageProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ChannelForm>(blankChannelForm());
  const [editing, setEditing] = useState<NotificationChannelDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    (NotificationTestResult & { channelCode: string }) | null
  >(null);

  const channelsQ = useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: fetchNotificationChannels,
  });

  const readinessQ = useQuery({
    queryKey: ["notifications", "readiness"],
    queryFn: fetchNotificationReadiness,
  });

  // `"all"`, not `"true"`: this list resolves the Organization column's names,
  // and a channel in a deactivated organization is still a real row that must
  // render its name. `channelOrganizationOptions` filters to active for the
  // picker, where offering a deactivated organization would be wrong.
  const organizationsQ = useQuery({
    queryKey: ["admin", "organizations", "all"],
    queryFn: () => fetchAdminOrganizations("all"),
  });
  const organizations = useMemo(
    () => organizationsQ.data?.items ?? [],
    [organizationsQ.data?.items],
  );
  const organizationOptions = useMemo(
    () => channelOrganizationOptions(user.role, organizations),
    [user.role, organizations],
  );

  // The `HierarchyFilterBar` pattern: a non-global admin with exactly one
  // organization has no choice to make, so the control is shown locked rather
  // than hidden. Hiding it would leave the operator unable to see which tenant
  // the channel they are creating belongs to.
  const organizationLocked = user.role !== "admin" && organizationOptions.length <= 1;
  const effectiveOrganizationId = organizationLocked
    ? (organizationOptions[0]?.value ?? "")
    : form.organizationId;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        // `channelFormToPatch`, not `channelFormToPayload`: an update carries
        // neither `code` nor `organizationId`, and sending a tenancy field the
        // API silently strips would read back as a successful move.
        return updateNotificationChannel({ id: editing.id, patch: channelFormToPatch(form) });
      }
      return createNotificationChannel(
        channelFormToPayload({ ...form, organizationId: effectiveOrganizationId }),
      );
    },
    onSuccess: async () => {
      setForm(blankChannelForm());
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNotificationChannel(id),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const testMutation = useMutation({
    mutationFn: (channel: NotificationChannelDto) => testNotificationChannel(channel.id),
    onSuccess: async (result) => {
      setTestResult({ ...result, channelCode: result.channelCode });
      setError(null);
      // A test writes a delivery row like any other attempt.
      await queryClient.invalidateQueries({ queryKey: ["notifications", "deliveries"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const channels = channelsQ.data?.items ?? [];
  const unready = (readinessQ.data?.items ?? []).filter((item) => !item.configured);

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Notification Channels"
        subtitle="Where an alarm goes when a rule marked notify raises one"
      />

      {unready.length > 0 ? (
        <div
          role="status"
          className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {unready.map((item) => (
            <p key={item.kind}>
              <strong className="uppercase">{item.kind}</strong>: {item.detail}
            </p>
          ))}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {testResult ? (
        <div
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            testResult.status === "sent"
              ? "border-bms-green/30 bg-bms-green/10 text-bms-green"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {testResultMessage(testResult)}
        </div>
      ) : null}

      <SectionCard title="Channels" bodyClassName="p-3 space-y-3">
        {channelsQ.isLoading ? <p className="text-sm text-bms-muted">Loading channels…</p> : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-bms-muted">
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              {/* `E7.1d`. Shown to every role that reaches this screen, not
                  only to `admin`: an `organization_admin` with more than one
                  organization needs it as much, and one with a single
                  organization is told plainly whose channels these are. */}
              <th className="px-2 py-2">Organization</th>
              <th className="px-2 py-2">Kind</th>
              <th className="px-2 py-2">Target</th>
              <th className="px-2 py-2">Secret</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => {
              const testRefusal = sendTestRefusal(channel);
              return (
              <tr key={channel.id} className="border-b border-gray-100">
                <td className="px-2 py-2 font-mono">{channel.code}</td>
                <td className="px-2 py-2">{channel.name}</td>
                <td className="px-2 py-2">
                  {organizationLabel(channel.organizationId, organizations)}
                </td>
                <td className="px-2 py-2">{channel.kind}</td>
                <td className="px-2 py-2 max-w-[22rem] truncate">
                  {targetFromConfig(channel) || "—"}
                </td>
                <td className="px-2 py-2">{channel.hasSecret ? "Set" : "—"}</td>
                <td className="px-2 py-2">
                  <StatusPill
                    label={channel.enabled ? "Enabled" : "Disabled"}
                    tone={channel.enabled ? "ok" : "offline"}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-semibold text-bms-green"
                      onClick={() => {
                        setEditing(channel);
                        setForm(formFromChannel(channel));
                        setError(null);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-bms-green disabled:text-bms-muted"
                      disabled={testMutation.isPending || testRefusal !== null}
                      // The reason travels with the disabled control. A button
                      // that is greyed out and says nothing is the same dead
                      // end as one that fails silently.
                      title={testRefusal ?? undefined}
                      onClick={() => testMutation.mutate(channel)}
                    >
                      Send test
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-red-700"
                      onClick={() => deleteMutation.mutate(channel.id)}
                    >
                      Delete
                    </button>
                  </div>
                  {testRefusal ? (
                    <p className="mt-1 max-w-[22rem] text-xs text-bms-muted">{testRefusal}</p>
                  ) : null}
                </td>
              </tr>
              );
            })}
            {!channelsQ.isLoading && channels.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-bms-muted" colSpan={8}>
                  No channels yet. A rule marked notify with no channel sends nothing.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard
        title={editing ? `Edit ${editing.code}` : "Add a channel"}
        bodyClassName="p-3 space-y-3"
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase text-bms-muted">Code</span>
              <input
                className="w-full rounded border px-3 py-1.5"
                value={form.code}
                disabled={editing !== null}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase text-bms-muted">Name</span>
              <input
                className="w-full rounded border px-3 py-1.5"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            {/* `E7.1d`. Disabled while editing rather than hidden: a channel
                cannot change organization (`PATCH` carries no
                `organizationId`), but the operator must still see whose
                channel they are editing. Disabled again when the role has
                exactly one organization — no choice to make, and hiding it
                would hide the tenant too. */}
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase text-bms-muted">
                Organization
              </span>
              <select
                className="w-full rounded border px-3 py-1.5 disabled:bg-gray-50 disabled:text-bms-muted"
                value={editing ? form.organizationId : effectiveOrganizationId}
                disabled={editing !== null || organizationLocked}
                onChange={(event) =>
                  setForm({ ...form, organizationId: event.target.value })
                }
              >
                {/* An edited channel may sit in an organization the picker
                    does not offer — a deactivated one, or fleet-wide under a
                    role that cannot create fleet-wide. The disabled control
                    must still render its real value rather than snap to the
                    first option and misreport the row. */}
                {editing ? (
                  <option value={form.organizationId}>
                    {organizationLabel(editing.organizationId, organizations)}
                  </option>
                ) : (
                  organizationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase text-bms-muted">Kind</span>
              <select
                className="w-full rounded border px-3 py-1.5"
                value={form.kind}
                onChange={(event) => setForm({ ...form, kind: event.target.value })}
              >
                <option value="email">email</option>
                <option value="webhook">webhook</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase text-bms-muted">
                {form.kind === "email" ? "Recipients (comma separated)" : "Webhook URL"}
              </span>
              <input
                className="w-full rounded border px-3 py-1.5"
                value={form.target}
                onChange={(event) => setForm({ ...form, target: event.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase text-bms-muted">
                {editing?.hasSecret ? "Secret (set — type to replace)" : "Secret (optional)"}
              </span>
              <input
                type="password"
                className="w-full rounded border px-3 py-1.5"
                value={form.secret}
                placeholder={editing?.hasSecret ? "•••••••• stored" : ""}
                onChange={(event) => setForm({ ...form, secret: event.target.value })}
              />
            </label>
            <label className="flex items-end gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              <span>Enabled</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
              disabled={saveMutation.isPending}
            >
              {editing ? "Save changes" : "Add channel"}
            </button>
            {editing ? (
              <button
                type="button"
                className="rounded border px-3 py-2 text-xs font-semibold"
                onClick={() => {
                  setEditing(null);
                  setForm(blankChannelForm());
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </SectionCard>
    </MasterDataLayout>
  );
}
