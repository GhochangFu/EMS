import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { NotificationChannelDto, UserRole } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { createNotificationChannel, type NotificationChannelPayload, updateNotificationChannel } from "../../api/notifications";
import { apiErrorMessage } from "../../lib/api-error-message";
import { type ChannelOrganizationOption, organizationChoiceRefusal } from "../../lib/notification-channels";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";

/** The catalog entry, or a build defect (the `rule-wizard.tsx` rule). */
export function channelWizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.279: the catalog has no entry "${id}"`);
  return entry;
}

/** The recipients or URL a channel's `config` holds, as the one text box shows them. */
function targetTextOf(kind: string, config: unknown): string {
  const record = typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
  if (kind === "webhook") return typeof record.url === "string" ? record.url : "";
  return Array.isArray(record.to) ? record.to.filter((item): item is string => typeof item === "string").join(", ") : "";
}

/** The `config` one text box means: a recipient list for email, a URL for a webhook. */
function configOf(kind: string, text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (kind === "webhook") return { url: trimmed };
  return {
    to: trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
  };
}

export type ChannelWizardProps = {
  /** The channel to edit; `null` for a new one. */
  channel: NotificationChannelDto | null;
  role: UserRole;
  organizationOptions: readonly ChannelOrganizationOption[];
  /** One organization, no choice: the select shows it disabled. */
  organizationLocked: boolean;
  organizationsUnavailable: boolean;
  /** The edited channel's organization, as the page names it. */
  organizationName: string;
  onCancel: () => void;
  onDone: () => Promise<void> | void;
};

/**
 * `F4.279` (ADR 0099 decision 6, Amendment 8) — the Channels page's form on the
 * shared `WizardShell`: `notificationChannel.create` and `.update`, Channel →
 * Delivery → Review. The values are the route's own body. The webhook secret is
 * an ordinary input here (a plain wizard is not a copilot change), held outside
 * the values and added at Submit; blank keeps the stored one. The organization
 * is chosen at create and fixed afterwards (`E7.1d`).
 */
export function ChannelWizard(props: ChannelWizardProps) {
  const { channel, role, organizationOptions, organizationLocked, organizationsUnavailable, onCancel, onDone } = props;
  const lockedOrganizationId = organizationLocked ? (organizationOptions[0]?.value ?? "") : "";
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    channel
      ? { name: channel.name, kind: channel.kind, config: channel.config }
      : {
          organizationId: lockedOrganizationId === "" ? undefined : lockedOrganizationId,
          code: "",
          name: "",
          kind: "email",
          enabled: true,
          config: { to: [] },
        },
  );
  const [targetText, setTargetText] = useState(() => (channel ? targetTextOf(channel.kind, channel.config) : ""));
  const [secret, setSecret] = useState("");
  const kind = typeof values.kind === "string" ? values.kind : "email";
  // A copilot fill may set `config`; the box follows the value when the typed text no longer means it.
  const shownTarget =
    JSON.stringify(configOf(kind, targetText)) === JSON.stringify(values.config) ? targetText : targetTextOf(kind, values.config);
  const organizationId = typeof values.organizationId === "string" ? values.organizationId : "";
  const refusal =
    channel === null ? organizationChoiceRefusal(role, organizationOptions, organizationId, organizationsUnavailable) : null;
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      const withSecret = secret === "" ? body : { ...body, secret };
      return channel
        ? updateNotificationChannel({ id: channel.id, patch: withSecret as Partial<NotificationChannelPayload> })
        : createNotificationChannel(withSecret as unknown as NotificationChannelPayload);
    },
    onSuccess: async () => onDone(),
  });
  const id = channel ? "notificationChannel.update" : "notificationChannel.create";
  const shared = {
    values,
    onChange: setValues,
    renderStep: (step: { id: string }) =>
      step.id === "channel" ? (
        <>
          {channel === null ? (
            <label className={labelClass}>
              Organization
              <select
                className={fieldClass}
                value={organizationId}
                disabled={organizationLocked}
                onChange={(event) => setValues({ ...values, organizationId: event.target.value === "" ? undefined : event.target.value })}
              >
                {role !== "admin" && !organizationLocked ? <option value="">Select organization</option> : null}
                {organizationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs text-ink-muted">Organization: {props.organizationName}</p>
          )}
          {channel === null ? (
            <label className={labelClass}>
              Code
              <input
                className={fieldClass}
                value={typeof values.code === "string" ? values.code : ""}
                onChange={(event) => setValues({ ...values, code: event.target.value })}
              />
            </label>
          ) : null}
          <label className={labelClass}>
            Name
            <input
              className={fieldClass}
              value={typeof values.name === "string" ? values.name : ""}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
            />
          </label>
          <label className={labelClass}>
            Kind
            <select
              className={fieldClass}
              value={kind}
              onChange={(event) => setValues({ ...values, kind: event.target.value, config: configOf(event.target.value, targetText) })}
            >
              <option value="email">email</option>
              <option value="webhook">webhook</option>
            </select>
          </label>
          {channel === null ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.enabled !== false}
                onChange={(event) => setValues({ ...values, enabled: event.target.checked })}
              />
              <span>Enabled</span>
            </label>
          ) : null}
          {refusal ? <p className="text-xs text-ink-muted">{refusal}</p> : null}
        </>
      ) : (
        <>
          <label className={labelClass}>
            {kind === "email" ? "Recipients (comma separated)" : "Webhook URL"}
            <input
              className={fieldClass}
              value={shownTarget}
              onChange={(event) => {
                setTargetText(event.target.value);
                setValues({ ...values, config: configOf(kind, event.target.value) });
              }}
            />
          </label>
          <label className={labelClass}>
            {channel?.hasSecret ? "Secret (set — type to replace)" : "Secret (optional)"}
            <input
              type="password"
              className={fieldClass}
              value={secret}
              placeholder={channel?.hasSecret ? "•••••••• stored" : ""}
              onChange={(event) => setSecret(event.target.value)}
            />
          </label>
        </>
      ),
    onSubmit: (body: Record<string, unknown>) => {
      if (refusal === null) save.mutate(body);
    },
    onCancel,
    submitting: save.isPending,
    submitError: refusal ?? (save.error ? apiErrorMessage(save.error) : null),
    summary: channelWizardEntry(id).summary({
      body: values,
      params: channel ? { id: channel.id } : {},
      targetName: channel?.name ?? "",
      organizationName: organizationOptions.find((option) => option.value === organizationId)?.label ?? props.organizationName,
    }),
  };
  return channel ? (
    <AdminWizardFrame title="Edit a notification channel">
      <WizardShell
        entry={channelWizardEntry("notificationChannel.update")}
        {...shared}
        params={{ id: channel.id }}
        current={{ name: channel.name, kind: channel.kind, config: channel.config }}
      />
    </AdminWizardFrame>
  ) : (
    <AdminWizardFrame title="Create a notification channel">
      <WizardShell entry={channelWizardEntry("notificationChannel.create")} {...shared} params={{}} />
    </AdminWizardFrame>
  );
}
