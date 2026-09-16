import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminAssetTemplateDto } from "@bms/shared";

import * as api from "../../api/admin/asset-templates";
import * as locationsApi from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import * as rtusApi from "../../api/admin/rtus";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { AssetTemplateDetailPage } from "./asset-template-detail-page";

/**
 * `F3.2` — the asset-template detail page's two new surfaces (ADR 0067
 * decision 7, Q5), rendered (ADR 0042). The first `.spec.tsx` for this page;
 * model: `dashboard-template-detail-page.spec.tsx`.
 *
 * Assertions live here; `asset-template-detail-page.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock, because
 * that is the file Vitest collects (ADR 0014, ADR 0042 decision 2).
 *
 * **What these cases gate that nothing cheaper can.** The *wording* of both
 * sentences is `lib/default-dashboards-report.spec.ts`'s, and the badge is
 * `dashboards-page.spec.tsx`'s. What is only provable by rendering this page
 * is the **gate on the button** — published AND a role that may author — and
 * that the instantiate dialog stops closing on success. Plan §9 listed both as
 * browser-only claims; they are not, and this file is the cheaper gate the
 * browser pass may now skip.
 */

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

function asUser(role: string, email: string): AuthUser {
  return { id: "u1", email, displayName: role, role } as unknown as AuthUser;
}

/** `canAuthorTemplates` admits `admin`; ADR 0038 decision 10 refuses `location_admin`. */
const admin = asUser("admin", "admin@bms.local");
const locationAdmin = asUser("location_admin", "wc-admin@bms.local");

function draftTemplate(): AdminAssetTemplateDto {
  return {
    id: TEMPLATE_ID,
    organizationId: ORG_ID,
    organizationCode: "IX",
    organizationName: "Ion Exchange",
    code: "electrical-feeder",
    version: 1,
    name: "Feeder",
    assetType: "feeder",
    domain: "electrical",
    description: null,
    status: "draft",
    content: { contentVersion: 1 },
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    points: [],
  } as unknown as AdminAssetTemplateDto;
}

function publishedTemplate(): AdminAssetTemplateDto {
  return {
    ...draftTemplate(),
    status: "published",
    publishedAt: new Date(0).toISOString(),
  } as unknown as AdminAssetTemplateDto;
}

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
};

/**
 * Everything the chrome and the default (Details) tab fetch. The page opens on
 * `details` — `resolveTemplateTab(null)` — so `fetchVocabularies` is reached on
 * every render here, and the instantiate dialog's `HierarchyFilterBar` reaches
 * the other three.
 */
function stubApi(overrides: Partial<Record<string, unknown>> = {}): void {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: ORG_ID, code: "IX", name: "Ion Exchange", active: true }],
  } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [{ id: LOCATION_ID, name: "West Campus", organizationId: ORG_ID, active: true }],
  } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  for (const [name, impl] of Object.entries(overrides)) {
    vi.spyOn(api, name as keyof typeof api).mockImplementation(impl as never);
  }
}

function renderPage(user: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/asset-templates/${TEMPLATE_ID}`]}>
        <Routes>
          <Route
            path="/admin/asset-templates/:templateId"
            element={<AssetTemplateDetailPage user={user} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BACKFILL_RESULT = {
  templateId: TEMPLATE_ID,
  templateCode: "electrical-feeder",
  templateVersion: 1,
  assets: [
    {
      assetId: "44444444-4444-4444-8444-444444444444",
      code: "TX-01",
      outcome: "created",
      dashboards: [
        {
          slug: "tx-01-overview",
          view: "overview",
          widgetCount: 3,
          boundPoints: 5,
          omittedFeatured: 0,
          resolutions: [],
        },
      ],
    },
    {
      assetId: "44444444-4444-4444-8444-444444444445",
      code: "TX-02",
      outcome: "skipped_existing",
      dashboards: [],
    },
  ],
  createdCount: 1,
  skippedCount: 1,
};

/**
 * The action exists on a published version for a role that may author — ADR
 * 0067 decision 7. Asserted by its accessible name, which is also the string
 * the browser pass matches.
 */
export async function publishedVersionOffersCreateDefaultDashboards(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage(admin);

  expect(
    await screen.findByRole("button", { name: "Create default dashboards" }),
  ).toBeInTheDocument();
}

/**
 * A draft does not. The route 409s on a draft (decision 4), so offering the
 * button there would be an affordance whose only outcome is an error banner.
 *
 * The positive control is inside this case: the draft's own Publish button is
 * asserted present, so a fixture that failed to load — which would make every
 * absence assertion pass vacuously — reddens here.
 */
export async function draftDoesNotOfferCreateDefaultDashboards(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(draftTemplate()) });
  renderPage(admin);

  expect(await screen.findByRole("button", { name: "Publish" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create default dashboards" }),
  ).not.toBeInTheDocument();
}

/**
 * The half of the gate that is about the role rather than the status.
 * `assertCanAuthor` refuses a `location_admin` server-side, and ADR 0038
 * decision 10 makes authoring **role-hidden** here rather than merely refused.
 *
 * Positive control: the same published version renders the read-only notice
 * for this role, so the page is loaded when the absence is asserted.
 */
export async function locationAdminIsNotOfferedCreateDefaultDashboards(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage(locationAdmin);

  expect(await screen.findByText(/This version is read-only/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create default dashboards" }),
  ).not.toBeInTheDocument();
}

/**
 * Decision 5's report reaches the screen: the summary sentence, and one row per
 * asset the backfill considered — the skipped one included, which is what makes
 * a `createdCount 0` second call readable.
 */
export async function theBackfillReportRendersASummaryAndARowPerAsset(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    createDefaultDashboardsFromAdminAssetTemplate: () => Promise.resolve(BACKFILL_RESULT),
  });
  renderPage(admin);

  const button = await screen.findByRole("button", { name: "Create default dashboards" });
  await userEvent.click(button);

  expect(
    await screen.findByText("Created dashboards for 1 asset · 1 already had one"),
  ).toBeInTheDocument();
  expect(screen.getByText("TX-01")).toBeInTheDocument();
  expect(screen.getByText("TX-02")).toBeInTheDocument();
  expect(screen.getByText(/tx-01-overview · 3 widgets · 5 points/)).toBeInTheDocument();
  expect(screen.getByText("Already had one")).toBeInTheDocument();
}

/**
 * ADR 0067 decisions 3 and 5 — a view whose `featured` list was cut by the
 * `MAX_DASHBOARD_WIDGETS` fallback cap says so.
 *
 * The fixture carries **two** views on one asset: one truncated, one not. The
 * truncated row is the positive control sitting beside the absence check, so
 * "the word `omitted` is not on the intact row" cannot pass because the table
 * failed to render at all. Both assertions are scoped to their own `<li>` —
 * a page-wide `queryByText(/omitted/)` would find the truncated row and prove
 * nothing about its sibling.
 */
export async function aTruncatedViewNamesItsOmittedCount(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    createDefaultDashboardsFromAdminAssetTemplate: () =>
      Promise.resolve({
        ...BACKFILL_RESULT,
        assets: [
          {
            ...BACKFILL_RESULT.assets[0]!,
            dashboards: [
              {
                slug: "tx-01-overview",
                view: "overview",
                widgetCount: 40,
                boundPoints: 40,
                omittedFeatured: 10,
                resolutions: [],
              },
              {
                slug: "tx-01-trends",
                view: "trends",
                widgetCount: 2,
                boundPoints: 2,
                omittedFeatured: 0,
                resolutions: [],
              },
            ],
          },
        ],
      }),
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Create default dashboards" }));

  expect(await screen.findByText(/tx-01-overview/)).toHaveTextContent("10 omitted");
  expect(screen.getByText(/tx-01-trends/)).not.toHaveTextContent("omitted");
}

/**
 * ADR 0067 Q5 — the dialog stays open on success, prints the four counts, and
 * offers Close.
 *
 * The three assertions after the sentence are the ones that make this more than
 * a wording check: **Build is gone**, so the result state cannot be clicked
 * into a second batch of assets (the affordance that did not exist while the
 * dialog closed on success), and Close is present, so the dialog is escapable.
 */
export async function theInstantiateDialogStaysOpenAndShowsTheSummary(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateFromAdminAssetTemplate: () =>
      Promise.resolve({
        templateId: TEMPLATE_ID,
        templateCode: "electrical-feeder",
        templateVersion: 1,
        locationId: LOCATION_ID,
        rtuId: null,
        sourceKind: "unmapped",
        assets: [],
        assetCount: 2,
        pointCount: 8,
        ruleCount: 3,
        disabledRuleCount: 1,
        dashboardCount: 2,
      }),
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));

  // `HierarchyFilterBar` renders its selects unlabelled, and the Details tab
  // behind the dialog renders comboboxes of its own — taking "the first
  // combobox" found the domain picker instead. The location select is the one
  // holding the location's own option, so it is reached through that.
  const locationOption = await screen.findByRole("option", { name: "West Campus" });
  await userEvent.selectOptions(locationOption.closest("select")!, LOCATION_ID);
  await userEvent.type(screen.getByLabelText("Asset 1 code"), "TX-01");
  await userEvent.click(screen.getByRole("button", { name: /^Build 1 asset$/ }));

  expect(
    await screen.findByText("Built 2 assets · 8 points · 3 rules · 2 dashboards"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Build/ })).not.toBeInTheDocument();
}
