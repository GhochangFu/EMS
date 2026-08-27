import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { NotificationChannelDto } from "@bms/shared";

import * as orgApi from "../../api/admin/organizations";
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

/**
 * `E7.1d` made org-scoped the normal case: a fleet-wide channel cannot be
 * send-tested at all, so the fixtures a Send test assertion uses must carry an
 * organization. The fleet-wide cases below opt in with `organizationId: null`.
 */
const emailChannel: NotificationChannelDto = {
  id: "11111111-1111-1111-1111-111111111111",
  organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
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
  organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
  code: "ops-webhook",
  name: "Operations webhook",
  kind: "webhook",
  config: { url: "https://grafana/api/hook" },
  enabled: true,
  hasSecret: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

/** `E7.1d`. Two active organizations and one deactivated one. */
const ORGANIZATIONS = [
  {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    code: "IONX",
    name: "Ion Exchange",
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000002",
    code: "PHEWB",
    name: "PHE West Bengal",
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
  },
];

const orgAdmin: AuthUser = {
  id: "u2",
  email: "phe-admin@bms.local",
  displayName: "PHE Organization Admin",
  role: "organization_admin",
} as unknown as AuthUser;

function renderPage(as: AuthUser = user): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationChannelsPage user={as} />
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
  // `E7.1d`: the screen resolves organization names for its new column.
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({ items: ORGANIZATIONS });
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

/**
 * `E7.1d` — the organization column (ADR 0043 Consequences).
 *
 * An `admin` reads every tenant's channels here. Without this column a failed
 * channel names a code and no owner, and a fleet-wide row is indistinguishable
 * from one belonging to whichever organization the reader has in mind.
 */
export async function namesTheOrganizationOfEveryChannel(): Promise<void> {
  stubApi();
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({
    items: [
      { ...emailChannel, organizationId: null },
      { ...webhookChannel, organizationId: ORGANIZATIONS[1]!.id },
    ],
  });
  renderPage();

  await screen.findByText("ops-email");
  expect(screen.getByRole("columnheader", { name: "Organization" })).toBeInTheDocument();
  // The name, not the uuid — a uuid names nothing to an operator.
  expect(await screen.findByRole("cell", { name: "PHE West Bengal" })).toBeInTheDocument();
  // `organizationId: null` is fleet-wide, a legitimate ongoing state.
  expect(screen.getByRole("cell", { name: "Fleet-wide" })).toBeInTheDocument();
  expect(screen.queryByText(ORGANIZATIONS[1]!.id)).not.toBeInTheDocument();
}

/**
 * `E7.1d` — Send test is refused on a fleet-wide channel, before the click.
 *
 * `NotificationsService.sendTest` answers 400 there. A live button would put
 * that refusal after the operator has already assumed a message went out, so
 * the control is disabled and carries the reason.
 */
export async function refusesSendTestOnAFleetWideChannelWithTheReason(): Promise<void> {
  const sendTest = vi.fn();
  stubApi({ testNotificationChannel: sendTest as unknown as typeof api.testNotificationChannel });
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({
    items: [
      { ...emailChannel, organizationId: null },
      { ...webhookChannel, organizationId: ORGANIZATIONS[0]!.id },
    ],
  });
  renderPage();

  await screen.findByText("ops-email");
  const buttons = screen.getAllByRole("button", { name: "Send test" });
  // Row 0 is the fleet-wide channel; row 1 is org-scoped and stays live.
  await waitFor(() => {
    expect(buttons[0]).toBeDisabled();
  });
  expect(buttons[1]).toBeEnabled();

  // The reason is on the screen, not only in a title attribute — a greyed-out
  // control that says nothing is the same dead end as a silent failure.
  expect(screen.getByText(/no organization to attribute a delivery to/i)).toBeInTheDocument();

  await userEvent.click(buttons[0] as HTMLElement);
  expect(sendTest).not.toHaveBeenCalled();
}

/**
 * `E7.1d` — an `admin` chooses the organization, and the choice reaches the API.
 *
 * This is the whole point of the item: before it, every channel the UI could
 * create was fleet-wide, and a fleet-wide channel cannot be tested at all.
 */
export async function anAdminCreatesAnOrgScopedChannel(): Promise<void> {
  const create = vi
    .fn()
    .mockResolvedValue({ ...emailChannel, organizationId: ORGANIZATIONS[0]!.id });
  stubApi({ createNotificationChannel: create as unknown as typeof api.createNotificationChannel });
  renderPage();

  await screen.findByText("ops-email");
  const organizationSelect = await screen.findByLabelText("Organization");
  // Fleet-wide is offered to an `admin` and is the default, which is what an
  // omitted `organizationId` means to `resolveCreateTargetOrg`.
  expect(organizationSelect).toHaveValue("");
  expect(organizationSelect).toBeEnabled();

  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Ion Exchange" })).toBeInTheDocument();
  });
  await userEvent.selectOptions(organizationSelect, ORGANIZATIONS[0]!.id);
  await userEvent.type(screen.getByLabelText("Code"), "ionx-ops");
  await userEvent.type(screen.getByLabelText("Name"), "Ion Exchange ops");
  await userEvent.type(screen.getByLabelText(/Recipients/i), "ops@ionexchange.test");
  await userEvent.click(screen.getByRole("button", { name: "Add channel" }));

  await waitFor(() => {
    expect(create).toHaveBeenCalledTimes(1);
  });
  expect(create.mock.calls[0]![0]).toMatchObject({
    code: "ionx-ops",
    organizationId: ORGANIZATIONS[0]!.id,
  });
}

/** `E7.1d` — a fleet-wide choice omits the field rather than sending `""`. */
export async function anAdminCreatingFleetWideOmitsTheOrganization(): Promise<void> {
  const create = vi.fn().mockResolvedValue(emailChannel);
  stubApi({ createNotificationChannel: create as unknown as typeof api.createNotificationChannel });
  renderPage();

  await screen.findByText("ops-email");
  await userEvent.type(screen.getByLabelText("Code"), "fleet-ops");
  await userEvent.type(screen.getByLabelText("Name"), "Fleet ops");
  await userEvent.type(screen.getByLabelText(/Recipients/i), "ops@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Add channel" }));

  await waitFor(() => {
    expect(create).toHaveBeenCalledTimes(1);
  });
  // `z.string().uuid().optional()` — omitted means fleet-wide, `""` is a 400.
  expect("organizationId" in (create.mock.calls[0]![0] as object)).toBe(false);
}

/**
 * `E7.1d` — an `organization_admin` with one organization sees it locked.
 *
 * Locked rather than hidden: there is no choice to make, but the operator must
 * still be able to see whose channels these are. And no fleet-wide entry —
 * `canManageNotificationChannel` refuses a null organization to this role, so
 * offering it would be an option that always answers 403.
 */
export async function anOrganizationAdminSeesItsOwnOrganizationLocked(): Promise<void> {
  const create = vi.fn().mockResolvedValue(emailChannel);
  stubApi({ createNotificationChannel: create as unknown as typeof api.createNotificationChannel });
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({
    // The API scopes this list server-side: an org admin is served its own.
    items: [ORGANIZATIONS[1]!],
  });
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({
    items: [{ ...emailChannel, organizationId: ORGANIZATIONS[1]!.id }],
  });
  renderPage(orgAdmin);

  await screen.findByText("ops-email");
  const organizationSelect = await screen.findByLabelText("Organization");
  await waitFor(() => {
    expect(organizationSelect).toBeDisabled();
  });
  expect(organizationSelect).toHaveValue(ORGANIZATIONS[1]!.id);
  expect(screen.queryByRole("option", { name: /Fleet-wide/i })).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Code"), "phe-ops");
  await userEvent.type(screen.getByLabelText("Name"), "PHE ops");
  await userEvent.type(screen.getByLabelText(/Recipients/i), "ops@phe.test");
  await userEvent.click(screen.getByRole("button", { name: "Add channel" }));

  await waitFor(() => {
    expect(create).toHaveBeenCalledTimes(1);
  });
  // The locked organization is sent explicitly. `resolveCreateTargetOrg` would
  // imply it for a single grant, but a client that says what it means does not
  // break when the operator is granted a second organization.
  expect(create.mock.calls[0]![0]).toMatchObject({
    organizationId: ORGANIZATIONS[1]!.id,
  });
}

/**
 * `E7.1d` — editing shows the organization and cannot change it.
 *
 * `updateNotificationChannelBodySchema` declares no `organizationId`, so a
 * PATCH that carried one would be stripped and answered `200` — which reads
 * from the client's side exactly like a move that worked.
 */
export async function editingShowsTheOrganizationAndCannotChangeIt(): Promise<void> {
  const update = vi
    .fn()
    .mockResolvedValue({ ...emailChannel, organizationId: ORGANIZATIONS[0]!.id });
  stubApi({ updateNotificationChannel: update as unknown as typeof api.updateNotificationChannel });
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({
    items: [{ ...emailChannel, organizationId: ORGANIZATIONS[0]!.id }],
  });
  renderPage();

  await screen.findByText("ops-email");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));

  const organizationSelect = await screen.findByLabelText("Organization");
  expect(organizationSelect).toBeDisabled();
  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Ion Exchange" })).toBeInTheDocument();
  });

  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => {
    expect(update).toHaveBeenCalledTimes(1);
  });
  const patch = update.mock.calls[0]![0].patch as object;
  expect("organizationId" in patch).toBe(false);
  expect("code" in patch).toBe(false);
}
