import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminPointKeyDto, OrgTrendPointsDto, TrendPointDto, TrendPointSegmentDto } from "@bms/shared";

import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as api from "../../api/admin/trend-points";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import { TrendPointsAdminPage } from "./trend-points-page";

/**
 * `F4.300` U5 (ADR 0108 decision 3, plan C3/C4/C10) — the Trend Points admin
 * screen, rendered (ADR 0042). Assertions live here; `trend-points-page.test.tsx`
 * is the Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * Every read the page and its `MasterDataLayout` chrome issue is stubbed with
 * `vi.spyOn` (`F4.160`: an unstubbed read reaches a local API on `:4000`). The
 * Save case restores the real `putOrgTrendPointSegment` and stubs `fetch`, so
 * the route and the body are read on the wire.
 *
 * The segment codes are fixture codes, not seeded `asset_domains` codes: the
 * page holds no segment of its own, so any code the DTO names must render.
 */

const admin = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const locationAdmin = {
  id: "u3",
  email: "wc-admin@bms.local",
  displayName: "WC Admin",
  role: "location_admin",
} as unknown as AuthUser;

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ALPHA = "f4300_alpha";
const BETA = "f4300_beta";
const FULL = "f4300_full";

function point(code: string): TrendPointDto {
  return { code, name: `Name ${code}`, unit: null, active: true };
}

function segment(overrides: Partial<TrendPointSegmentDto> & Pick<TrendPointSegmentDto, "domain" | "label">): TrendPointSegmentDto {
  return {
    source: "catalog",
    points: [],
    catalogDefaults: [],
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

/** Alpha: the catalog default. Beta: an organization override over a different default. */
const ALPHA_SEGMENT = segment({
  domain: ALPHA,
  label: "Alpha segment",
  source: "catalog",
  points: [point("f4300_a1"), point("f4300_a2")],
  catalogDefaults: [point("f4300_a1"), point("f4300_a2")],
});

const BETA_SEGMENT = segment({
  domain: BETA,
  label: "Beta segment",
  source: "organization",
  points: [point("f4300_b1")],
  catalogDefaults: [point("f4300_b2")],
  updatedAt: new Date(0).toISOString(),
});

const TWELVE = Array.from({ length: 12 }, (_, index) => point(`f4300_f${index}`));

const FULL_SEGMENT = segment({
  domain: FULL,
  label: "Full segment",
  source: "organization",
  points: TWELVE,
  catalogDefaults: [],
});

const DTO: OrgTrendPointsDto = { organizationId: ORG_ID, segments: [ALPHA_SEGMENT, BETA_SEGMENT] };

function catalogKey(code: string, domain: string): AdminPointKeyDto {
  return {
    id: `id-${code}`,
    code,
    name: `Name ${code}`,
    domain,
    unit: null,
    description: null,
    active: true,
    createdAt: new Date(0).toISOString(),
    headlineRank: null,
    trendDefault: false,
  };
}

/** `f4300_x1` belongs to no segment on screen, so the Alpha picker must not offer it. */
const CATALOG = {
  items: [
    catalogKey("f4300_a1", ALPHA),
    catalogKey("f4300_a2", ALPHA),
    catalogKey("f4300_a3", ALPHA),
    catalogKey("f4300_b1", BETA),
    catalogKey("f4300_b2", BETA),
    catalogKey("f4300_x1", "f4300_other"),
    ...TWELVE.map((item) => catalogKey(item.code, FULL)),
    catalogKey("f4300_f12", FULL),
  ],
};

function stubAll(dto: OrgTrendPointsDto = DTO): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: ORG_ID, code: "F4300ORG", name: "Spec organization" }],
  } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue(CATALOG as never);
  vi.spyOn(api, "fetchOrgTrendPoints").mockResolvedValue(dto);
  vi.spyOn(api, "putOrgTrendPointSegment").mockResolvedValue(ALPHA_SEGMENT);
}

function renderPage(as: AuthUser): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/trend-points"]}>
        <TrendPointsAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The card of one segment, found by its `data-segment` attribute once its heading renders. */
async function cardOf(label: string, domain: string): Promise<HTMLElement> {
  await screen.findByRole("heading", { name: label });
  const card = document.querySelector<HTMLElement>(`[data-segment="${domain}"]`);
  if (!card) throw new Error(`no card for ${domain}`);
  return card;
}

/** T1 — one card per DTO segment, each headed by its label. */
export async function rendersOneCardPerSegmentWithItsLabel(): Promise<void> {
  stubAll();
  renderPage(admin);
  await cardOf("Alpha segment", ALPHA);
  await cardOf("Beta segment", BETA);
  expect(document.querySelectorAll("[data-segment]")).toHaveLength(DTO.segments.length);
  expect(api.fetchOrgTrendPoints).toHaveBeenCalledWith(ORG_ID);
}

/** T2 — the badge names the source: "Catalog default" for alpha, "Organization" for beta. */
export async function theBadgeNamesTheSource(): Promise<void> {
  stubAll();
  renderPage(admin);
  const alpha = await cardOf("Alpha segment", ALPHA);
  const beta = await cardOf("Beta segment", BETA);
  expect(within(alpha).getByText("Catalog default")).toBeInTheDocument();
  expect(within(alpha).queryByText("Organization")).toBeNull();
  expect(within(beta).getByText("Organization")).toBeInTheDocument();
  expect(within(beta).queryByText("Catalog default")).toBeNull();
}

/** T3a — the Add picker offers the segment's catalog codes not yet in the list, and no other. */
export async function thePickerOffersOnlyTheSegmentsMissingCodes(): Promise<void> {
  stubAll();
  renderPage(admin);
  const alpha = await cardOf("Alpha segment", ALPHA);
  const picker = await within(alpha).findByRole("combobox", { name: "Add a point to Alpha segment" });
  await waitFor(() =>
    expect(within(picker).getAllByRole("option").map((option) => (option as HTMLOptionElement).value)).toEqual([
      "",
      "f4300_a3",
    ]),
  );
}

/**
 * T3b — Add then Save sends `PUT /admin/organizations/<id>/trend-points/<domain>`
 * with the list in order, read on the wire through the real client.
 */
export async function addThenSaveSendsThePutWithTheOrderedList(): Promise<void> {
  stubAll();
  vi.mocked(api.putOrgTrendPointSegment).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ...ALPHA_SEGMENT, source: "organization" }), { status: 200 });
  });
  const user = userEvent.setup();
  renderPage(admin);
  const alpha = await cardOf("Alpha segment", ALPHA);
  const picker = await within(alpha).findByRole("combobox", { name: "Add a point to Alpha segment" });
  await within(picker).findByRole("option", { name: /f4300_a3/ });
  await user.selectOptions(picker, "f4300_a3");
  await user.click(within(alpha).getByRole("button", { name: "Add" }));
  await user.click(within(alpha).getByRole("button", { name: "Save" }));

  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls).toHaveLength(1));
  const [put] = calls as [{ url: string; init: RequestInit }];
  expect(put.url).toBe(`${base}/api/v1/admin/organizations/${ORG_ID}/trend-points/${ALPHA}`);
  expect(put.init.method).toBe("PUT");
  expect(JSON.parse(String(put.init.body))).toEqual({ pointKeys: ["f4300_a1", "f4300_a2", "f4300_a3"] });
}

/** T3c — "Move up" reorders the list, and Save sends the new order. */
export async function moveUpChangesTheSentOrder(): Promise<void> {
  stubAll();
  const user = userEvent.setup();
  renderPage(admin);
  const alpha = await cardOf("Alpha segment", ALPHA);
  await user.click(within(alpha).getByRole("button", { name: "Move f4300_a2 up" }));
  await user.click(within(alpha).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.putOrgTrendPointSegment).toHaveBeenCalledWith(ORG_ID, ALPHA, ["f4300_a2", "f4300_a1"]),
  );
}

/**
 * T3e — Save is disabled on an unchanged catalog card (review finding 4): one
 * click would pin the catalog list as an override, so later catalog changes
 * would stop reaching the organization. A reorder enables it (the adjacent
 * positive), and an unchanged organization card keeps Save enabled.
 */
export async function saveIsDisabledOnAnUnchangedCatalogCard(): Promise<void> {
  stubAll();
  const user = userEvent.setup();
  renderPage(admin);
  const alpha = await cardOf("Alpha segment", ALPHA);
  const beta = await cardOf("Beta segment", BETA);
  expect(within(alpha).getByRole("button", { name: "Save" })).toBeDisabled();
  expect(within(beta).getByRole("button", { name: "Save" })).toBeEnabled();
  await user.click(within(alpha).getByRole("button", { name: "Move f4300_a2 up" }));
  expect(within(alpha).getByRole("button", { name: "Save" })).toBeEnabled();
  await user.click(within(alpha).getByRole("button", { name: "Move f4300_a1 up" }));
  expect(within(alpha).getByRole("button", { name: "Save" }), "back to the catalog order").toBeDisabled();
  expect(api.putOrgTrendPointSegment).not.toHaveBeenCalled();
}

/** T3d — "Remove" takes a code out of the list, and Save sends the rest. */
export async function removeTakesTheCodeOutOfTheSentList(): Promise<void> {
  stubAll();
  const user = userEvent.setup();
  renderPage(admin);
  const alpha = await cardOf("Alpha segment", ALPHA);
  await user.click(within(alpha).getByRole("button", { name: "Remove f4300_a1" }));
  await user.click(within(alpha).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.putOrgTrendPointSegment).toHaveBeenCalledWith(ORG_ID, ALPHA, ["f4300_a2"]));
}

/** T4 — "Reset to catalog" on an organization segment sends `pointKeys: []`. */
export async function resetSendsAnEmptyList(): Promise<void> {
  stubAll();
  const user = userEvent.setup();
  renderPage(admin);
  const beta = await cardOf("Beta segment", BETA);
  await user.click(within(beta).getByRole("button", { name: "Reset to catalog" }));
  await waitFor(() => expect(api.putOrgTrendPointSegment).toHaveBeenCalledWith(ORG_ID, BETA, []));
  expect(api.putOrgTrendPointSegment).toHaveBeenCalledTimes(1);
}

/** T4b — a catalog segment has no override to reset, so it offers no Reset. */
export async function aCatalogSegmentOffersNoReset(): Promise<void> {
  stubAll();
  renderPage(admin);
  const alpha = await cardOf("Alpha segment", ALPHA);
  const beta = await cardOf("Beta segment", BETA);
  expect(within(beta).getByRole("button", { name: "Reset to catalog" })).toBeInTheDocument();
  expect(within(alpha).queryByRole("button", { name: "Reset to catalog" })).toBeNull();
}

/** T5 — a list of 12 (the cap) has no Add control; a shorter list on the same screen has one. */
export async function theAddControlIsAbsentAtTheCap(): Promise<void> {
  stubAll({ organizationId: ORG_ID, segments: [ALPHA_SEGMENT, FULL_SEGMENT] });
  renderPage(admin);
  const alpha = await cardOf("Alpha segment", ALPHA);
  const full = await cardOf("Full segment", FULL);
  expect(within(alpha).getByRole("button", { name: "Add" })).toBeInTheDocument();
  expect(within(full).getAllByRole("listitem")).toHaveLength(12);
  expect(within(full).queryByRole("button", { name: "Add" })).toBeNull();
  expect(within(full).queryByRole("combobox")).toBeNull();
}

/** T6 — a `location_admin` reads the refusal sentence; no form renders and no read starts. */
export async function failsClosedForALocationAdmin(): Promise<void> {
  stubAll();
  renderPage(locationAdmin);
  expect(
    await screen.findByText("Trend points are set by an organization administrator or a global administrator."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Organization" })).toBeNull();
  expect(document.querySelectorAll("[data-segment]")).toHaveLength(0);
  expect(api.fetchOrgTrendPoints).not.toHaveBeenCalled();
  expect(organizationsApi.fetchAdminOrganizations).not.toHaveBeenCalled();
  expect(pointKeysApi.fetchAdminPointKeys).not.toHaveBeenCalled();
}
