import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AssetDomainDto, StockAssetTemplateDto } from "@bms/shared";

import * as api from "../../api/admin/asset-templates";
import * as orgApi from "../../api/admin/organizations";
import * as vocabApi from "../../api/vocabularies";
import { StockCatalogAccordion } from "../../components/asset-templates/stock-catalog-accordion";
import { STOCK_CATALOG_COLLAPSE_KEY } from "../../lib/stock-catalog-collapse";
import { groupStockByDomain } from "../../lib/stock-catalog-groups";
import type { AuthUser } from "../../stores/auth-store";
import { AssetTemplatesAdminPage } from "./asset-templates-page";

/**
 * `F2.13` — the asset templates list page imports from the stock catalog
 * (ADR 0052 decision 10), rendered (ADR 0042). The first `.spec.tsx` for this
 * page; model: `dashboard-templates-page.spec.tsx`.
 *
 * `F2.17` adds the domain accordion cases below the original five. Every one
 * of those opens on a `findByRole` for a *labelled* heading, never a sync
 * query: the entries ride `stockQ` and the labels ride `vocabQ`, so there is
 * a render in between where `groupStockByDomain` has no vocabulary yet and
 * the heading still reads the bare domain code.
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

/**
 * `F2.17` fixtures. Two properties are load-bearing and both are deliberate:
 *
 * 1. **The catalog order is not the vocabulary order.** `water` comes first in
 *    `items`, `electrical` first by `sortOrder`. A component that simply
 *    rendered the groups in arrival order would pass a fixture where the two
 *    agree.
 * 2. **The labels are not derivable from the codes** — `water` is "Water
 *    treatment", not "Water". A title-casing shortcut or a hand-kept
 *    code->label map in the component would pass a lazier fixture and fail
 *    these, which is the point: the label must come from the vocabulary.
 */
type StockSeed = { code: string; name: string; domain: string };

function stockEntry(seed: StockSeed) {
  return {
    code: seed.code,
    name: seed.name,
    assetType: "feeder",
    domain: seed.domain,
    description: null,
    stockVersion: 1,
    content: { contentVersion: 1, alarms: [] },
    points: [{ pointKey: "kw" }],
  };
}

const GROUPED_STOCK = {
  items: [
    stockEntry({ code: "water-clarifier", name: "Clarifier", domain: "water" }),
    stockEntry({ code: "electrical-feeder", name: "Feeder", domain: "electrical" }),
    stockEntry({ code: "electrical-ups", name: "UPS", domain: "electrical" }),
  ],
};

/** The same catalog plus one entry whose domain the vocabulary does not carry. */
const UNKNOWN_DOMAIN_STOCK = {
  items: [
    ...GROUPED_STOCK.items,
    stockEntry({ code: "hydraulics-pump", name: "Hydraulic pump", domain: "hydraulics" }),
  ],
};

const GROUPED_VOCABULARIES = {
  ...VOCABULARIES,
  assetDomains: [
    { code: "electrical", label: "Electrical plant", sortOrder: 1, active: true },
    { code: "water", label: "Water treatment", sortOrder: 2, active: true },
  ],
};

const ELECTRICAL_HEADING = "Electrical plant · 2 entries";
/** Singular. The count of one must not read "1 entries". */
const WATER_HEADING = "Water treatment · 1 entry";
/** Every accordion heading, and nothing else on the page. */
const ANY_HEADING = /· \d+ entr(y|ies)$/;

function stubApi(stock: unknown = STOCK, vocabularies: unknown = VOCABULARIES): void {
  vi.spyOn(api, "fetchAdminAssetTemplates").mockResolvedValue({ items: [] } as never);
  vi.spyOn(api, "fetchAdminStockAssetTemplates").mockResolvedValue(stock as never);
  vi.spyOn(api, "importAdminStockAssetTemplate").mockResolvedValue(IMPORTED_DRAFT as never);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGS as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(vocabularies as never);
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
  // `F2.17` widened `vocabQ`'s `enabled` from `modalOpen && mayAuthor` to
  // `mayAuthor`, because the group headings read their labels from that same
  // payload. It must still fetch nothing for a role that cannot author.
  expect(vocabApi.fetchVocabularies).not.toHaveBeenCalled();
}

/**
 * `F2.17` — the catalog renders one heading per domain PRESENT in the
 * response, in the vocabulary's `sortOrder`, labelled from the vocabulary.
 *
 * The call count is part of the claim. Widening `vocabQ`'s `enabled` must not
 * become a second fetch of the payload ADR 0038 decision 2 already shares —
 * the modal is never opened here and `fetchVocabularies` runs exactly once.
 */
export async function stockEntriesAreGroupedByDomainInVocabularyOrder(): Promise<void> {
  stubApi(GROUPED_STOCK, GROUPED_VOCABULARIES);
  renderPage();

  await screen.findByRole("button", { name: ELECTRICAL_HEADING });

  const headings = screen.getAllByRole("button", { name: ANY_HEADING });
  expect(headings).toHaveLength(2);
  // Document order. `water` is first in the response and second by `sortOrder`.
  expect(headings[0]).toHaveAccessibleName(ELECTRICAL_HEADING);
  expect(headings[1]).toHaveAccessibleName(WATER_HEADING);
  expect(headings[0]).toHaveAttribute("aria-expanded", "true");
  expect(headings[1]).toHaveAttribute("aria-expanded", "true");

  const electricalList = screen.getByRole("list", { name: "Electrical plant entries" });
  expect(within(electricalList).getAllByRole("link", { name: /^View / })).toHaveLength(2);
  const waterList = screen.getByRole("list", { name: "Water treatment entries" });
  expect(within(waterList).getAllByRole("link", { name: /^View / })).toHaveLength(1);

  expect(screen.queryByRole("heading", { name: "New template" })).toBeNull();
  expect(vocabApi.fetchVocabularies).toHaveBeenCalledTimes(1);
}

/**
 * `F2.17` — a domain the vocabulary does not carry (a deployment skew, or a
 * domain pack seeded ahead of this build) still gets a heading, still reads
 * the bare code rather than "Other", sorts after every known domain, and
 * keeps both of its row affordances.
 *
 * Dropping such an entry silently is the failure this case exists to catch:
 * an unstyled heading is a far smaller harm than a catalog row nobody can see.
 */
export async function anEntryWhoseDomainIsNotInTheVocabularyRendersUnderAFallbackHeading(): Promise<void> {
  stubApi(UNKNOWN_DOMAIN_STOCK, GROUPED_VOCABULARIES);
  renderPage();

  await screen.findByRole("button", { name: ELECTRICAL_HEADING });

  const headings = screen.getAllByRole("button", { name: ANY_HEADING });
  expect(headings).toHaveLength(3);
  expect(headings[headings.length - 1]).toHaveAccessibleName("hydraulics · 1 entry");

  const fallbackList = screen.getByRole("list", { name: "hydraulics entries" });
  expect(
    within(fallbackList).getByRole("link", { name: "View Hydraulic pump" }),
  ).toHaveAttribute("href", "/admin/asset-templates/stock/hydraulics-pump");
  expect(
    within(fallbackList).getByRole("button", { name: "Import Hydraulic pump" }),
  ).toBeInTheDocument();
}

/**
 * `F2.17` — collapsing unmounts that group's rows and nothing else. The card,
 * its organization picker and every other group survive, which is the whole
 * difference between an accordion and a filter.
 */
export async function aCollapsedGroupHidesItsRowsWithoutUnmountingTheCard(): Promise<void> {
  stubApi(GROUPED_STOCK, GROUPED_VOCABULARIES);
  renderPage();

  const electrical = await screen.findByRole("button", { name: ELECTRICAL_HEADING });
  expect(screen.getByText("electrical-feeder · electrical · stock v1")).toBeInTheDocument();

  await userEvent.click(electrical);

  expect(electrical).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("list", { name: "Electrical plant entries" })).toBeNull();
  expect(screen.queryByText("electrical-feeder · electrical · stock v1")).toBeNull();
  expect(screen.queryByText("electrical-ups · electrical · stock v1")).toBeNull();

  expect(screen.getByText("Stock catalog")).toBeInTheDocument();
  expect(
    screen.getByRole("combobox", { name: "Import into organization" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: WATER_HEADING })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByText("water-clarifier · water · stock v1")).toBeInTheDocument();

  await userEvent.click(electrical);
  expect(electrical).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("electrical-feeder · electrical · stock v1")).toBeInTheDocument();
}

/**
 * `F2.17` — the collapse survives a full remount, through the one key
 * `stock-catalog-collapse.ts` owns. The stored value is the COLLAPSED set, so
 * the untouched group is absent from it and comes back open.
 */
export async function collapseStateIsRememberedForTheNextVisit(): Promise<void> {
  stubApi(GROUPED_STOCK, GROUPED_VOCABULARIES);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: ELECTRICAL_HEADING }));
  expect(window.localStorage.getItem(STOCK_CATALOG_COLLAPSE_KEY)).toBe('["electrical"]');

  cleanup();
  renderPage();

  expect(await screen.findByRole("button", { name: ELECTRICAL_HEADING })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(screen.getByRole("button", { name: WATER_HEADING })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
}

/**
 * `F2.17` — a browser that refuses storage renders every group OPEN, and a
 * click still toggles in memory.
 *
 * **The ACCESSOR throws here, not `getItem`.** A sandboxed iframe or a locked
 * -down profile throws on `window.localStorage` itself, which a `try` around
 * `getItem` alone would never see.
 *
 * **This one case mounts the accordion, not the page, and that is not a
 * shortcut.** `app-shell.tsx:102-107` reads `window.localStorage.getItem`
 * unguarded in a `useState` initializer, and `MasterDataLayout` renders
 * `AppShell` above this card — so under a throwing accessor the page itself
 * throws "The operation is insecure." before the accordion ever mounts. A
 * page-level version of this claim would be asserting a render that
 * production cannot produce. The accordion's fail-open is a property of the
 * accordion, so the accordion is what this mounts. (`app-shell.tsx` is left
 * alone deliberately — `stock-catalog-collapse.ts`'s docblock records why.)
 */
export async function aBlockedStoreRendersEveryGroupOpen(): Promise<void> {
  const groups = groupStockByDomain(
    GROUPED_STOCK.items as unknown as StockAssetTemplateDto[],
    GROUPED_VOCABULARIES.assetDomains as unknown as AssetDomainDto[],
  );
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  });

  render(
    <StockCatalogAccordion
      groups={groups}
      renderEntry={(entry) => (
        <li>
          {entry.code} · {entry.domain} · stock v{entry.stockVersion}
        </li>
      )}
    />,
  );

  const electrical = screen.getByRole("button", { name: ELECTRICAL_HEADING });
  const water = screen.getByRole("button", { name: WATER_HEADING });
  expect(electrical).toHaveAttribute("aria-expanded", "true");
  expect(water).toHaveAttribute("aria-expanded", "true");

  await userEvent.click(electrical);

  expect(electrical).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("electrical-feeder · electrical · stock v1")).toBeNull();
  expect(water).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("water-clarifier · water · stock v1")).toBeInTheDocument();
}
