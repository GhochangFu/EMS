import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { NotificationDeliveryDto } from "@bms/shared";

import * as orgApi from "../../api/admin/organizations";
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

/** `E7.1d` — two real organizations, so the ledger's new column has names. */
const IONX = "aaaaaaaa-0000-0000-0000-000000000001";
const PHEWB = "aaaaaaaa-0000-0000-0000-000000000002";

const ORGANIZATIONS = [
  {
    id: IONX,
    code: "IONX",
    name: "Ion Exchange",
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
  },
  {
    id: PHEWB,
    code: "PHEWB",
    name: "PHE West Bengal",
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
  },
];

function stubOrganizations(): void {
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({ items: ORGANIZATIONS });
}

function delivery(overrides: Partial<NotificationDeliveryDto>): NotificationDeliveryDto {
  return {
    id: "d1",
    organizationId: IONX,
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

/**
 * `E7.1d` — the ledger names the tenant (ADR 0043 Consequences).
 *
 * An `admin`'s `writableOrganizationIds` is unrestricted, so the rows here
 * span every tenant. Without the column a failed delivery names a channel code
 * and no owner, and two organizations running a channel called `ops-email`
 * produce a ledger nobody can read.
 */
export async function namesTheOrganizationOfEveryAttempt(): Promise<void> {
  stubOrganizations();
  vi.spyOn(api, "fetchNotificationDeliveries").mockResolvedValue({
    items: [
      delivery({ id: "d1", organizationId: IONX }),
      delivery({ id: "d2", organizationId: PHEWB, status: "failed", error: "webhook 500" }),
    ],
  });
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({ items: [] });

  renderWith(<NotificationDeliveriesPage user={user} />);

  expect(await screen.findByRole("columnheader", { name: "Organization" })).toBeInTheDocument();
  // Names, never uuids. `organizationId` is NOT NULL on this DTO since
  // migration 0048, so there is no fleet-wide case to render here.
  expect(await screen.findByRole("cell", { name: "Ion Exchange" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "PHE West Bengal" })).toBeInTheDocument();
  expect(screen.queryByText(IONX)).not.toBeInTheDocument();
}

/** `E7.1d` — the organization filter narrows the ledger to one tenant. */
export async function filtersTheLedgerByOrganization(): Promise<void> {
  stubOrganizations();
  vi.spyOn(api, "fetchNotificationDeliveries").mockResolvedValue({
    items: [
      delivery({ id: "d1", organizationId: IONX, channelCode: "ionx-email" }),
      delivery({ id: "d2", organizationId: PHEWB, channelCode: "phe-email" }),
    ],
  });
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({ items: [] });

  renderWith(<NotificationDeliveriesPage user={user} />);

  // Decision 10 stands: nothing is filtered until the operator asks.
  expect(await screen.findByText("ionx-email")).toBeInTheDocument();
  expect(screen.getByText("phe-email")).toBeInTheDocument();

  const organizationFilter = await screen.findByLabelText("Organization");
  await waitFor(() => {
    expect(screen.getByRole("option", { name: "PHE West Bengal" })).toBeInTheDocument();
  });
  await userEvent.selectOptions(organizationFilter, PHEWB);

  await waitFor(() => {
    expect(screen.queryByText("ionx-email")).not.toBeInTheDocument();
  });
  expect(screen.getByText("phe-email")).toBeInTheDocument();
}

/**
 * `E7.1d` — the filter offers only organizations the ledger actually contains.
 *
 * Listing every organization would offer choices that can only ever empty the
 * table, which reads as a broken filter rather than as an empty tenant.
 */
export async function offersOnlyOrganizationsPresentInTheLedger(): Promise<void> {
  stubOrganizations();
  vi.spyOn(api, "fetchNotificationDeliveries").mockResolvedValue({
    items: [delivery({ id: "d1", organizationId: IONX })],
  });
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({ items: [] });

  renderWith(<NotificationDeliveriesPage user={user} />);

  await screen.findByRole("cell", { name: "Ion Exchange" });
  expect(screen.getByRole("option", { name: "All organizations" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Ion Exchange" })).toBeInTheDocument();
  // PHEWB is a real organization with no delivery in this window.
  expect(screen.queryByRole("option", { name: "PHE West Bengal" })).not.toBeInTheDocument();
}
