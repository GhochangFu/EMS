import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { NotificationChannelDto, NotificationTestResult } from "@bms/shared";

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
  channelFormToPayload,
  formFromChannel,
  targetFromConfig,
  testResultMessage,
  type ChannelForm,
} from "../../lib/notification-channels";
import type { AuthUser } from "../../stores/auth-store";

type NotificationChannelsPageProps = { user: AuthUser };

/**
 * `F3.8` — the channels admin screen (ADR 0041 decision 10).
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = channelFormToPayload(form);
      if (editing) {
        return updateNotificationChannel({ id: editing.id, patch: payload });
      }
      return createNotificationChannel(payload);
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
              <th className="px-2 py-2">Kind</th>
              <th className="px-2 py-2">Target</th>
              <th className="px-2 py-2">Secret</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.id} className="border-b border-gray-100">
                <td className="px-2 py-2 font-mono">{channel.code}</td>
                <td className="px-2 py-2">{channel.name}</td>
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
                      className="text-xs font-semibold text-bms-green"
                      disabled={testMutation.isPending}
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
                </td>
              </tr>
            ))}
            {!channelsQ.isLoading && channels.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-bms-muted" colSpan={7}>
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
