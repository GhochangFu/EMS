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
import { ReportScheduleWizard, SCHEDULE_CHANNEL_SENTENCE } from "./report-schedule-wizard";

/**
 * `F4.280` (ADR 0099 decision 6, Amendment 8) — the schedule form as the
 * `ReportScheduleWizard` stepper: Schedule → Locations → Delivery → Review. The
 * `F3.5b` form's claims, ported to the steps (ADR 0071 R-12, R-18; Q-6).
 *
 * Every row waits on what the **data** produces (an option the fetched list
 * renders), never on a heading, which renders before any query settles. One
 * claim per row. Vitest entry point: the sibling `.test.tsx` (ADR 0014, ADR
 * 0042 decision 2).
 */

const ESKOM_ID = "5c2c1b0e-2222-4a5b-8c4d-000000000010";
const ESKOM = { id: ESKOM_ID, code: "ESKOM", name: "Eskom SMOC", active: true, currency: "ZAR", timezone: "UTC", meta: null, createdAt: "2026-01-01T00:00:00.000Z" };

const WESTERN_CAPE: AdminLocationDto = {
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

const GAUTENG: AdminLocationDto = { ...WESTERN_CAPE, id: "7d3e2f1a-3333-4a5b-8c4d-000000000022", code: "GP", slug: "gauteng", name: "Gauteng", timezone: null };

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
  kind: "webhook",
  config: { url: "https://hooks.example.test/x" },
};

const FIRST: ReportScheduleDto = {
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

const user = (role: AuthUser["role"]): AuthUser => ({ id: "9b1d2c3e-0000-4a5b-8c4d-000000000001", email: "someone@bms.local", displayName: "Someone", role });

function renderWizard(role: AuthUser["role"], schedule: ReportScheduleDto | null = null) {
  const locations = vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [WESTERN_CAPE, GAUTENG] });
  vi.spyOn(notificationsApi, "fetchNotificationChannels").mockResolvedValue({ items: [EMAIL_CHANNEL, WEBHOOK_CHANNEL] });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [ESKOM] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportScheduleWizard user={user(role)} schedule={schedule} onCancel={() => undefined} onDone={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { locations };
}

const next = () => userEvent.click(screen.getByRole("button", { name: "Next" }));
const back = () => userEvent.click(screen.getByRole("button", { name: "Back" }));
const submit = () => userEvent.click(screen.getByRole("button", { name: "Submit" }));

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

/** Names the schedule and moves to the Locations step. */
async function toScope(name = "Site digest"): Promise<void> {
  await userEvent.type(screen.getByLabelText("Name"), name);
  await next();
}

/** As `admin` the organization select renders, listing the fetched organization. */
export async function anAdminSeesTheOrganizationSelect(): Promise<void> {
  renderWizard("admin");
  const select = await screen.findByLabelText("Schedule organization");
  expect(await within(select).findByRole("option", { name: "ESKOM · Eskom SMOC" })).toBeInTheDocument();
}

/** Choosing ESKOM loads its active locations. */
export async function choosingAnOrganizationLoadsItsLocations(): Promise<void> {
  const { locations } = renderWizard("admin");
  await chooseEskom();
  await waitFor(() => expect(locations).toHaveBeenCalledWith("true", ESKOM_ID));
}

/** With no location selected the timezone reads `Asia/Kolkata`. */
export async function theTimezoneDefaultsToKolkataWithNoLocationSelected(): Promise<void> {
  renderWizard("admin");
  await chooseEskom();
  expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Kolkata");
}

/** Selecting Western Cape flips the untouched timezone to its zone. */
export async function selectingALocationDefaultsTheTimezoneToItsZone(): Promise<void> {
  renderWizard("admin");
  await chooseEskom();
  await toScope();
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await back();
  await waitFor(() => expect(screen.getByLabelText("Timezone")).toHaveValue("Africa/Johannesburg"));
}

/** A zone the user typed survives a later location change. */
export async function aTypedTimezoneSurvivesALocationChange(): Promise<void> {
  renderWizard("admin");
  await chooseEskom();
  const timezone = screen.getByLabelText("Timezone");
  await userEvent.clear(timezone);
  await userEvent.type(timezone, "Europe/London");
  await toScope();
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await back();
  await waitFor(() => expect(screen.getByLabelText("Timezone")).toHaveValue("Europe/London"));
}

/** Submit calls `createReportSchedule` with the body asserted by key. */
export async function anAdminSaveSendsTheBodyByKey(): Promise<void> {
  const create = vi.spyOn(reportsApi, "createReportSchedule").mockResolvedValue(FIRST);
  renderWizard("admin");
  await chooseEskom();
  await userEvent.selectOptions(screen.getByLabelText("Cadence"), "weekly");
  await userEvent.clear(screen.getByLabelText("Run time"));
  await userEvent.type(screen.getByLabelText("Run time"), "07:00");
  await userEvent.click(screen.getByLabelText("XLSX"));
  await toScope("Weekly energy digest");
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await next();
  const channel = screen.getByLabelText("Email channel");
  await within(channel).findByRole("option", { name: EMAIL_CHANNEL.code });
  await userEvent.selectOptions(channel, EMAIL_CHANNEL.id);
  await next();
  await submit();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0]?.[0]).toMatchObject({
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

/** D5: the Review card's sentence says the schedule is emailed, and names no address. */
export async function theReviewSummaryNamesNoAddress(): Promise<void> {
  renderWizard("organization_admin");
  await toScope();
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await next();
  const channel = screen.getByLabelText("Email channel");
  await within(channel).findByRole("option", { name: EMAIL_CHANNEL.code });
  await userEvent.selectOptions(channel, EMAIL_CHANNEL.id);
  await next();
  const sentence = await screen.findByText(/emailed to a channel on every run/);
  expect(sentence.textContent).not.toMatch(/@/);
}

/** A webhook channel is not an option; the email one is the positive control. */
export async function aWebhookChannelIsNotAnOption(): Promise<void> {
  renderWizard("admin");
  await chooseEskom();
  await toScope();
  await next();
  const channel = screen.getByLabelText("Email channel");
  await within(channel).findByRole("option", { name: EMAIL_CHANNEL.code });
  expect(within(channel).queryByRole("option", { name: WEBHOOK_CHANNEL.code })).not.toBeInTheDocument();
}

/** A `location_admin` has no organization select; the Name input is the control. */
export async function aLocationAdminHasNoOrganizationSelect(): Promise<void> {
  renderWizard("location_admin");
  await screen.findByLabelText("Name");
  expect(screen.queryByLabelText("Schedule organization")).not.toBeInTheDocument();
}

/** A `location_admin` has no "Whole organization" option; Western Cape is the control. */
export async function aLocationAdminHasNoWholeOrganizationOption(): Promise<void> {
  renderWizard("location_admin");
  await toScope();
  const select = await locationsSelect();
  expect(within(select).queryByRole("option", { name: "Whole organization" })).not.toBeInTheDocument();
}

/** The global admin does have the "Whole organization" option — the positive control. */
export async function anAdminHasTheWholeOrganizationOption(): Promise<void> {
  renderWizard("admin");
  await chooseEskom();
  await toScope();
  const select = await locationsSelect();
  expect(within(select).getByRole("option", { name: "Whole organization" })).toBeInTheDocument();
}

/** Q-6: a `location_admin` reads the sentence on the Delivery step instead of the select. */
export async function aLocationAdminReadsTheChannelSentenceInsteadOfTheSelect(): Promise<void> {
  renderWizard("location_admin");
  await toScope();
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await next();
  expect(await screen.findByText(SCHEDULE_CHANNEL_SENTENCE)).toBeInTheDocument();
}

/** An `organization_admin` gets the channel select, resolved through the fetched locations' organization. */
export async function anOrganizationAdminGetsTheChannelSelect(): Promise<void> {
  renderWizard("organization_admin");
  await toScope();
  await locationsSelect();
  await next();
  const channel = await screen.findByLabelText("Email channel");
  expect(await within(channel).findByRole("option", { name: EMAIL_CHANNEL.code })).toBeInTheDocument();
}

/** A `location_admin`'s create body carries no `organizationId` key at all. */
export async function aLocationAdminCreateBodyHasNoOrganizationIdKey(): Promise<void> {
  const create = vi.spyOn(reportsApi, "createReportSchedule").mockResolvedValue(FIRST);
  renderWizard("location_admin");
  await toScope();
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await next();
  await next();
  await submit();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0]?.[0]).not.toHaveProperty("organizationId");
}

/** A `location_admin` with no location selected reads "Choose at least one location". */
export async function aLocationAdminWithNoLocationSelectedIsBlockedOnTheLocation(): Promise<void> {
  renderWizard("location_admin");
  await toScope();
  await locationsSelect();
  expect(screen.getByText("Choose at least one location")).toBeInTheDocument();
}

/** The Locations picker lists the tree depth-first. */
export async function theLocationsPickerListsTheTree(): Promise<void> {
  renderWizard("admin");
  vi.mocked(locationsApi.fetchAdminLocations).mockResolvedValue({
    items: [
      { ...WESTERN_CAPE, id: "7d3e2f1a-3333-4a5b-8c4d-000000000029", code: "CBD", slug: "cbd", name: "Cape Town CBD", parentId: WESTERN_CAPE.id },
      GAUTENG,
      WESTERN_CAPE,
    ],
  });
  await chooseEskom();
  await toScope();
  const select = await screen.findByLabelText("Locations");
  await within(select).findByRole("option", { name: "— Cape Town CBD" });
  const names = within(select)
    .getAllByRole("option")
    .map((option) => option.textContent)
    .filter((name) => name !== "Whole organization");
  expect(names).toEqual(["Gauteng", "Western Cape", "— Cape Town CBD"]);
}

/** Edit pre-fills the wizard with the row's name. */
export async function editPrefillsTheName(): Promise<void> {
  renderWizard("admin", FIRST);
  expect(await screen.findByLabelText("Name")).toHaveValue(FIRST.name);
}

/** A rename alone PATCHes `{ name }` — only the changed key. */
export async function updateSendsOnlyTheChangedKey(): Promise<void> {
  const update = vi.spyOn(reportsApi, "updateReportSchedule").mockResolvedValue(FIRST);
  renderWizard("admin", FIRST);
  const name = await screen.findByLabelText("Name");
  await userEvent.clear(name);
  await userEvent.type(name, "Renamed digest");
  await next();
  await next();
  await next();
  await submit();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect([update.mock.calls[0]?.[0], update.mock.calls[0]?.[1]]).toEqual([FIRST.id, { name: "Renamed digest" }]);
}

/** An unchanged edit says "Nothing changed yet" on the Review card and sends nothing. */
export async function anUnchangedEditSaysNothingChanged(): Promise<void> {
  const update = vi.spyOn(reportsApi, "updateReportSchedule").mockResolvedValue(FIRST);
  renderWizard("admin", FIRST);
  await screen.findByLabelText("Name");
  await next();
  await next();
  await next();
  await submit();
  expect([await screen.findByText("Nothing changed yet"), update.mock.calls.length]).toEqual([expect.anything(), 0]);
}

/** A refused create renders the API's own sentence verbatim. */
export async function aRefusedCreateRendersTheApiSentence(): Promise<void> {
  vi.spyOn(reportsApi, "createReportSchedule").mockRejectedValue(new ApiError("Report schedule cap reached for this organization", 409));
  renderWizard("location_admin");
  await toScope();
  await userEvent.selectOptions(await locationsSelect(), WESTERN_CAPE.id);
  await next();
  await next();
  await submit();
  expect(await screen.findByText("Report schedule cap reached for this organization")).toBeInTheDocument();
}
