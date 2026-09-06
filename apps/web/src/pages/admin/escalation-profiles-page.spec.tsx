import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  EscalationProfileDto,
  NotificationChannelDto,
  VocabulariesResponse,
} from "@bms/shared";

import * as orgApi from "../../api/admin/organizations";
import * as api from "../../api/escalation";
import * as notificationsApi from "../../api/notifications";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { EscalationProfilesPage } from "./escalation-profiles-page";

/**
 * `F3.10` U11 — the escalation-profile screen, rendered (ADR 0042, ADR 0057
 * decision 11, plan ruling Q5).
 *
 * Assertions live here; `escalation-profiles-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock, because that is
 * the file Vitest collects.
 *
 * Queries go by role and text (ADR 0042 decision 5). Each step is a `fieldset`
 * with a `Step n` legend, so `within(getByRole("group", …))` addresses one rung
 * of the ladder without asserting anything about the markup around it.
 */

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "aaaaaaaa-0000-0000-0000-000000000002";

const ORGANIZATIONS = [
  {
    id: ORG_A,
    code: "IONX",
    name: "Ion Exchange",
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
  },
  {
    id: ORG_B,
    code: "PHEWB",
    name: "PHE West Bengal",
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
  },
];

const EMAIL_CHANNEL_ID = "11111111-1111-1111-1111-111111111111";
const FLEET_CHANNEL_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_ORG_CHANNEL_ID = "33333333-3333-3333-3333-333333333333";

function channel(over: Partial<NotificationChannelDto>): NotificationChannelDto {
  return {
    id: EMAIL_CHANNEL_ID,
    organizationId: ORG_A,
    code: "ops-email",
    name: "Operations email",
    kind: "email",
    config: { to: ["control.room@example.test"] },
    enabled: true,
    hasSecret: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

/** One org-scoped channel, one fleet-wide, and one belonging to another tenant. */
const CHANNELS: NotificationChannelDto[] = [
  channel({}),
  channel({
    id: FLEET_CHANNEL_ID,
    organizationId: null,
    code: "fleet-webhook",
    name: "Fleet webhook",
    kind: "webhook",
    config: { url: "https://grafana/api/hook" },
  }),
  channel({
    id: OTHER_ORG_CHANNEL_ID,
    organizationId: ORG_B,
    code: "phe-email",
    name: "PHE email",
  }),
];

const AFTER_HOURS_ID = "cccccccc-0000-0000-0000-000000000001";
const QUIET_HOURS_ID = "cccccccc-0000-0000-0000-000000000002";
const PHE_LADDER_ID = "cccccccc-0000-0000-0000-000000000003";

const afterHours: EscalationProfileDto = {
  id: AFTER_HOURS_ID,
  organizationId: ORG_A,
  code: "after-hours",
  name: "After hours",
  steps: [
    { stepNo: 1, afterMinutes: 15, channelIds: [EMAIL_CHANNEL_ID] },
    { stepNo: 2, afterMinutes: 60, channelIds: [FLEET_CHANNEL_ID] },
  ],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

/** Ruling Q4: a profile with no ladder is legal — created first, filled after. */
const quietHours: EscalationProfileDto = {
  ...afterHours,
  id: QUIET_HOURS_ID,
  code: "quiet-hours",
  name: "Quiet hours",
  steps: [],
};

/** Another tenant's profile — only an `admin` ever sees this row. */
const pheLadder: EscalationProfileDto = {
  ...afterHours,
  id: PHE_LADDER_ID,
  organizationId: ORG_B,
  code: "phe-ladder",
  name: "PHE ladder",
  steps: [],
};

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [
    { code: "warning", label: "Warning", tone: "warning", rank: 10, active: true },
    { code: "critical", label: "Critical", tone: "critical", rank: 20, active: true },
    // Retired: the map must offer no control for it — a severity nothing can
    // raise is a row an operator would configure and never see fire.
    { code: "legacy", label: "Legacy", tone: "info", rank: 5, active: false },
  ],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
} as unknown as VocabulariesResponse;

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const orgAdmin: AuthUser = {
  id: "u2",
  email: "ionx-admin@bms.local",
  displayName: "Ion Exchange Admin",
  role: "organization_admin",
} as unknown as AuthUser;

type Stubs = {
  profiles?: EscalationProfileDto[];
  defaults?: Array<{ severity: string; profileId: string; profileCode: string }>;
  organizations?: typeof ORGANIZATIONS;
  overrides?: Partial<typeof api>;
};

function stubApi({
  profiles = [afterHours, quietHours],
  defaults = [{ severity: "critical", profileId: AFTER_HOURS_ID, profileCode: "after-hours" }],
  organizations = ORGANIZATIONS,
  overrides = {},
}: Stubs = {}): void {
  vi.spyOn(api, "fetchEscalationProfiles").mockResolvedValue({ items: profiles });
  vi.spyOn(api, "fetchEscalationDefaults").mockResolvedValue({
    organizationId: ORG_A,
    items: defaults,
  });
  vi.spyOn(api, "createEscalationProfile").mockResolvedValue(afterHours);
  vi.spyOn(api, "updateEscalationProfile").mockResolvedValue(afterHours);
  vi.spyOn(api, "deleteEscalationProfile").mockResolvedValue({ deleted: true });
  vi.spyOn(api, "setEscalationDefaults").mockResolvedValue({
    organizationId: ORG_A,
    items: defaults,
  });
  vi.spyOn(notificationsApi, "fetchNotificationChannels").mockResolvedValue({ items: CHANNELS });
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({ items: organizations });
  for (const [name, value] of Object.entries(overrides)) {
    vi.spyOn(api, name as keyof typeof api).mockImplementation(value as never);
  }
}

function renderPage(as: AuthUser = admin): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EscalationProfilesPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The ladder editor only exists once a step has been added to it. */
async function addStep(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Add step" }));
}

/**
 * Wait for the organization list, which every other query on this screen waits
 * for in turn: the picker's options, the severity map's scope and the channel
 * checklist's filter all come from it.
 */
async function organizationsLoaded(): Promise<void> {
  await screen.findByRole("option", { name: "Ion Exchange" });
}

export async function listsProfilesWithStepCountsAndMappedSeverities(): Promise<void> {
  // A single-grant `organization_admin`: the picker locks to Ion Exchange, so
  // the severity map has an organization to read without anyone choosing one.
  stubApi({ organizations: [ORGANIZATIONS[0]!] });
  renderPage(orgAdmin);

  // The severity arrives last: the map is fetched for the organization the
  // picker resolves to, so it waits on the organization list.
  await waitFor(() => {
    expect(
      within(screen.getByRole("row", { name: /after-hours/ })).getByText("Critical"),
    ).toBeInTheDocument();
  });

  const mapped = screen.getByRole("row", { name: /after-hours/ });
  expect(within(mapped).getByText("After hours")).toBeInTheDocument();
  expect(within(mapped).getByText("Ion Exchange")).toBeInTheDocument();
  // Two rungs on the ladder.
  expect(within(mapped).getByText("2")).toBeInTheDocument();

  const unmapped = screen.getByRole("row", { name: /quiet-hours/ });
  expect(within(unmapped).getByText("0")).toBeInTheDocument();
  expect(within(unmapped).queryByText("Critical")).not.toBeInTheDocument();
}

export async function createPostsTheOrganizationCodeNameAndLadder(): Promise<void> {
  stubApi();
  renderPage(admin);

  await organizationsLoaded();
  await userEvent.selectOptions(screen.getByLabelText("Organization"), ORG_A);
  await userEvent.type(screen.getByLabelText("Code"), "after-hours");
  await userEvent.type(screen.getByLabelText("Name"), "After hours");

  await addStep();
  const step = screen.getByRole("group", { name: /Step 1/ });
  await userEvent.clear(within(step).getByLabelText("After (minutes)"));
  await userEvent.type(within(step).getByLabelText("After (minutes)"), "15");
  await userEvent.click(within(step).getByLabelText("Operations email"));

  await userEvent.click(screen.getByRole("button", { name: "Add profile" }));

  await waitFor(() => {
    expect(api.createEscalationProfile).toHaveBeenCalledWith({
      organizationId: ORG_A,
      code: "after-hours",
      name: "After hours",
      steps: [{ afterMinutes: 15, channelIds: [EMAIL_CHANNEL_ID] }],
    });
  });
}

export async function aStepRowCanBeAddedAndRemoved(): Promise<void> {
  stubApi({ organizations: [ORGANIZATIONS[0]!] });
  renderPage(orgAdmin);

  await organizationsLoaded();
  await userEvent.type(screen.getByLabelText("Code"), "night-shift");
  await userEvent.type(screen.getByLabelText("Name"), "Night shift");

  await addStep();
  await addStep();
  expect(screen.getByRole("group", { name: /Step 1/ })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: /Step 2/ })).toBeInTheDocument();

  const first = screen.getByRole("group", { name: /Step 1/ });
  await userEvent.clear(within(first).getByLabelText("After (minutes)"));
  await userEvent.type(within(first).getByLabelText("After (minutes)"), "20");
  await userEvent.click(within(first).getByLabelText("Fleet webhook"));

  const second = screen.getByRole("group", { name: /Step 2/ });
  await userEvent.clear(within(second).getByLabelText("After (minutes)"));
  await userEvent.type(within(second).getByLabelText("After (minutes)"), "90");
  await userEvent.click(within(second).getByRole("button", { name: "Remove step" }));

  expect(screen.queryByRole("group", { name: /Step 2/ })).not.toBeInTheDocument();

  // The removal is real, not visual: the payload carries the surviving rung
  // only, and it keeps the values that were typed into it.
  await userEvent.click(screen.getByRole("button", { name: "Add profile" }));
  await waitFor(() => {
    expect(api.createEscalationProfile).toHaveBeenCalledWith({
      organizationId: ORG_A,
      code: "night-shift",
      name: "Night shift",
      steps: [{ afterMinutes: 20, channelIds: [FLEET_CHANNEL_ID] }],
    });
  });
}

/**
 * Editing sends the name and the ladder, and nothing else.
 *
 * `updateEscalationProfileBodySchema` carries neither `code` nor
 * `organizationId`, so Zod would strip either silently — a field accepted,
 * ignored and answered `200` is how a client comes to believe it can rename a
 * code or move a profile between tenants. Both controls are therefore disabled
 * rather than hidden: the operator must still see whose profile this is.
 */
export async function editingSendsOnlyTheNameAndLadder(): Promise<void> {
  stubApi({ organizations: [ORGANIZATIONS[0]!] });
  renderPage(orgAdmin);

  await organizationsLoaded();
  await userEvent.click(
    within(screen.getByRole("row", { name: /after-hours/ })).getByRole("button", { name: "Edit" }),
  );

  const code = screen.getByLabelText("Code");
  expect(code).toHaveValue("after-hours");
  expect(code).toBeDisabled();
  const organizationSelect = screen.getByLabelText("Organization");
  expect(organizationSelect).toBeDisabled();
  expect(within(organizationSelect).getByRole("option")).toHaveTextContent("Ion Exchange");

  // The stored ladder opens as it is stored — two rungs, in order, each with
  // the channels it holds. Nothing else proves `stepNo` survives the round trip
  // as a position rather than as a field the form has to carry.
  expect(
    within(screen.getByRole("group", { name: /Step 1/ })).getByLabelText("After (minutes)"),
  ).toHaveValue("15");
  const second = screen.getByRole("group", { name: /Step 2/ });
  expect(within(second).getByLabelText("After (minutes)")).toHaveValue("60");
  expect(within(second).getByLabelText("Fleet webhook")).toBeChecked();
  expect(within(second).getByLabelText("Operations email")).not.toBeChecked();

  await userEvent.clear(screen.getByLabelText("Name"));
  await userEvent.type(screen.getByLabelText("Name"), "After hours (revised)");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => {
    expect(api.updateEscalationProfile).toHaveBeenCalledWith({
      id: AFTER_HOURS_ID,
      patch: {
        name: "After hours (revised)",
        steps: [
          { afterMinutes: 15, channelIds: [EMAIL_CHANNEL_ID] },
          { afterMinutes: 60, channelIds: [FLEET_CHANNEL_ID] },
        ],
      },
    });
  });
}

/**
 * The checklist offers the organization's channels and the fleet-wide ones, and
 * nothing else. `EscalationProfilesService` resolves every channel id through
 * `ChannelsService.loadById` and refuses one paired with another organization
 * (PR 1's M2), so an offered `PHE email` would be an option that always 403s.
 */
export async function theChannelChecklistExcludesAnotherTenantsChannels(): Promise<void> {
  stubApi({ organizations: [ORGANIZATIONS[0]!] });
  renderPage(orgAdmin);

  await organizationsLoaded();
  await addStep();

  const step = screen.getByRole("group", { name: /Step 1/ });
  expect(within(step).getByLabelText("Operations email")).toBeInTheDocument();
  expect(within(step).getByLabelText("Fleet webhook")).toBeInTheDocument();
  expect(within(step).queryByLabelText("PHE email")).not.toBeInTheDocument();
}

export async function theSeverityMapPutsOnlyTheMappedSeverities(): Promise<void> {
  stubApi({ organizations: [ORGANIZATIONS[0]!] });
  renderPage(orgAdmin);

  // The stored map arrives selected, so an operator edits what is, not a blank.
  await waitFor(() => {
    expect(screen.getByLabelText("Critical")).toHaveValue(AFTER_HOURS_ID);
  });
  // Every live severity gets a control; a deactivated one gets none.
  expect(screen.getByLabelText("Warning")).toBeInTheDocument();
  expect(screen.queryByLabelText("Legacy")).not.toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText("Warning"), AFTER_HOURS_ID);
  // Back to `None` — the only way to turn escalation off for a severity, and
  // the reason `items` is a filtered list rather than one entry per severity.
  await userEvent.selectOptions(screen.getByLabelText("Critical"), "");
  await userEvent.click(screen.getByRole("button", { name: "Save severity map" }));

  await waitFor(() => {
    expect(api.setEscalationDefaults).toHaveBeenCalledWith({
      organizationId: ORG_A,
      items: [{ severity: "warning", profileId: AFTER_HOURS_ID }],
    });
  });
}

export async function showsTheServerRefusalOnCreate(): Promise<void> {
  stubApi({
    organizations: [ORGANIZATIONS[0]!],
    overrides: {
      createEscalationProfile: () =>
        Promise.reject(new Error("steps must be ordered by afterMinutes, strictly increasing")),
    },
  });
  renderPage(orgAdmin);

  await organizationsLoaded();
  await userEvent.type(screen.getByLabelText("Code"), "bad-ladder");
  await userEvent.type(screen.getByLabelText("Name"), "Bad ladder");
  await userEvent.click(screen.getByRole("button", { name: "Add profile" }));

  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(/strictly increasing/i);
  });
}

export async function showsTheRefusalWhenDeletingAMappedProfile(): Promise<void> {
  stubApi({
    organizations: [ORGANIZATIONS[0]!],
    overrides: {
      deleteEscalationProfile: () =>
        Promise.reject(
          new Error("Profile after-hours is mapped to a severity; unmap it before deleting."),
        ),
    },
  });
  renderPage(orgAdmin);

  const row = await screen.findByRole("row", { name: /after-hours/ });
  await userEvent.click(within(row).getByRole("button", { name: "Delete" }));

  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(/unmap it before deleting/i);
  });
}

/**
 * `organization_id` is `NOT NULL` on all four tables, so unlike a channel there
 * is no fleet-wide profile: `resolveTargetOrg` answers an `admin` who names no
 * organization with a 400. The form asks instead of collecting a refusal.
 */
export async function asksAnAdminToChooseAnOrganization(): Promise<void> {
  stubApi();
  renderPage(admin);

  await organizationsLoaded();
  const organizationSelect = screen.getByLabelText("Organization");
  expect(organizationSelect).toHaveValue("");
  expect(screen.getByRole("option", { name: "Select organization" })).toBeInTheDocument();
  // No fleet-wide entry anywhere in the picker — it could never be written.
  expect(screen.queryByRole("option", { name: /Fleet-wide/i })).not.toBeInTheDocument();

  expect(screen.getByRole("button", { name: "Add profile" })).toBeDisabled();
  expect(
    screen.getByText(/Choose an organization\. A profile always belongs to one\./i),
  ).toBeInTheDocument();
  // And with no organization there is no map to show, rather than an empty one
  // that reads as "nothing is mapped".
  expect(screen.getByText(/Choose an organization to see its severity map/i)).toBeInTheDocument();
}

export async function locksASingleGrantOrganizationAdmin(): Promise<void> {
  stubApi({ organizations: [ORGANIZATIONS[0]!] });
  renderPage(orgAdmin);

  await organizationsLoaded();
  const organizationSelect = screen.getByLabelText("Organization");
  expect(organizationSelect).toBeDisabled();
  expect(organizationSelect).toHaveValue(ORG_A);
  expect(screen.queryByRole("option", { name: /Fleet-wide/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add profile" })).not.toBeDisabled();
}

/**
 * An `admin` sees every tenant's profiles but one organization's severity map.
 * A row outside the selected organization therefore has no default to match,
 * and its Severities cell must read as "another tenant", not as "unmapped" —
 * which is what the Organization column beside it supplies.
 */
export async function anotherTenantsProfileShowsNoMappedSeverity(): Promise<void> {
  stubApi({ profiles: [afterHours, pheLadder] });
  renderPage(admin);

  await organizationsLoaded();
  await userEvent.selectOptions(screen.getByLabelText("Organization"), ORG_A);

  await waitFor(() => {
    expect(
      within(screen.getByRole("row", { name: /after-hours/ })).getByText("Critical"),
    ).toBeInTheDocument();
  });
  const other = screen.getByRole("row", { name: /phe-ladder/ });
  expect(within(other).getByText("PHE West Bengal")).toBeInTheDocument();
  expect(within(other).queryByText("Critical")).not.toBeInTheDocument();
}
