import { useMutation } from "@tanstack/react-query";
import type { NotificationChannelDto, NotificationTestResult } from "@bms/shared";

import { testNotificationChannel } from "../../api/notifications";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";
import { channelWizardEntry } from "./channel-wizard";

type ChannelTestWizardProps = {
  channel: NotificationChannelDto;
  onCancel: () => void;
  onDone: (result: NotificationTestResult) => Promise<void> | void;
};

/**
 * `F4.279` (Amendment 8 D4; owner ruling Q1) — `notificationChannel.test`, the
 * Review step alone and red: a real message goes out and the attempt is
 * written to the delivery ledger. The page's own Send test button opens it.
 */
export function ChannelTestWizard({ channel, onCancel, onDone }: ChannelTestWizardProps) {
  const send = useMutation({
    mutationFn: () => testNotificationChannel(channel.id),
    onSuccess: async (result) => onDone(result),
  });
  return (
    <AdminWizardFrame title="Send a test message">
      <WizardShell
        entry={channelWizardEntry("notificationChannel.test")}
        onChange={() => undefined}
        renderStep={() => null}
        onSubmit={() => send.mutate()}
        onCancel={onCancel}
        submitting={send.isPending}
        submitError={send.error ? apiErrorMessage(send.error) : null}
        params={{ id: channel.id }}
        values={{}}
        summary={channelWizardEntry("notificationChannel.test").summary({
          body: {},
          params: { id: channel.id },
          targetName: channel.name,
          organizationName: "",
        })}
      />
    </AdminWizardFrame>
  );
}
