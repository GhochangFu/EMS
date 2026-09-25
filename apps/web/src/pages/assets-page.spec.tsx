import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { assetHealthResponseSchema, assetListRowSchema } from "@bms/shared/contracts";
import type { AssetHealthResponse, AssetListRow, DashboardsListResponse, UserRole } from "@bms/shared";

import * as assetHealthApi from "../api/asset-health";
import * as assetsApi from "../api/assets";
import * as dashboardsApi from "../api/dashboards";
import * as vocabApi from "../api/vocabularies";
import type { AuthUser } from "../stores/auth-store";
import { AssetsPage } from "./assets-page";

/**
 * `F3.31` — the `/asset-browser` operator browser (ADR 0068 decisions 1, 3 and 5).
 *
 * Assertions live here; `assets-page.test.tsx` is the Vitest entry point and
 * carries `@vitest-environment jsdom` (ADR 0014 / ADR 0042 decision 2).
 *
 * The owed guards from the ADR's Consequences: a nav spec that "Assets"
 * renders for a `viewer` under *Operations* (P1); a row click opens the panel
 * for THAT row (P2); the panel's dashboard links carry the slug and the read
 * is narrowed by the row's id (P3). The rest of the table holds decision 3's
 * sentences, the filter wiring, the column mapping, and — after a positive
 * control — the absence of every write affordance.
 */

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

/** Built through the contract — an off-shape fixture would fail somewhere else. */
function row(overrides: Partial<AssetListRow> & Pick<AssetListRow, "id" | "code" | "name">): AssetListRow {
  return assetListRowSchema.parse({
    siteName: "Site A",
    domain: "hvac",
    locationId: "22222222-2222-4222-8222-222222222222",
    locationName: "Western Cape control room",
    rtuId: null,
    rtuDisplayName: null,
    telemetrySource: null,
    active: true,
    templateId: null,
    ...overrides,
  });
}

/**
 * Two rows, not one — the claim in P2 is that the panel names THAT row, and a
 * single-row list is satisfied identically by a panel that names the only
 * asset it could have found. The first is wired and templated; the second is
 * neither.
 */
const WIRED = row({
  id: "11111111-1111-4111-8111-111111111111",
  code: "CR-HVAC-1",
  name: "Control Room HVAC 1",
  rtuId: "44444444-4444-4444-8444-444444444444",
  rtuDisplayName: "RTU WC-1",
  telemetrySource: "mqtt",
  templateId: "66666666-6666-4666-8666-666666666666",
});
const UNWIRED = row({
  id: "33333333-3333-4333-8333-333333333333",
  code: "FEED-PUMP-2",
  name: "Feed Pump 2",
  siteName: "Site B",
  domain: "water",
  locationId: "55555555-5555-4555-8555-555555555555",
  locationName: "Gauteng control room",
});

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [
    { code: "hvac", label: "HVAC", sortOrder: 10, active: true },
    { code: "water", label: "Water", sortOrder: 20, active: true },
  ],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
  waterBalanceRoles: [],
};

/** No scored or unscored tags, so `87%` appears exactly once on the card. */
const HEALTH: AssetHealthResponse = assetHealthResponseSchema.parse({
  assetId: UNWIRED.id,
  score: 0.87,
  band: { code: "good", label: "Good", minScore: 0.8 },
  scoredTags: [],
  unscoredTags: [],
  windowFrom: "2026-09-17T00:00:00.000Z",
  windowTo: "2026-09-17T01:00:00.000Z",
  bucketSeconds: 300,
  computedAt: "2026-09-17T01:00:00.000Z",
  coveredBuckets: 12,
  expectedBuckets: 12,
});

const DASHBOARDS: DashboardsListResponse = {
  items: [
    {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      organizationId: "22222222-2222-4222-8222-222222222222",
      slug: "feed-pump-2-overview",
      name: "Feed Pump 2 · overview",
      description: null,
      locationId: null,
      assetGroupId: null,
      assetId: UNWIRED.id,
      assetTemplateId: null,
      assetCode: UNWIRED.code,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      widgetCount: 5,
    },
    {
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      organizationId: "22222222-2222-4222-8222-222222222222",
      slug: "feed-pump-2-trends",
      name: "Feed Pump 2 · trends",
      description: null,
      locationId: null,
      assetGroupId: null,
      assetId: UNWIRED.id,
      assetTemplateId: null,
      assetCode: UNWIRED.code,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      widgetCount: 2,
    },
  ],
};

function stubApi(dashboards: DashboardsListResponse = DASHBOARDS) {
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([WIRED, UNWIRED]);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  vi.spyOn(assetHealthApi, "fetchAssetHealth").mockResolvedValue(HEALTH);
  return vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(dashboards);
}

function renderPage(user: AuthUser = asUser("viewer")) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AssetsPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The Code cell is a button whose text is the code — the row is found by it. */
async function clickRow(code: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: code }));
}

function precedes(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * P1 (owed guard 4) — "Assets" renders for a `viewer`, points at `/asset-browser`,
 * and sits in the *Operations* group: its group label precedes it in the DOM
 * and the next group's label follows it. An admin sees a second "Assets" link
 * (`/admin/assets`) and this one beside it.
 *
 * The group label is a plain `<div>`, not a heading, and the page's own
 * eyebrow also reads "Operations" — so the label is located inside the
 * sidebar `<aside>` the link lives in, never by a page-wide text query.
 */
export async function viewerSeesAssetsUnderOperations(): Promise<void> {
  stubApi();
  renderPage(asUser("viewer"));

  const link = await screen.findByRole("link", { name: "Assets" });
  expect(link).toHaveAttribute("href", "/asset-browser");
  const sidebar = link.closest("aside") as HTMLElement;
  const operations = within(sidebar).getByText("Operations");
  // `F4.156` — the group renders once the `["assets"]` read holds a `CR-*`
  // code (WIRED is `CR-HVAC-1`), so it is awaited rather than read at once.
  const controlRoom = await within(sidebar).findByText("Control Room 2D");
  expect(precedes(operations, link)).toBe(true);
  expect(precedes(link, controlRoom)).toBe(true);
}

export async function adminSeesBothAssetsLinks(): Promise<void> {
  stubApi();
  renderPage(asUser("admin"));

  const links = await screen.findAllByRole("link", { name: "Assets" });
  expect(links.some((l) => l.getAttribute("href") === "/asset-browser")).toBe(true);
  expect(links.some((l) => l.getAttribute("href") === "/admin/assets")).toBe(true);
}

/** P2 (owed guard 3a) — clicking the second row opens the panel for THAT row. */
export async function clickingARowOpensThePanelForThatRow(): Promise<void> {
  stubApi();
  renderPage();

  await clickRow("FEED-PUMP-2");

  const heading = await screen.findByRole("heading", { name: "Asset · FEED-PUMP-2" });
  expect(screen.queryByRole("heading", { name: "Asset · CR-HVAC-1" })).not.toBeInTheDocument();

  // The `<dl>` is built from the row the list already holds — D7's seven
  // terms, no second asset fetch.
  const panel = heading.closest("aside") as HTMLElement;
  const dl = panel.querySelector("dl") as HTMLElement;
  expect(Array.from(dl.querySelectorAll("dt")).map((dt) => dt.textContent)).toEqual([
    "Name", "Site", "Location", "Domain", "RTU", "Source", "Active",
  ]);
  expect(within(dl).getByText("Gauteng control room")).toBeInTheDocument();
  expect(within(dl).getByText("Water")).toBeInTheDocument();
}

/**
 * P3 (owed guard 3b) — the panel lists every dashboard the read returns, each
 * link carries the slug, and the read is narrowed by the row's id as the
 * SECOND argument of `fetchDashboards` (the first is `organizationId`; passing
 * the id there would narrow by the wrong axis and answer `[]`).
 */
export async function panelListsDashboardsWithSlugLinks(): Promise<void> {
  const fetchDashboards = stubApi();
  renderPage();

  await clickRow("FEED-PUMP-2");

  const link = await screen.findByRole("link", { name: /Feed Pump 2 · overview/ });
  // `?organizationId=` rides on the link as it does on the dashboards page:
  // the fleet pool can hold one slug in two organizations (dashboards.schema.ts
  // D5), and the viewer disambiguates by that query.
  expect(link).toHaveAttribute(
    "href",
    "/dashboards/feed-pump-2-overview?organizationId=22222222-2222-4222-8222-222222222222",
  );
  expect(screen.getByText(/5 widgets/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Feed Pump 2 · trends/ })).toHaveAttribute(
    "href",
    "/dashboards/feed-pump-2-trends?organizationId=22222222-2222-4222-8222-222222222222",
  );
  expect(fetchDashboards).toHaveBeenCalledWith(undefined, UNWIRED.id);
}

/**
 * P4 — the empty list reads two different sentences: the hand-created row
 * (`templateId: null`) says why, the templated row does not.
 */
export async function emptyDashboardsSentenceDependsOnTemplateId(): Promise<void> {
  stubApi({ items: [] });
  renderPage();

  await clickRow("FEED-PUMP-2");
  expect(await screen.findByText(/created by hand/)).toBeInTheDocument();

  await clickRow("CR-HVAC-1");
  await screen.findByRole("heading", { name: "Asset · CR-HVAC-1" });
  expect(await screen.findByText("No dashboards for this asset.")).toBeInTheDocument();
  expect(screen.queryByText(/created by hand/)).not.toBeInTheDocument();
}

/** P5 — the health hook is wired: the card heading and the stubbed score render. */
export async function panelShowsTheHealthCard(): Promise<void> {
  const fetchHealth = vi.spyOn(assetHealthApi, "fetchAssetHealth");
  stubApi();
  renderPage();

  await clickRow("FEED-PUMP-2");

  expect(await screen.findByRole("heading", { name: "Health" })).toBeInTheDocument();
  expect(await screen.findByText("87%")).toBeInTheDocument();
  expect(fetchHealth).toHaveBeenCalledWith(UNWIRED.id);
}

/** P6 — the domain select and the text input both narrow the table. */
export async function filtersNarrowTheTable(): Promise<void> {
  stubApi();
  renderPage();

  await screen.findByRole("button", { name: "FEED-PUMP-2" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Domain" }), "hvac");
  expect(screen.getByRole("button", { name: "CR-HVAC-1" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "FEED-PUMP-2" })).not.toBeInTheDocument();

  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Domain" }), "");
  await userEvent.type(screen.getByRole("textbox", { name: "Filter by code or name" }), "pump");
  expect(screen.getByRole("button", { name: "FEED-PUMP-2" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "CR-HVAC-1" })).not.toBeInTheDocument();
}

/**
 * P9 — a filter that matches nothing says so in the table, not only in the
 * "0 of N" counter (post-merge sweep). The rows-present state is the positive
 * control: the sentence is absent while a row still matches.
 */
export async function anEmptyFilterResultSaysSo(): Promise<void> {
  stubApi();
  renderPage();

  await screen.findByRole("button", { name: "FEED-PUMP-2" });
  expect(screen.queryByText("No assets match the current filters.")).not.toBeInTheDocument();

  await userEvent.type(screen.getByRole("textbox", { name: "Filter by code or name" }), "zzz-no-such-asset");
  expect(screen.queryByRole("button", { name: "FEED-PUMP-2" })).not.toBeInTheDocument();
  expect(screen.getByText("No assets match the current filters.")).toBeInTheDocument();
  expect(screen.getByText("0 of 2")).toBeInTheDocument();
}

/**
 * P7 — decision 3's last paragraph: the panel carries no write affordance.
 * The open panel is the positive control and is asserted FIRST; an absence
 * check ahead of it would also pass on a page that rendered nothing.
 */
export async function panelCarriesNoWriteAffordance(): Promise<void> {
  stubApi();
  const { container } = renderPage();

  await clickRow("FEED-PUMP-2");
  const heading = await screen.findByRole("heading", { name: "Asset · FEED-PUMP-2" });

  // Scoped to the panel, never `screen`: the page renders the whole AppShell,
  // and the nav carries "Asset Points" (matches /points/) for an admin — a
  // document-wide query is red on a correct page. `set` and `command` are the
  // words ADR 0068 decision 6 excludes by name; word-anchored because the nav
  // link "Assets" contains "set".
  const panel = within(heading.closest("aside") as HTMLElement);
  const writeWord = /\b(edit|attach|upload|delete|points|set|command)\b/i;
  expect(panel.queryAllByRole("button", { name: writeWord })).toHaveLength(0);
  expect(panel.queryAllByRole("link", { name: writeWord })).toHaveLength(0);
  expect(container.querySelector("aside input[type=\"file\"]")).toBeNull();
}

/** P8 — column mapping: a null RTU and source read `—`; the source is reported as stored. */
export async function columnsMapToTheRow(): Promise<void> {
  stubApi();
  renderPage();

  const unwired = (await screen.findByRole("button", { name: "FEED-PUMP-2" })).closest("tr") as HTMLElement;
  const wired = screen.getByRole("button", { name: "CR-HVAC-1" }).closest("tr") as HTMLElement;
  const cells = (tr: HTMLElement) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent);

  // Code · Name · Site · Domain · RTU · Source · Active
  expect(cells(unwired)[4]).toBe("—");
  expect(cells(unwired)[5]).toBe("—");
  expect(cells(wired)[4]).toBe("RTU WC-1");
  expect(cells(wired)[5]).toBe("mqtt");
  expect(cells(wired)[3]).toBe("HVAC");
  expect(within(wired).getByText("Active")).toBeInTheDocument();
}
