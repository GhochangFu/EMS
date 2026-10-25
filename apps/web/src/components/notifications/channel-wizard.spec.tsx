import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { expect, vi } from "vitest";

import type { NotificationChannelDto } from "@bms/shared";

import * as api from "../../api/notifications";
import { ChannelTestWizard } from "./channel-test-wizard";
import { ChannelToggleWizard } from "./channel-toggle-wizard";
import { ChannelWizard } from "./channel-wizard";

/**
 * `F4.279` (ADR 0099 decision 6, Amendment 8) — the channel wizards on
 * `WizardShell`. A plain wizard is not a copilot change, so the webhook URL and
 * secret are ordinary inputs and Submit sends the plain request. Vitest entry
 * point: the sibling `.test.tsx` (jsdom).
 */

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

const CHANNEL: NotificationChannelDto = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: ORG,
  code: "ops-email",
  name: "Operations email",
  kind: "email",
  config: { to: ["ops@example.test"] },
  enabled: true,
  hasSecret: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function mount(element: ReactElement): void {
  render(<QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>);
}

async function next(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** A webhook create sends the URL in `config` and the secret typed in the wizard's own fields. */
export async function aWebhookCreateSendsTheUrlAndTheSecret(): Promise<void> {
  const create = vi.spyOn(api, "createNotificationChannel").mockResolvedValue(CHANNEL);
  mount(
    <ChannelWizard
      channel={null}
      role="admin"
      organizationOptions={[{ value: ORG, label: "Ion Exchange" }]}
      organizationLocked={false}
      organizationsUnavailable={false}
      organizationName=""
      onCancel={() => undefined}
      onDone={() => undefined}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Organization"), ORG);
  await userEvent.type(screen.getByLabelText("Code"), "ops-hook");
  await userEvent.type(screen.getByLabelText("Name"), "Ops hook");
  await userEvent.selectOptions(screen.getByLabelText("Kind"), "webhook");
  await next();
  await userEvent.type(screen.getByLabelText("Webhook URL"), "https://hooks.example.test/x");
  await userEvent.type(screen.getByLabelText("Secret (optional)"), "s3cret-value");
  await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0]?.[0]).toMatchObject({
    organizationId: ORG,
    kind: "webhook",
    config: { url: "https://hooks.example.test/x" },
    secret: "s3cret-value",
  });
}

/** The toggle of an enabled channel is the red deactivate card and sends `{ enabled: false }`. */
export async function theToggleSendsEnabledFalse(): Promise<void> {
  const update = vi.spyOn(api, "updateNotificationChannel").mockResolvedValue({ ...CHANNEL, enabled: false });
  mount(<ChannelToggleWizard channel={CHANNEL} onCancel={() => undefined} onDone={() => undefined} />);
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]?.[0]).toEqual({ id: CHANNEL.id, patch: { enabled: false } });
}

/** The toggle of a disabled channel is the reactivate entry (Q5) and sends `{ enabled: true }`. */
export async function theToggleOfADisabledChannelReactivates(): Promise<void> {
  const update = vi.spyOn(api, "updateNotificationChannel").mockResolvedValue(CHANNEL);
  mount(<ChannelToggleWizard channel={{ ...CHANNEL, enabled: false }} onCancel={() => undefined} onDone={() => undefined} />);
  expect(screen.getByRole("dialog", { name: "Enable a notification channel" })).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]?.[0]).toEqual({ id: CHANNEL.id, patch: { enabled: true } });
}

/** The test wizard calls the send test on Review's Submit, and not before. */
export async function theTestWizardSendsOnSubmit(): Promise<void> {
  const send = vi.spyOn(api, "testNotificationChannel").mockResolvedValue({
    channelId: CHANNEL.id,
    channelCode: CHANNEL.code,
    status: "sent",
    deliveryId: null,
    error: null,
  });
  mount(<ChannelTestWizard channel={CHANNEL} onCancel={() => undefined} onDone={() => undefined} />);
  const submit = await screen.findByRole("button", { name: "Submit" });
  expect(send).not.toHaveBeenCalled();
  await userEvent.click(submit);
  await waitFor(() => expect(send).toHaveBeenCalledWith(CHANNEL.id));
}
