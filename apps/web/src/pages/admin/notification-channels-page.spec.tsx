import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { NotificationChannelDto } from "@bms/shared";

import * as api from "../../api/notifications";
import type { AuthUser } from "../../stores/auth-store";
import { NotificationChannelsPage } from "./notification-channels-page";

/**
 * `F3.8` U8 — the channels screen, rendered (ADR 0042).
 *
 * Assertions live here; `notification-channels-page.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock, because
 * that is the file Vitest collects.
 *
 * Queries go by role and text (ADR 0042 decision 5). A test that asserted the
 * markup shape would pass a refactor that breaks the screen and fail one that
 * does not.
 */

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const emailChannel: NotificationChannelDto = {
  id: "11111111-1111-1111-1111-111111111111",
  organizationId: null,
  code: "ops-email",
  name: "Operations email",
  kind: "email",
  config: { to: ["control.room@example.test"] },
  enabled: true,
  hasSecret: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const webhookChannel: NotificationChannelDto = {
  id: "22222222-2222-2222-2222-222222222222",
  organizationId: null,
  code: "ops-webhook",
  name: "Operations webhook",
  kind: "webhook",
  config: { url: "https://grafana/api/hook" },
  enabled: true,
  hasSecret: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationChannelsPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubApi(overrides: Partial<typeof api> = {}): void {
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({
    items: [emailChannel, webhookChannel],
  });
  vi.spyOn(api, "fetchNotificationReadiness").mockResolvedValue({
    items: [
      { kind: "email", configured: true, detail: "SMTP is configured." },
      { kind: "webhook", configured: true, detail: "Webhooks send over https." },
    ],
  });
  for (const [name, value] of Object.entries(overrides)) {
    vi.spyOn(api, name as keyof typeof api).mockImplementation(value as never);
  }
}

export async function rendersBothKinds(): Promise<void> {
  stubApi();
  renderPage();

  expect(await screen.findByText("ops-email")).toBeInTheDocument();
  expect(screen.getByText("ops-webhook")).toBeInTheDocument();
  // The target column shows what each kind actually sends to.
  expect(screen.getByText("control.room@example.test")).toBeInTheDocument();
  expect(screen.getByText("https://grafana/api/hook")).toBeInTheDocument();
}

export async function showsWhetherASecretIsStoredWithoutShowingIt(): Promise<void> {
  stubApi();
  renderPage();

  await screen.findByText("ops-webhook");
  // `hasSecret: true` renders as "Set" — the whole of what the DTO carries.
  expect(screen.getByText("Set")).toBeInTheDocument();

  // Opening the channel for editing must leave the secret box EMPTY. A
  // populated box would say the stored value is retrievable; it is not.
  await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[1] as HTMLElement);
  const secretBox = await screen.findByLabelText(/Secret \(set/i);
  expect(secretBox).toHaveValue("");
}

/**
 * The acceptance criterion the plan names for this screen: a webhook the U4
 * egress guard refuses must READ as a refusal, not as a silent no-op.
 */
export async function surfacesAGuardRefusalAsVisibleText(): Promise<void> {
  stubApi({
    testNotificationChannel: (() =>
      Promise.resolve({
        channelId: webhookChannel.id,
        channelCode: "ops-webhook",
        status: "failed" as const,
        deliveryId: null,
        error: "webhook host grafana resolves to a private, loopback or link-local address",
      })) as typeof api.testNotificationChannel,
  });
  renderPage();

  await screen.findByText("ops-webhook");
  await userEvent.click(screen.getAllByRole("button", { name: "Send test" })[1] as HTMLElement);

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent(/Test failed for ops-webhook/i);
  });
  expect(screen.getByRole("status")).toHaveTextContent(/private, loopback or link-local/i);
}

export async function surfacesASuccessfulTest(): Promise<void> {
  stubApi({
    testNotificationChannel: (() =>
      Promise.resolve({
        channelId: emailChannel.id,
        channelCode: "ops-email",
        status: "sent" as const,
        deliveryId: null,
        error: null,
      })) as typeof api.testNotificationChannel,
  });
  renderPage();

  await screen.findByText("ops-email");
  await userEvent.click(screen.getAllByRole("button", { name: "Send test" })[0] as HTMLElement);

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent(/sent through ops-email/i);
  });
}

/** A duplicate code comes back as a 409; the operator must see the reason. */
export async function showsTheServerRefusalOnSave(): Promise<void> {
  stubApi({
    createNotificationChannel: (() =>
      Promise.reject(
        new Error("A notification channel with that code already exists"),
      )) as typeof api.createNotificationChannel,
  });
  renderPage();

  await screen.findByText("ops-email");
  await userEvent.type(screen.getByLabelText("Code"), "ops-email");
  await userEvent.type(screen.getByLabelText("Name"), "Duplicate");
  await userEvent.type(screen.getByLabelText(/Recipients/i), "a@b.c");
  await userEvent.click(screen.getByRole("button", { name: "Add channel" }));

  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
  });
}

/** Decision 5: an unconfigured transport is visible where channels are managed. */
export async function showsTheReadinessWarning(): Promise<void> {
  stubApi();
  vi.spyOn(api, "fetchNotificationReadiness").mockResolvedValue({
    items: [
      {
        kind: "email",
        configured: false,
        detail: "SMTP_HOST is not set, so email notifications are recorded as skipped.",
      },
      { kind: "webhook", configured: true, detail: "Webhooks send over https." },
    ],
  });
  renderPage();

  await waitFor(() => {
    expect(screen.getByText(/SMTP_HOST is not set/i)).toBeInTheDocument();
  });
}
