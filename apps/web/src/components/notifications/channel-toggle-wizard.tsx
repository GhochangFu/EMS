import { useMutation } from "@tanstack/react-query";
import type { NotificationChannelDto } from "@bms/shared";

import { updateNotificationChannel } from "../../api/notifications";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";
import { channelWizardEntry } from "./channel-wizard";

type ChannelActionWizardProps = {
  channel: NotificationChannelDto;
  onCancel: () => void;
  onDone: () => Promise<void> | void;
};

/**
 * `F4.279` (Amendment 8 D3; owner ruling Q5) — `notificationChannel.deactivate`
 * and `.reactivate`, each the Review step alone: the direction is the channel's
 * opposite (the `RuleToggleWizard` pattern). Deactivate is red.
 */
export function ChannelToggleWizard({ channel, onCancel, onDone }: ChannelActionWizardProps) {
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      updateNotificationChannel({ id: channel.id, patch: { enabled: body.enabled === true } }),
    onSuccess: async () => onDone(),
  });
  const shared = {
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: (body: Record<string, unknown>) => save.mutate(body),
    onCancel,
    submitting: save.isPending,
    submitError: save.error ? apiErrorMessage(save.error) : null,
  };
  const summaryOf = (id: string) =>
    channelWizardEntry(id).summary({ body: {}, params: { id: channel.id }, targetName: channel.name, organizationName: "" });
  return channel.enabled ? (
    <AdminWizardFrame title="Disable a notification channel">
      <WizardShell
        entry={channelWizardEntry("notificationChannel.deactivate")}
        {...shared}
        params={{ id: channel.id }}
        values={{ enabled: false }}
        summary={summaryOf("notificationChannel.deactivate")}
      />
    </AdminWizardFrame>
  ) : (
    <AdminWizardFrame title="Enable a notification channel">
      <WizardShell
        entry={channelWizardEntry("notificationChannel.reactivate")}
        {...shared}
        params={{ id: channel.id }}
        values={{ enabled: true }}
        summary={summaryOf("notificationChannel.reactivate")}
      />
    </AdminWizardFrame>
  );
}
