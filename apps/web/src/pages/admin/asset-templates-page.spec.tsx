import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/asset-templates";
import * as orgApi from "../../api/admin/organizations";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { AssetTemplatesAdminPage } from "./asset-templates-page";

/**
 * `F2.13` — the asset templates list page imports from the stock catalog
 * (ADR 0052 decision 10), rendered (ADR 0042). The first `.spec.tsx` for this
 * page; model: `dashboard-templates-page.spec.tsx`.
 *
 * Assertions live here; `asset-templates-page.test.tsx` is the Vitest entry
 * point (ADR 0014). Queries go by role and text (ADR 0042 decision 5).
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

/** `canAuthorTemplates` refuses `location_admin` — ADR 0015 §7. */
const locationAdmin: AuthUser = {
  id: "u2",
  email: "wc-admin@bms.local",
  displayName: "Location admin",
  role: "location_admin",
} as unknown as AuthUser;

const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

const STOCK = {
  items: [
    {
      code: "electrical-feeder",
      name: "Feeder / incomer — multifunction energy meter",
      assetType: "feeder",
      domain: "electrical",
      description: "Authored from docs/electrical-derived-taglist-v1.md §1.",
      stockVersion: 1,
      content: { contentVersion: 1, alarms: [] },
      points: [{ pointKey: "kw" }],
    },
  ],
};

const IMPORTED_DRAFT = {
  id: DRAFT_ID,
  organizationId: "org-1",
  organizationCode: "IX",
  organizationName: "Ion Exchange",
  code: "electrical-feeder",
  version: 1,
  name: "Feeder / incomer — multifunction energy meter",
  assetType: "feeder",
  domain: "electrical",
  description: null,
  status: "draft",
  content: {},
  publishedAt: null,
  archivedAt: null,
  stockCode: "electrical-feeder",
  stockVersion: 1,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  points: [],
};

const ORGS = {
  items: [{ id: "org-1", code: "IX", name: "Ion Exchange" }],
};

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
};

function stubApi(stock: unknown = STOCK): void {
  vi.spyOn(api, "fetchAdminAssetTemplates").mockResolvedValue({ items: [] } as never);
  vi.spyOn(api, "fetchAdminStockAssetTemplates").mockResolvedValue(stock as never);
  vi.spyOn(api, "importAdminStockAssetTemplate").mockResolvedValue(IMPORTED_DRAFT as never);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGS as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
}

/** Where a successful import must land — decision 10's "landing on the new draft". */
function DraftLanding() {
  const { id } = useParams();
  return <div>landed on draft {id}</div>;
}

function renderPage(user: AuthUser = admin): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/asset-templates"]}>
        <Routes>
          <Route path="/admin/asset-templates" element={<AssetTemplatesAdminPage user={user} />} />
          <Route path="/admin/asset-templates/:id" element={<DraftLanding />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const IMPORT_BUTTON = "Import Feeder / incomer — multifunction energy meter";

/**
 * The card renders the entry, Import stays disabled until an organization is
 * chosen, and the click calls the API with (code, organizationId) and lands on
 * the returned draft.
 */
export async function importsAStockEntryIntoTheChosenOrganization(): Promise<void> {
  stubApi();
  renderPage();

  expect(await screen.findByText("electrical-feeder · electrical · stock v1")).toBeInTheDocument();

  const importButton = screen.getByRole("button", { name: IMPORT_BUTTON });
  expect(importButton).toBeDisabled();

  const orgSelect = screen.getByRole("combobox", { name: "Import into organization" });
  await userEvent.selectOptions(orgSelect, "org-1");
  expect(importButton).not.toBeDisabled();

  await userEvent.click(importButton);
  await waitFor(() => {
    expect(api.importAdminStockAssetTemplate).toHaveBeenCalledWith("electrical-feeder", "org-1");
  });
  expect(await screen.findByText(`landed on draft ${DRAFT_ID}`)).toBeInTheDocument();
}

/** `{ items: [] }` renders the empty state and enables no Import. Keep this case. */
export async function emptyCatalogRendersTheEmptyState(): Promise<void> {
  stubApi({ items: [] });
  renderPage();

  expect(await screen.findByText(/catalog is empty/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Import / })).toBeNull();
}

/** A failed import renders the sentence inside the Nest envelope, never the raw body. */
export async function failedImportRendersThroughApiErrorMessage(): Promise<void> {
  stubApi();
  const raw = '{"message":"Organization is outside your access scope","error":"Forbidden","statusCode":403}';
  vi.spyOn(api, "importAdminStockAssetTemplate").mockRejectedValue(new Error(raw));
  renderPage();

  await screen.findByText("electrical-feeder · electrical · stock v1");
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Import into organization" }),
    "org-1",
  );
  await userEvent.click(screen.getByRole("button", { name: IMPORT_BUTTON }));

  expect(await screen.findByText("Organization is outside your access scope")).toBeInTheDocument();
  expect(screen.queryByText(raw)).toBeNull();
  expect(screen.queryByText(/statusCode/)).toBeNull();
}

/**
 * `F2.14` — each stock row links to the read-only viewer, beside Import.
 *
 * The card is a summary; the row's only affordance used to be "import it and
 * find out". The link is what lets an administrator read the whole entry —
 * 33 points and 11 alarms on the live feeder — before taking it. Import is
 * unchanged and still gated on an organization, which is what this case
 * re-checks alongside the link.
 */
export async function eachStockRowLinksToTheReadOnlyViewer(): Promise<void> {
  stubApi();
  renderPage();

  const view = await screen.findByRole("link", {
    name: "View Feeder / incomer — multifunction energy meter",
  });
  expect(
    view.getAttribute("href"),
    "the View link does not point at the viewer route registered in app.tsx.",
  ).toBe("/admin/asset-templates/stock/electrical-feeder");

  const importButton = screen.getByRole("button", { name: IMPORT_BUTTON });
  expect(importButton).toBeDisabled();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Import into organization" }),
    "org-1",
  );
  expect(importButton).not.toBeDisabled();
}

/** The card is not rendered at all for a role `canAuthorTemplates` refuses. */
export async function cardIsAbsentForARoleThatCannotAuthor(): Promise<void> {
  stubApi();
  renderPage(locationAdmin);

  // The templates list renders — the page is up — but no stock card.
  expect(await screen.findByText("No templates match this filter.")).toBeInTheDocument();
  expect(screen.queryByText("Stock catalog")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Import into organization" })).toBeNull();
  expect(api.fetchAdminStockAssetTemplates).not.toHaveBeenCalled();
}
