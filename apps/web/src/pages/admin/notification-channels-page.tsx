import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { NotificationChannelDto, NotificationTestResult } from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  deleteNotificationChannel,
  fetchNotificationChannels,
  fetchNotificationReadiness,
} from "../../api/notifications";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { ChannelTestWizard } from "../../components/notifications/channel-test-wizard";
import { ChannelToggleWizard } from "../../components/notifications/channel-toggle-wizard";
import { ChannelWizard } from "../../components/notifications/channel-wizard";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import {
  channelOrganizationOptions,
  organizationChoiceRefusal,
  organizationLabel,
  sendTestRefusal,
  targetFromConfig,
  testResultMessage,
} from "../../lib/notification-channels";
import { apiErrorMessage } from "../../lib/api-error-message";
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
  /**
   * `F4.279` (ADR 0099 decision 6): the open wizard — a create or an edit
   * (`ChannelWizard`), a direction (`ChannelToggleWizard`) or a send test
   * (`ChannelTestWizard`). Each is a catalog entry on `WizardShell`, so the
   * copilot can fill it.
   */
  const [open, setOpen] = useState<
    | { kind: "create" }
    | { kind: "edit" | "toggle" | "test"; channel: NotificationChannelDto }
    | null
  >(null);
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

  // `E7.1d`. One organization and no choice: the wizard's select shows it disabled.
  const organizationLocked = user.role !== "admin" && organizationOptions.length <= 1;

  // Create only, and the page-level half of `organizationChoiceRefusal`: a list
  // that failed, or no organization at all, leaves nothing to choose in the
  // wizard, so the button says why it is disabled. The "choose one" half is the
  // wizard's own (its Organization field).
  const organizationsSettled = !organizationsQ.isPending;
  const createRefusal = !organizationsSettled
    ? null
    : user.role === "admin"
      ? null
      : organizationsQ.isError
        ? organizationChoiceRefusal(user.role, organizationOptions, "", true)
        : organizationOptions.length === 0
          ? organizationChoiceRefusal(user.role, organizationOptions, "")
          : null;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNotificationChannel(id),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const afterWrite = async () => {
    setOpen(null);
    setError(null);
    await queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
  };

  const channels = channelsQ.data?.items ?? [];
  const unready = (readinessQ.data?.items ?? []).filter((item) => !item.configured);
  const cannotCreate = createRefusal !== null || !organizationsSettled;

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
          className="rounded border border-warning-line bg-warning-wash px-3 py-2 text-sm text-warning-ink"
        >
          {unready.map((item) => (
            <p key={item.kind}>
              <strong className="uppercase">{item.kind}</strong>: {item.detail}
            </p>
          ))}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded border border-critical-line bg-critical-wash px-3 py-2 text-sm text-critical-ink-strong">
          {error}
        </div>
      ) : null}

      {testResult ? (
        <div
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            testResult.status === "sent"
              ? "border-accent/30 bg-accent/10 text-accent-strong"
              : "border-warning-line bg-warning-wash text-warning-ink"
          }`}
        >
          {testResultMessage(testResult)}
        </div>
      ) : null}

      <SectionCard title="Channels" bodyClassName="p-3 space-y-3">
        {channelsQ.isLoading ? <p className="text-sm text-ink-muted">Loading channels…</p> : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
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
                <tr key={channel.id} className="border-b border-well-deep">
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
                        className="text-xs font-semibold text-accent-strong"
                        onClick={() => {
                          setOpen({ kind: "edit", channel });
                          setError(null);
                        }}
                      >
                        Edit
                      </button>
                      {/* `E7.1d`: disabled on a fleet-wide channel, with the
                          reason beside it — a button that is greyed out and
                          says nothing is the same dead end as one that fails
                          silently. `F4.279`: it opens the red Review card. */}
                      <button
                        type="button"
                        className="text-xs font-semibold text-accent-strong disabled:text-ink-muted"
                        disabled={testRefusal !== null}
                        title={testRefusal ?? undefined}
                        onClick={() => setOpen({ kind: "test", channel })}
                      >
                        Send test
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-accent-strong"
                        onClick={() => setOpen({ kind: "toggle", channel })}
                      >
                        {channel.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-critical-ink"
                        onClick={() => deleteMutation.mutate(channel.id)}
                      >
                        Delete
                      </button>
                    </div>
                    {testRefusal ? (
                      <p className="mt-1 max-w-[22rem] text-xs text-ink-muted">{testRefusal}</p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!channelsQ.isLoading && channels.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-ink-muted" colSpan={8}>
                  No channels yet. A rule marked notify with no channel sends nothing.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="Add a channel" bodyClassName="p-3 space-y-3">
        {/* The reason travels with the disabled control, the same way the
            Send test refusal does. */}
        {createRefusal ? <p className="text-xs text-ink-muted">{createRefusal}</p> : null}
        <button
          type="button"
          className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:bg-line-strong"
          disabled={cannotCreate}
          aria-busy={organizationsQ.isPending}
          onClick={() => {
            setOpen({ kind: "create" });
            setError(null);
          }}
        >
          {organizationsQ.isPending ? "Loading organizations…" : "Add channel"}
        </button>
      </SectionCard>

      {open?.kind === "create" || open?.kind === "edit" ? (
        <ChannelWizard
          channel={open.kind === "edit" ? open.channel : null}
          role={user.role}
          organizationOptions={organizationOptions}
          organizationLocked={organizationLocked}
          organizationsUnavailable={organizationsQ.isError}
          organizationName={open.kind === "edit" ? organizationLabel(open.channel.organizationId, organizations) : ""}
          onCancel={() => setOpen(null)}
          onDone={afterWrite}
        />
      ) : null}
      {open?.kind === "toggle" ? (
        <ChannelToggleWizard channel={open.channel} onCancel={() => setOpen(null)} onDone={afterWrite} />
      ) : null}
      {open?.kind === "test" ? (
        <ChannelTestWizard
          channel={open.channel}
          onCancel={() => setOpen(null)}
          onDone={async (result) => {
            setOpen(null);
            setTestResult({ ...result, channelCode: result.channelCode });
            setError(null);
            await queryClient.invalidateQueries({ queryKey: ["notifications", "deliveries"] });
          }}
        />
      ) : null}
    </MasterDataLayout>
  );
}
