import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { NotificationDeliveryDto } from "@bms/shared";

import * as api from "../../api/notifications";
import { NotificationReadinessBanner } from "../../components/notification-readiness-banner";
import type { AuthUser } from "../../stores/auth-store";
import { NotificationDeliveriesPage } from "./notification-deliveries-page";

/**
 * `F3.8` U9 — the deliveries view and the readiness banner (ADR 0042).
 *
 * The two claims worth a render: the skips are visible without asking for
 * them, and the banner appears when a transport is not configured.
 */

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

function delivery(overrides: Partial<NotificationDeliveryDto>): NotificationDeliveryDto {
  return {
    id: "d1",
    ruleId: "r1",
    ruleCode: "UPS-BATT-TEMP",
    alarmId: "a1",
    channelId: "c1",
    channelCode: "ops-email",
    status: "sent",
    attemptedAt: new Date("2026-08-23T10:00:00Z").toISOString(),
    error: null,
    ...overrides,
  };
}

const ALL_FIVE: NotificationDeliveryDto[] = [
  delivery({ id: "d1", status: "sent" }),
  delivery({ id: "d2", status: "failed", error: "webhook responded 500" }),
  delivery({
    id: "d3",
    status: "skipped_unconfigured",
    channelCode: "ops-webhook",
    error: "SMTP_HOST is not set",
  }),
  delivery({ id: "d4", status: "skipped_deduped" }),
  delivery({ id: "d5", status: "skipped_rate_limited" }),
];

function renderWith(node: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Decision 10: a "sent items" list would hide the two states an operator most
 * needs. Nothing is filtered by default.
 */
export async function showsEverySkipWithoutAsking(): Promise<void> {
  vi.spyOn(api, "fetchNotificationDeliveries").mockResolvedValue({ items: ALL_FIVE });
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({ items: [] });

  renderWith(<NotificationDeliveriesPage user={user} />);

  expect(await screen.findByText("Sent")).toBeInTheDocument();
  expect(screen.getByText("Failed")).toBeInTheDocument();
  expect(screen.getByText(/Skipped — not configured/)).toBeInTheDocument();
  expect(screen.getByText(/Skipped — already open/)).toBeInTheDocument();
  expect(screen.getByText(/Skipped — rate limited/)).toBeInTheDocument();
  // The reason travels with the row: "skipped" alone does not tell an operator
  // what to change.
  expect(screen.getByText("SMTP_HOST is not set")).toBeInTheDocument();
}

/** A test send has no rule, and the column must say so rather than render blank. */
export async function labelsATestSendWithNoRule(): Promise<void> {
  vi.spyOn(api, "fetchNotificationDeliveries").mockResolvedValue({
    items: [delivery({ id: "d6", ruleId: null, ruleCode: null, alarmId: null })],
  });
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({ items: [] });

  renderWith(<NotificationDeliveriesPage user={user} />);

  expect(await screen.findByText(/— \(test\)/)).toBeInTheDocument();
}

/** An empty ledger must not look like a failed load. */
export async function explainsAnEmptyLedger(): Promise<void> {
  vi.spyOn(api, "fetchNotificationDeliveries").mockResolvedValue({ items: [] });
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({ items: [] });

  renderWith(<NotificationDeliveriesPage user={user} />);

  expect(await screen.findByText(/No delivery attempts recorded yet/)).toBeInTheDocument();
}

/** Decision 5: an unconfigured transport is visible where rules are edited. */
export async function bannerAppearsWhenATransportIsUnconfigured(): Promise<void> {
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

  renderWith(<NotificationReadinessBanner />);

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent(/not fully configured/i);
  });
  expect(screen.getByRole("status")).toHaveTextContent(/SMTP_HOST is not set/);
  // The webhook line is configured and must NOT be listed — a banner that
  // names everything says nothing.
  expect(screen.queryByText(/Webhooks send over https/)).not.toBeInTheDocument();
}

/** And it must be silent when there is nothing to say. */
export async function bannerIsSilentWhenEverythingIsConfigured(): Promise<void> {
  vi.spyOn(api, "fetchNotificationReadiness").mockResolvedValue({
    items: [
      { kind: "email", configured: true, detail: "SMTP is configured." },
      { kind: "webhook", configured: true, detail: "Webhooks send over https." },
    ],
  });

  renderWith(<NotificationReadinessBanner />);

  // Give the query a chance to resolve before asserting absence, or this would
  // pass on the loading state and prove nothing.
  await waitFor(() => {
    expect(api.fetchNotificationReadiness).toHaveBeenCalled();
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
}

/**
 * A failed readiness read must also stay silent. An absent banner has to mean
 * "nothing to say", never "the check did not run".
 */
export async function bannerIsSilentWhenTheCheckFails(): Promise<void> {
  vi.spyOn(api, "fetchNotificationReadiness").mockRejectedValue(new Error("readiness 500"));

  renderWith(<NotificationReadinessBanner />);

  await waitFor(() => {
    expect(api.fetchNotificationReadiness).toHaveBeenCalled();
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
}
