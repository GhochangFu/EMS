import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { LocationKpiSummary, ResolvedSiteControlRoomViewDto, SiteLayoutReplacePreviewDto, UserRole } from "@bms/shared";

import * as replaceApi from "../../api/admin/site-layout-replace";
import * as assetsApi from "../../api/assets";
import * as controlRoomApi from "../../api/control-room";
import * as copilotApi from "../../api/copilot";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { resetWizardStore } from "../../stores/wizard-store";
import { ORG_A, site, USER } from "./organizations-page.spec";
import { ControlRoomSitePage } from "./site-page";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decision 8) — where the site page offers **Replace with this
 * version**: a master-data admin on a `dashboard` view that renders, when the preview says the view
 * is a template copy. An operator and a generated view never read the preview. The canvas, the
 * generated view and the dashboards list are mocked (their own suites); the wizard is real, its
 * preview a spy. Kept out of `site-page-site-layout.spec.tsx` for the 1000-line cap.
 */
vi.mock("../../components/control-room/site-dashboard-view", () => ({
  SiteDashboardView: ({ slug }: { slug: string }) => <div data-testid="site-dashboard-view" data-slug={slug} />,
}));

vi.mock("../../components/control-room/generated-site-view", () => ({
  GeneratedSiteView: () => <div data-testid="generated-site-view" />,
}));

vi.mock("../../components/control-room/scoped-dashboards-list", () => ({
  ScopedDashboardsList: () => <div data-testid="scoped-dashboards-list" />,
}));

const LOCATION_ID = "a1b2c3d4-0000-4000-8000-0000000000a1";
const SITE: LocationKpiSummary = site({ id: LOCATION_ID, name: "Lotapata", organization: ORG_A });

const DASHBOARD_VIEW: ResolvedSiteControlRoomViewDto = {
  locationId: LOCATION_ID,
  kind: "dashboard",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  dashboardSlug: "site-layout-lotapata",
  builtinKey: null,
  notice: null,
};

const GENERATED_VIEW: ResolvedSiteControlRoomViewDto = {
  ...DASHBOARD_VIEW,
  kind: "generated",
  dashboardId: null,
  dashboardSlug: null,
};

const PREVIEW: SiteLayoutReplacePreviewDto = {
  templateId: "55555555-5555-4555-8555-555555555555",
  templateCode: "pump-station-standard",
  version: 2,
  sites: [
    {
      locationId: LOCATION_ID,
      locationName: "Lotapata",
      held: {
        dashboardId: "22222222-2222-4222-8222-222222222222",
        templateId: "66666666-6666-4666-8666-666666666666",
        templateCode: "pump-station-standard",
        version: 1,
      },
      outcome: "replace",
      edits: { count: 0, lastEditedAt: null },
    },
  ],
};

const BUTTON = { name: "Replace with this version" } as const;

function renderPage(view: ResolvedSiteControlRoomViewDto, role: UserRole): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("a spec reached the network"))));
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: [SITE] });
  vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView").mockResolvedValue(view);
  vi.spyOn(replaceApi, "fetchSiteLayoutReplacePreview").mockResolvedValue(PREVIEW);
  const user = { ...USER, role } as AuthUser;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/control-room/site/${LOCATION_ID}`]}>
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<ControlRoomSitePage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export function cleanupSitePageReplace(): void {
  cleanup();
  resetWizardStore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

/** P1 — an admin and a location admin on a template copy see the button, beside the canvas. */
export async function aMasterDataAdminSeesReplaceOnACopy(): Promise<void> {
  for (const role of ["admin", "location_admin"] as const) {
    renderPage(DASHBOARD_VIEW, role);
    expect(await screen.findByRole("button", BUTTON), role).toBeInTheDocument();
    expect(screen.getByTestId("site-dashboard-view").getAttribute("data-slug")).toBe("site-layout-lotapata");
    expect(replaceApi.fetchSiteLayoutReplacePreview).toHaveBeenCalledWith(LOCATION_ID);
    cleanupSitePageReplace();
  }
}

/** P2 — an operator sees the canvas and no button, and the preview is never read. */
export async function anOperatorSeesNoReplace(): Promise<void> {
  renderPage(DASHBOARD_VIEW, "operator");
  expect(await screen.findByTestId("site-dashboard-view")).toBeInTheDocument();
  expect(screen.queryByRole("button", BUTTON)).toBeNull();
  expect(replaceApi.fetchSiteLayoutReplacePreview).not.toHaveBeenCalled();
}

/** P3 — a generated view (no copy) offers no Replace to an admin, and reads no preview. */
export async function aGeneratedViewOffersNoReplace(): Promise<void> {
  renderPage(GENERATED_VIEW, "admin");
  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  await waitFor(() => expect(controlRoomApi.fetchResolvedSiteControlRoomView).toHaveBeenCalled());
  expect(screen.queryByRole("button", BUTTON)).toBeNull();
  expect(replaceApi.fetchSiteLayoutReplacePreview).not.toHaveBeenCalled();
}
