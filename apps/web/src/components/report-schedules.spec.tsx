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
import { ApiError } from "../lib/api-error";
import type { AuthUser } from "../stores/auth-store";
import { ReportSchedules } from "./report-schedules";

/**
 * `F3.5b` Unit 13 — the Schedules section (ADR 0071 R-12, R-18; Q-6).
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
  organizationId: ESKOM_ID,
  organizationCode: "ESKOM",
  organizationName: "Eskom SMOC",
  code: "WC",
  slug: "western-cape",
  name: "Western Cape",
  type: "rsmoc",
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

/** The organization select, resolved once the fetched organization is an option. */
async function chooseEskom(): Promise<void> {
  const select = await screen.findByLabelText("Schedule organization");
  await within(select).findByRole("option", { name: "ESKOM · Eskom SMOC" });
  await userEvent.selectOptions(select, ESKOM_ID);
}

/** The locations select, resolved once the fetched location is an option. */
async function locationsSelect(): Promise<HTMLElement> {
  const select = await screen.findByLabelText("Locations");
  await within(select).findByRole("option", { name: WESTERN_CAPE.name });
  return select;
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save schedule" });
}

/** As `admin` the organization select renders, listing the fetched organization. */
export async function anAdminSeesTheOrganizationSelect(): Promise<void> {
  renderSchedules("admin");

  const select = await screen.findByLabelText("Schedule organization");
  expect(await within(select).findByRole("option", { name: "ESKOM · Eskom SMOC" })).toBeInTheDocument();
}

/** Choosing ESKOM loads its active locations: `fetchAdminLocations("true", ESKOM)` (`"true"` is the active filter). */
export async function choosingAnOrganizationLoadsItsLocations(): Promise<void> {
  const { locations } = renderSchedules("admin");

  await chooseEskom();

  await waitFor(() => expect(locations).toHaveBeenCalledWith("true", ESKOM_ID));
}

/** With no location selected the timezone input reads `Asia/Kolkata`. */
export async function theTimezoneDefaultsToKolkataWithNoLocationSelected(): Promise<void> {
  renderSchedules("admin");
  await chooseEskom();
  await locationsSelect();

  expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Kolkata");
}

/** Selecting Western Cape flips the untouched timezone to its zone, `Africa/Johannesburg`. */
export async function selectingALocationDefaultsTheTimezoneToItsZone(): Promise<void> {
  renderSchedules("admin");
  await chooseEskom();

  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);

  await waitFor(() => expect(screen.getByLabelText("Timezone")).toHaveValue("Africa/Johannesburg"));
}

/** A zone the user typed survives a later location change (the `touched` flag). */
export async function aTypedTimezoneSurvivesALocationChange(): Promise<void> {
  renderSchedules("admin");
  await chooseEskom();
  const select = await locationsSelect();
  const timezone = screen.getByLabelText("Timezone");
  await userEvent.clear(timezone);
  await userEvent.type(timezone, "Europe/London");

  await userEvent.selectOptions(select, WESTERN_CAPE.id);

  await waitFor(() => expect(screen.getByLabelText("Timezone")).toHaveValue("Europe/London"));
}

/**
 * Save calls `createReportSchedule` with the body asserted **by key**: the
 * checked formats, the run time, the defaulted zone, the selected location,
 * the chosen channel and the organization the global admin named.
 */
export async function anAdminSaveSendsTheBodyByKey(): Promise<void> {
  const create = vi.spyOn(reportsApi, "createReportSchedule").mockResolvedValue(FIRST);
  renderSchedules("admin");
  await chooseEskom();
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await userEvent.type(screen.getByLabelText("Name"), "Weekly energy digest");
  await userEvent.selectOptions(screen.getByLabelText("Cadence"), "weekly");
  await userEvent.clear(screen.getByLabelText("Run time"));
  await userEvent.type(screen.getByLabelText("Run time"), "07:00");
  await userEvent.click(screen.getByLabelText("XLSX"));
  const channel = screen.getByLabelText("Email channel");
  await within(channel).findByRole("option", { name: EMAIL_CHANNEL.code });
  await userEvent.selectOptions(channel, EMAIL_CHANNEL.id);
  await waitFor(() => expect(saveButton()).toBeEnabled());

  await userEvent.click(saveButton());

  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const body = create.mock.calls[0]?.[0];
  expect(body).toMatchObject({
    name: "Weekly energy digest",
    cadence: "weekly",
    formats: ["pdf", "xlsx"],
    runAtLocal: "07:00",
    timezone: "Africa/Johannesburg",
    locationIds: [WESTERN_CAPE.id],
    channelId: EMAIL_CHANNEL.id,
    organizationId: ESKOM_ID,
    enabled: true,
  });
}

/** A webhook channel is not an option; the email one is the positive control. */
export async function aWebhookChannelIsNotAnOption(): Promise<void> {
  renderSchedules("admin");
  await chooseEskom();

  const channel = screen.getByLabelText("Email channel");
  await within(channel).findByRole("option", { name: EMAIL_CHANNEL.code });

  expect(within(channel).queryByRole("option", { name: WEBHOOK_CHANNEL.code })).not.toBeInTheDocument();
}

/** A `location_admin` has no organization select; the Locations select is the control. */
export async function aLocationAdminHasNoOrganizationSelect(): Promise<void> {
  renderSchedules("location_admin");
  await locationsSelect();

  expect(screen.queryByLabelText("Schedule organization")).not.toBeInTheDocument();
}

/** A `location_admin` has no "Whole organization" option; Western Cape is the control. */
export async function aLocationAdminHasNoWholeOrganizationOption(): Promise<void> {
  renderSchedules("location_admin");
  const select = await locationsSelect();

  expect(within(select).queryByRole("option", { name: "Whole organization" })).not.toBeInTheDocument();
}

/** The global admin does have the "Whole organization" option — the positive control for the row above. */
export async function anAdminHasTheWholeOrganizationOption(): Promise<void> {
  renderSchedules("admin");
  await chooseEskom();
  const select = await locationsSelect();

  expect(within(select).getByRole("option", { name: "Whole organization" })).toBeInTheDocument();
}

/** Q-6: a `location_admin` has no channel select and reads the sentence instead. */
export async function aLocationAdminReadsTheChannelSentenceInsteadOfTheSelect(): Promise<void> {
  renderSchedules("location_admin");
  await locationsSelect();

  expect(screen.getByText(CHANNEL_SENTENCE)).toBeInTheDocument();
  expect(screen.queryByLabelText("Email channel")).not.toBeInTheDocument();
}

/** An `organization_admin` gets the channel select, resolved through the fetched locations' organization. */
export async function anOrganizationAdminGetsTheChannelSelect(): Promise<void> {
  renderSchedules("organization_admin");
  await locationsSelect();

  const channel = await screen.findByLabelText("Email channel");
  expect(await within(channel).findByRole("option", { name: EMAIL_CHANNEL.code })).toBeInTheDocument();
}

/** A `location_admin`'s create body carries **no** `organizationId` key at all. */
export async function aLocationAdminCreateBodyHasNoOrganizationIdKey(): Promise<void> {
  const create = vi.spyOn(reportsApi, "createReportSchedule").mockResolvedValue(FIRST);
  renderSchedules("location_admin");
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await userEvent.type(screen.getByLabelText("Name"), "Site digest");
  await waitFor(() => expect(saveButton()).toBeEnabled());

  await userEvent.click(saveButton());

  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0]?.[0]).not.toHaveProperty("organizationId");
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

/** Edit pre-fills the form with the row's name. */
export async function editPrefillsTheName(): Promise<void> {
  renderSchedules("admin", [FIRST, SECOND]);
  const first = await rowFor(FIRST.name);

  await userEvent.click(within(first).getByRole("button", { name: "Edit" }));

  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(FIRST.name));
}

/** Editing a row and changing nothing keeps Save disabled beside "Nothing changed yet" (no empty PATCH). */
export async function anUnchangedEditKeepsSaveDisabled(): Promise<void> {
  renderSchedules("admin", [FIRST, SECOND]);
  const first = await rowFor(FIRST.name);
  await userEvent.click(within(first).getByRole("button", { name: "Edit" }));
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(FIRST.name));

  expect(saveButton()).toBeDisabled();
  expect(screen.getByText("Nothing changed yet")).toBeInTheDocument();
}

/** A rename alone PATCHes `{ name }` — only the changed key. */
export async function updateSendsOnlyTheChangedKey(): Promise<void> {
  const update = vi.spyOn(reportsApi, "updateReportSchedule").mockResolvedValue(FIRST);
  renderSchedules("admin", [FIRST, SECOND]);
  const first = await rowFor(FIRST.name);
  await userEvent.click(within(first).getByRole("button", { name: "Edit" }));
  const name = screen.getByLabelText("Name");
  await waitFor(() => expect(name).toHaveValue(FIRST.name));
  await userEvent.clear(name);
  await userEvent.type(name, "Renamed digest");
  await waitFor(() => expect(saveButton()).toBeEnabled());

  await userEvent.click(saveButton());

  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]?.[0]).toBe(FIRST.id);
  expect(Object.keys(update.mock.calls[0]?.[1] ?? {})).toEqual(["name"]);
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

/** A refused create renders the API's own sentence verbatim. */
export async function aRefusedCreateRendersTheApiSentence(): Promise<void> {
  vi.spyOn(reportsApi, "createReportSchedule").mockRejectedValue(
    new ApiError("Report schedule cap reached for this organization", 409),
  );
  renderSchedules("location_admin");
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await userEvent.type(screen.getByLabelText("Name"), "Site digest");
  await waitFor(() => expect(saveButton()).toBeEnabled());

  await userEvent.click(saveButton());

  expect(await screen.findByText("Report schedule cap reached for this organization")).toBeInTheDocument();
}

/** Save stays disabled beside the blocked sentence until a name is entered. */
export async function saveIsDisabledBesideTheBlockedSentence(): Promise<void> {
  renderSchedules("location_admin");
  await locationsSelect();

  expect(saveButton()).toBeDisabled();
  expect(screen.getByText("Enter a name")).toBeInTheDocument();
}
