import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminLocationDto, NotificationChannelDto, ReportScheduleDto } from "@bms/shared";

import * as locationsApi from "../api/admin/locations";
import * as organizationsApi from "../api/admin/organizations";
import * as notificationsApi from "../api/notifications";
import * as reportsApi from "../api/reports";
import type { AuthUser } from "../stores/auth-store";
import { ReportSchedules } from "./report-schedules";

/**
 * `F3.5b` Unit 13 — the Schedules section (ADR 0071 R-12, R-18; Q-6).
 *
 * `F4.280` (ADR 0099 decision 6): the form is the `ReportScheduleWizard`
 * stepper; its claims moved to `report-schedule-wizard.spec.tsx`. This file
 * keeps the list, Edit and Delete, and the two ways the wizard opens.
 *
 * Assertions live here; `report-schedules.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * Every row waits on what the **data** produces (an option the fetched list
 * renders, a row's name, a button's pending label), never on the heading or
 * the form, which render before any query settles. One claim per row: `expect`
 * throws, so only the first assertion in a row can redden.
 */

export const ESKOM_ID = "5c2c1b0e-2222-4a5b-8c4d-000000000010";
export const CHANNEL_SENTENCE = "Email delivery needs an organization administrator";

const ESKOM = {
  id: ESKOM_ID,
  code: "ESKOM",
  name: "Eskom SMOC",
  active: true,
  currency: "ZAR",
  timezone: "UTC",
  meta: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function userWithRole(role: AuthUser["role"]): AuthUser {
  return {
    id: "9b1d2c3e-0000-4a5b-8c4d-000000000001",
    email: "someone@bms.local",
    displayName: "Someone",
    role,
  };
}

export const WESTERN_CAPE: AdminLocationDto = {
  id: "7d3e2f1a-3333-4a5b-8c4d-000000000021",
  parentId: null,
  organizationId: ESKOM_ID,
  organizationCode: "ESKOM",
  organizationName: "Eskom SMOC",
  code: "WC",
  slug: "western-cape",
  name: "Western Cape",
  type: "rsmoc",
  typeLabel: "RSMOC",
  province: "Western Cape",
  capital: "Cape Town",
  timezone: "Africa/Johannesburg",
  latitude: -33.9,
  longitude: 18.4,
  active: true,
  meta: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const GAUTENG: AdminLocationDto = {
  ...WESTERN_CAPE,
  id: "7d3e2f1a-3333-4a5b-8c4d-000000000022",
  code: "GP",
  slug: "gauteng",
  name: "Gauteng",
  province: "Gauteng",
  capital: "Johannesburg",
  timezone: null,
};

const EMAIL_CHANNEL: NotificationChannelDto = {
  id: "8e4f3a2b-4444-4a5b-8c4d-000000000031",
  organizationId: ESKOM_ID,
  code: "ops-email",
  name: "Operations email",
  kind: "email",
  config: { to: ["ops@example.test"] },
  enabled: true,
  hasSecret: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const WEBHOOK_CHANNEL: NotificationChannelDto = {
  ...EMAIL_CHANNEL,
  id: "8e4f3a2b-4444-4a5b-8c4d-000000000032",
  code: "ops-webhook",
  name: "Operations webhook",
  kind: "webhook",
  config: { url: "https://hooks.example.test/x" },
};

export const FIRST: ReportScheduleDto = {
  id: "0f0a4a1e-5555-4a5b-8c4d-000000000041",
  organizationId: ESKOM_ID,
  name: "Weekly energy digest",
  templateId: "energy_consumption",
  formats: ["pdf", "xlsx"],
  cadence: "weekly",
  runAtLocal: "07:00",
  timezone: "Africa/Johannesburg",
  locationIds: [WESTERN_CAPE.id],
  channelId: EMAIL_CHANNEL.id,
  enabled: true,
  nextRunAt: "2026-09-28T05:00:00.000Z",
  lastRunAt: null,
  createdBy: null,
  createdAt: "2026-09-21T10:00:00.000Z",
  updatedAt: "2026-09-21T10:00:00.000Z",
};

export const SECOND: ReportScheduleDto = {
  ...FIRST,
  id: "0f0a4a1e-5555-4a5b-8c4d-000000000042",
  name: "Daily whole-organization run",
  formats: ["pdf"],
  cadence: "daily",
  runAtLocal: "06:30",
  timezone: "Asia/Kolkata",
  locationIds: [],
  channelId: null,
  enabled: false,
  nextRunAt: "2026-09-23T01:00:00.000Z",
};

function renderSchedules(role: AuthUser["role"], rows: ReportScheduleDto[] = []) {
  const schedules = vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue(rows);
  const locations = vi
    .spyOn(locationsApi, "fetchAdminLocations")
    .mockResolvedValue({ items: [WESTERN_CAPE, GAUTENG] });
  vi.spyOn(notificationsApi, "fetchNotificationChannels").mockResolvedValue({
    items: [EMAIL_CHANNEL, WEBHOOK_CHANNEL],
  });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [ESKOM] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportSchedules user={userWithRole(role)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { schedules, locations };
}

/** The `<tr>` holding `name`, so a cell assertion cannot pass on the other row. */
async function rowFor(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest("tr");
  expect(row, `no table row holds ${JSON.stringify(name)}`).toBeTruthy();
  return row as HTMLElement;
}

/** Two DTOs render two rows, with the whole-organization and channel cells. */
export async function twoSchedulesRenderTwoRows(): Promise<void> {
  renderSchedules("admin", [FIRST, SECOND]);

  const first = await rowFor(FIRST.name);
  const second = await rowFor(SECOND.name);
  expect(within(second).getByText("Whole organization")).toBeInTheDocument();
  expect(within(first).getByText("1 location")).toBeInTheDocument();
  expect(await within(first).findByText(EMAIL_CHANNEL.code)).toBeInTheDocument();
  expect(within(second).getByText("—")).toBeInTheDocument();
}

/** Edit opens the edit wizard pre-filled with the row's name. */
export async function editPrefillsTheName(): Promise<void> {
  renderSchedules("admin", [FIRST, SECOND]);
  const first = await rowFor(FIRST.name);

  await userEvent.click(within(first).getByRole("button", { name: "Edit" }));

  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(FIRST.name));
}

/** Delete calls `deleteReportSchedule(id)` once and the list refetches (delta 1). */
export async function deleteCallsTheApiOnceAndRefetches(): Promise<void> {
  const { schedules } = renderSchedules("admin", [FIRST, SECOND]);
  const remove = vi.spyOn(reportsApi, "deleteReportSchedule").mockResolvedValue();
  const second = await rowFor(SECOND.name);
  const listCallsBefore = schedules.mock.calls.length;

  await userEvent.click(within(second).getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  expect(remove.mock.calls[0]?.[0]).toBe(SECOND.id);
  await waitFor(() => expect(schedules.mock.calls.length).toBe(listCallsBefore + 1));
}

/**
 * Two deletes held open: the first row's button still reads "Deleting…"
 * after the second starts — append, never replace (the F3.4 sweep C2 shape).
 */
export async function twoDeletesInFlightKeepBothButtonsPending(): Promise<void> {
  renderSchedules("admin", [FIRST, SECOND]);
  vi.spyOn(reportsApi, "deleteReportSchedule").mockReturnValue(new Promise<void>(() => {}));
  const first = await rowFor(FIRST.name);
  const second = await rowFor(SECOND.name);
  await userEvent.click(within(first).getByRole("button", { name: "Delete" }));
  expect(await within(first).findByRole("button", { name: "Deleting…" })).toBeDisabled();

  await userEvent.click(within(second).getByRole("button", { name: "Delete" }));

  expect(await within(second).findByRole("button", { name: "Deleting…" })).toBeDisabled();
  expect(within(first).getByRole("button", { name: "Deleting…" })).toBeDisabled();
}

/** F4.164 U4: a pending Delete carries `aria-busy="true"`. */
export async function aPendingDeleteHasAriaBusyTrue(): Promise<void> {
  renderSchedules("admin", [FIRST, SECOND]);
  vi.spyOn(reportsApi, "deleteReportSchedule").mockReturnValue(new Promise<void>(() => {}));
  const first = await rowFor(FIRST.name);
  await userEvent.click(within(first).getByRole("button", { name: "Delete" }));

  const busy = await within(first).findByRole("button", { name: "Deleting…" });
  expect(busy).toHaveAttribute("aria-busy", "true");
}

/** F4.164 U4: another row's idle Delete carries `aria-busy="false"`. */
export async function anIdleDeleteHasAriaBusyFalse(): Promise<void> {
  renderSchedules("admin", [FIRST, SECOND]);
  vi.spyOn(reportsApi, "deleteReportSchedule").mockReturnValue(new Promise<void>(() => {}));
  const first = await rowFor(FIRST.name);
  const second = await rowFor(SECOND.name);
  await userEvent.click(within(first).getByRole("button", { name: "Delete" }));
  await within(first).findByRole("button", { name: "Deleting…" });

  const idle = within(second).getByRole("button", { name: "Delete" });
  expect(idle).toHaveAttribute("aria-busy", "false");
}

/** While a row's delete is open, that row's Edit is disabled too; the other row's Edit stays enabled. */
export async function aDeleteInFlightDisablesThatRowsEdit(): Promise<void> {
  renderSchedules("admin", [FIRST, SECOND]);
  vi.spyOn(reportsApi, "deleteReportSchedule").mockReturnValue(new Promise<void>(() => {}));
  const first = await rowFor(FIRST.name);
  const second = await rowFor(SECOND.name);

  await userEvent.click(within(first).getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(within(first).getByRole("button", { name: "Edit" })).toBeDisabled());
  expect(within(second).getByRole("button", { name: "Edit" })).toBeEnabled();
}

/**
 * `F4.168` U5, B8 — Edit is a declared bystander of the row's own delete: it stays
 * disabled and named "Edit", and carries no `aria-busy` (it is not itself busy).
 */
export async function aDeleteInFlightEditCarriesNoAriaBusy(): Promise<void> {
  renderSchedules("admin", [FIRST, SECOND]);
  vi.spyOn(reportsApi, "deleteReportSchedule").mockReturnValue(new Promise<void>(() => {}));
  const first = await rowFor(FIRST.name);

  await userEvent.click(within(first).getByRole("button", { name: "Delete" }));

  const edit = await waitFor(() => {
    const button = within(first).getByRole("button", { name: "Edit" });
    expect(button).toBeDisabled();
    return button;
  });
  expect(edit).not.toHaveAttribute("aria-busy");
}
/** `F4.280`: New schedule opens the create wizard. */
export async function newScheduleOpensTheCreateWizard(): Promise<void> {
  renderSchedules("admin", [FIRST]);
  await rowFor(FIRST.name);

  await userEvent.click(screen.getByRole("button", { name: "New schedule" }));

  expect(await screen.findByRole("dialog", { name: "Create a report schedule" })).toBeInTheDocument();
}
