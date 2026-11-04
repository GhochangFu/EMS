import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminLocationDto, ReportScheduleDto, UserRole } from "@bms/shared";

import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as notificationsApi from "../../api/notifications";
import * as reportsApi from "../../api/reports";
import type { SchedulePrefill } from "../../lib/schedule-from-view";
import type { AuthUser } from "../../stores/auth-store";
import { ScheduleButton } from "./schedule-button";

/**
 * `F4.303` U16 (ADR 0108 Amendment 6 item 6, owner Q-C) — the Schedule button: it shows for a
 * role that may schedule, opens the existing wizard inline (no modal) prefilled from the view,
 * and says "Schedule created" once the create answers. Every api client the wizard reads is
 * stubbed: an unstubbed one reaches a local API on :4000. Entry point: `schedule-button.test.tsx`.
 */

const ORG = "5c2c1b0e-2222-4a5b-8c4d-000000000010";
const SITE = "7d3e2f1a-3333-4a5b-8c4d-000000000021";
const ASSET = "aaaaaaaa-5555-4a5b-8c4d-000000000001";

const LOCATION: AdminLocationDto = {
  id: SITE,
  parentId: null,
  organizationId: ORG,
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
  floorAreaM2: null,
  latitude: -33.9,
  longitude: 18.4,
  active: true,
  meta: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const CREATED = { id: "0f0a4a1e-5555-4a5b-8c4d-000000000041" } as ReportScheduleDto;

const PREFILL: SchedulePrefill = {
  templateId: "trend_points",
  params: { points: [{ assetId: ASSET, pointKey: "kw" }], compare: false },
  locationIds: [SITE],
};

const userOf = (role: UserRole): AuthUser => ({
  id: "9b1d2c3e-0000-4a5b-8c4d-000000000001",
  email: "someone@bms.local",
  displayName: "Someone",
  role,
});

/** The three clients the wizard reads, stubbed (a view spec that opens the wizard calls this). */
export function stubScheduleWizardApis(): void {
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [LOCATION] });
  vi.spyOn(notificationsApi, "fetchNotificationChannels").mockResolvedValue({ items: [] });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] });
}

function renderButton(role: UserRole, prefill: SchedulePrefill | null = PREFILL): void {
  stubScheduleWizardApis();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScheduleButton user={userOf(role)} prefill={prefill} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The button shows for a location administrator. */
export function theButtonShowsForALocationAdmin(): void {
  renderButton("location_admin");
  expect(screen.getByRole("button", { name: "Schedule" })).toBeInTheDocument();
}

/** The button is absent for an asset-group administrator (an absence, beside the presence above). */
export function theButtonIsAbsentForAnAssetGroupAdmin(): void {
  renderButton("asset_group_admin");
  expect(screen.queryByRole("button", { name: "Schedule" })).toBeNull();
}

/** The button is absent while the view has nothing to schedule. */
export function theButtonIsAbsentWithoutAPrefill(): void {
  renderButton("admin", null);
  expect(screen.queryByRole("button", { name: "Schedule" })).toBeNull();
}

/** Clicking opens the wizard inline, prefilled: no dialog, the template line. */
export async function clickingOpensTheWizardInline(): Promise<void> {
  renderButton("location_admin");
  expect(screen.queryByText("Template: Trend points · 1 point")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  expect(await screen.findByText("Template: Trend points · 1 point")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
}

/** After the create answers, the wizard closes and "Schedule created" shows. */
export async function createdShowsTheSentenceAndClosesTheWizard(): Promise<void> {
  const create = vi.spyOn(reportsApi, "createReportSchedule").mockResolvedValue(CREATED);
  renderButton("location_admin");
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  await userEvent.type(await screen.findByLabelText("Name"), "Site digest");
  const next = () => userEvent.click(screen.getByRole("button", { name: "Next" }));
  await next();
  await within(await screen.findByLabelText("Locations")).findByRole("option", { name: LOCATION.name });
  await next();
  await next();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Schedule created")).toBeInTheDocument();
  expect(screen.queryByText("Template: Trend points · 1 point")).toBeNull();
}

/** Review fix — the view changes while the wizard is open: the create sends the view's new points. */
export async function aPrefillChangedWhileOpenIsTheOneSent(): Promise<void> {
  const create = vi.spyOn(reportsApi, "createReportSchedule").mockResolvedValue(CREATED);
  stubScheduleWizardApis();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (prefill: SchedulePrefill) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScheduleButton user={userOf("location_admin")} prefill={prefill} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(tree(PREFILL));
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  await screen.findByText("Template: Trend points · 1 point");
  const changed: SchedulePrefill = {
    ...PREFILL,
    params: { points: [{ assetId: ASSET, pointKey: "kw" }, { assetId: ASSET, pointKey: "pf" }], compare: true },
  };
  rerender(tree(changed));
  await userEvent.type(await screen.findByLabelText("Name"), "Site digest");
  const next = () => userEvent.click(screen.getByRole("button", { name: "Next" }));
  await next();
  await within(await screen.findByLabelText("Locations")).findByRole("option", { name: LOCATION.name });
  await next();
  await next();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect((create.mock.calls[0]?.[0] as unknown as Record<string, unknown>).params).toEqual(changed.params);
}
