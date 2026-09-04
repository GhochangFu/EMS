import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
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

/**
 * `F2.21` fixtures — four templates, two organizations, three domains, so no
 * single filter can be satisfied by returning everything or returning one row.
 *
 * `sortOrder` deliberately disagrees with alphabetical order on both the code
 * and the label, for the reason `stock-catalog-groups.spec.ts` records: a
 * picker that sorted by name would pass a lazier fixture.
 */
function listTemplate(seed: {
  code: string;
  domain: string;
  organizationId?: string;
  organizationCode?: string;
}): unknown {
  const organizationId = seed.organizationId ?? "org-1";
  return {
    id: `${organizationId}-${seed.code}`,
    organizationId,
    organizationCode: seed.organizationCode ?? "IX",
    organizationName: "Ion Exchange",
    code: seed.code,
    version: 1,
    name: `${seed.code} template`,
    assetType: "unit",
    domain: seed.domain,
    description: null,
    status: "draft",
    content: {},
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pointCount: 3,
  };
}

const FILTERABLE_TEMPLATES = {
  items: [
    listTemplate({ code: "CHILLER", domain: "hvac" }),
    listTemplate({ code: "TRF", domain: "electrical" }),
    listTemplate({
      code: "PUMP",
      domain: "hvac",
      organizationId: "org-2",
      organizationCode: "BETA",
    }),
    listTemplate({
      code: "RO",
      domain: "water",
      organizationId: "org-2",
      organizationCode: "BETA",
    }),
  ],
};

const FILTER_VOCABULARIES = {
  ...VOCABULARIES,
  assetDomains: [
    { code: "electrical", label: "Electrical plant", sortOrder: 1, active: true },
    { code: "water", label: "Water treatment", sortOrder: 2, active: true },
    { code: "hvac", label: "HVAC", sortOrder: 3, active: true },
  ],
};

function stubApi(
  stock: unknown = STOCK,
  vocabularies: unknown = VOCABULARIES,
  templates: unknown = { items: [] },
): void {
  vi.spyOn(api, "fetchAdminAssetTemplates").mockResolvedValue(templates as never);
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

/**
 * Renders the router's own search string beside the page, so a `?tab=` WRITE is
 * observable (`duplicate-dashboard-dialog.spec.tsx`'s `Elsewhere` idiom).
 *
 * `MemoryRouter` never touches `window.location`, so this is the only way to
 * see the write from a test — and without it, dropping `setSearchParams` while
 * keeping the read leaves every case in this file green.
 */
function SearchProbe() {
  const location = useLocation();
  return <p>search: {location.search}</p>;
}

/**
 * `F2.21` put the two lists on peer tabs, so the stock catalog no longer
 * renders on a bare `/admin/asset-templates`. Every stock assertion below
 * therefore opens the page at this entry instead.
 *
 * Deep-linking rather than clicking the tab is deliberate: it keeps each test
 * about the thing it was written for, and it exercises the `?tab=` resolver on
 * every one of them rather than only in the tab test.
 */
const STOCK_TAB = "/admin/asset-templates?tab=stock";

function renderPage(user: AuthUser = admin, entry = "/admin/asset-templates"): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/admin/asset-templates"
            element={
              <>
                <AssetTemplatesAdminPage user={user} />
                <SearchProbe />
              </>
            }
          />
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
  renderPage(admin, STOCK_TAB);

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
  renderPage(admin, STOCK_TAB);

  expect(await screen.findByText(/catalog is empty/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Import / })).toBeNull();
}

/** A failed import renders the sentence inside the Nest envelope, never the raw body. */
export async function failedImportRendersThroughApiErrorMessage(): Promise<void> {
  stubApi();
  const raw = '{"message":"Organization is outside your access scope","error":"Forbidden","statusCode":403}';
  vi.spyOn(api, "importAdminStockAssetTemplate").mockRejectedValue(new Error(raw));
  renderPage(admin, STOCK_TAB);

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
  renderPage(admin, STOCK_TAB);

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

/**
 * The card is not rendered at all for a role `canAuthorTemplates` refuses —
 * **even when the URL asks for it by name**.
 *
 * `F2.21` opens this at `?tab=stock` rather than at the bare path, because tabs
 * created a way to ask for the card that did not exist before: a `location_admin`
 * following an author's link. `resolveAssetTemplatesPageTab` falls back to
 * Templates, and the tab itself is never offered.
 *
 * The fallback earns its place, but not as a security control — the server
 * PERMITS a `location_admin` to list the catalog (`requireMasterDataUser`), and
 * `canAuthorTemplates` is deliberately narrower. What it prevents is a page with
 * no list at all: both cards are guarded, so without it this role would land on
 * a tab strip and nothing else.
 */
export async function cardIsAbsentForARoleThatCannotAuthor(): Promise<void> {
  stubApi();
  renderPage(locationAdmin, STOCK_TAB);

  // The templates list renders — the page is up — but no stock card.
  expect(await screen.findByText("No templates match this filter.")).toBeInTheDocument();
  expect(screen.queryByText("Stock catalog")).toBeNull();
  // The tab is not merely inert, it is not offered.
  expect(screen.queryByRole("tab", { name: /Stock catalog/ })).toBeNull();
  expect(screen.getByRole("tab", { name: /Templates/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.queryByRole("combobox", { name: "Import into organization" })).toBeNull();
  expect(api.fetchAdminStockAssetTemplates).not.toHaveBeenCalled();
  // `F2.17` asserted here that `fetchVocabularies` is NOT called for this role.
  // **`F2.21` reverses that deliberately, and the old assertion was load-bearing
  // enough to say why.** `F2.17`'s reason was that only the stock card needed
  // domain labels, and only an author sees it. This row gives the same payload a
  // second consumer — the Templates domain filter — which is not author-gated
  // and which a `location_admin` does see. Leaving the gate at `mayAuthor` made
  // that control read bare codes in a different order for this role than for an
  // author. The endpoint is `JwtAuthGuard` only.
  //
  // The count still matters: ADR 0038 decision 2 shares one query key, and this
  // must not become a second fetch of the same payload.
  expect(vocabApi.fetchVocabularies).toHaveBeenCalledTimes(1);
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
  renderPage(admin, STOCK_TAB);

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
  renderPage(admin, STOCK_TAB);

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
  renderPage(admin, STOCK_TAB);

  const electrical = await screen.findByRole("button", { name: ELECTRICAL_HEADING });
  expect(screen.getByText("electrical-feeder · electrical · stock v1")).toBeInTheDocument();

  await userEvent.click(electrical);

  expect(electrical).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("list", { name: "Electrical plant entries" })).toBeNull();
  expect(screen.queryByText("electrical-feeder · electrical · stock v1")).toBeNull();
  expect(screen.queryByText("electrical-ups · electrical · stock v1")).toBeNull();

  // `getByRole("heading")`, not `getByText` — `F2.21`'s tab strip renders the
  // words "Stock catalog" as well, so a bare text query now matches two nodes.
  // The card's own heading is what "not unmounted" means here.
  expect(screen.getByRole("heading", { name: "Stock catalog" })).toBeInTheDocument();
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
  renderPage(admin, STOCK_TAB);

  await userEvent.click(await screen.findByRole("button", { name: ELECTRICAL_HEADING }));
  expect(window.localStorage.getItem(STOCK_CATALOG_COLLAPSE_KEY)).toBe('["electrical"]');

  cleanup();
  renderPage(admin, STOCK_TAB);

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

/**
 * `F2.21` part 1 — the two lists are peers, and only one renders at a time.
 *
 * The negative half is the point. Before this row both cards were on screen at
 * once, so an assertion that the stock card is present would have passed
 * against the old page too. What is new is that selecting one list REMOVES the
 * other, and that the choice lands in the URL.
 */
export async function switchingTabsSwapsTheListAndRecordsItInTheUrl(): Promise<void> {
  stubApi(STOCK, VOCABULARIES, FILTERABLE_TEMPLATES);
  renderPage();

  // Templates first, and the stock card is not merely collapsed — it is absent.
  expect(await screen.findByRole("heading", { name: "Templates" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Stock catalog" })).toBeNull();
  expect(screen.getByRole("tab", { name: /Templates/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await userEvent.click(screen.getByRole("tab", { name: /Stock catalog/ }));

  expect(await screen.findByRole("heading", { name: "Stock catalog" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Templates" })).toBeNull();
  expect(screen.getByRole("tab", { name: /Stock catalog/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // The choice is WRITTEN to the URL, which is what makes "look at the
  // catalog" a link. Read through a probe inside the router, never
  // `window.location` — `MemoryRouter` keeps its history in memory and never
  // touches the document's URL, so a `window.location` assertion here would
  // pass against a page that wrote nothing.
  //
  // Without this, keeping the READ path and dropping the write is invisible:
  // the eleven stock cases deep-link through `initialEntries` and exercise only
  // the read, and this case's own headings would still swap off local state.
  expect(await screen.findByText("search: ?tab=stock")).toBeInTheDocument();

  // And back, so the strip is not a one-way door.
  await userEvent.click(screen.getByRole("tab", { name: /Templates/ }));
  expect(await screen.findByRole("heading", { name: "Templates" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Stock catalog" })).toBeNull();
  expect(await screen.findByText("search: ?tab=templates")).toBeInTheDocument();
}

/** The strip counts each list, so the reader knows what is behind the other tab. */
export async function eachTabShowsHowManyRowsItHolds(): Promise<void> {
  stubApi(STOCK, VOCABULARIES, FILTERABLE_TEMPLATES);
  renderPage();

  const templatesTab = await screen.findByRole("tab", { name: /Templates/ });
  await waitFor(() => {
    expect(within(templatesTab).getByText("4")).toBeInTheDocument();
  });
  // STOCK holds one entry; the count comes from the other list's own query, so
  // it is visible without opening that tab — which is the point of showing it.
  const stockTab = screen.getByRole("tab", { name: /Stock catalog/ });
  await waitFor(() => {
    expect(within(stockTab).getByText("1")).toBeInTheDocument();
  });
}

/**
 * `F2.21` part 2 — the two filters narrow the list, and the subtitle says what
 * it is narrowing out of.
 *
 * Checked in both directions on every step: the rows that should go are gone
 * AND the rows that should stay are still there. A one-sided version would pass
 * against a filter that simply emptied the list.
 */
export async function organizationAndDomainFiltersNarrowTheList(): Promise<void> {
  stubApi(STOCK, FILTER_VOCABULARIES, FILTERABLE_TEMPLATES);
  renderPage();

  expect(await screen.findByText("4 templates")).toBeInTheDocument();
  expect(screen.getByText("CHILLER")).toBeInTheDocument();
  expect(screen.getByText("RO")).toBeInTheDocument();

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Filter by organization" }),
    "org-2",
  );

  expect(await screen.findByText("showing 2 of 4 templates")).toBeInTheDocument();
  expect(screen.getByText("PUMP")).toBeInTheDocument();
  expect(screen.getByText("RO")).toBeInTheDocument();
  expect(screen.queryByText("CHILLER")).toBeNull();
  expect(screen.queryByText("TRF")).toBeNull();

  // The two filters intersect rather than replacing one another.
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Filter by domain" }),
    "water",
  );

  expect(await screen.findByText("showing 1 of 4 templates")).toBeInTheDocument();
  expect(screen.getByText("RO")).toBeInTheDocument();
  expect(screen.queryByText("PUMP")).toBeNull();

  // A combination nothing matches says so, and still reports the total.
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Filter by domain" }),
    "electrical",
  );
  expect(await screen.findByText("showing 0 of 4 templates")).toBeInTheDocument();
  expect(screen.getByText("No templates match this filter.")).toBeInTheDocument();
}

/**
 * The domain picker offers only the domains present, in the vocabulary's
 * `sortOrder`, and the organization picker offers only the organizations
 * present.
 *
 * `sortOrder` here is electrical(1), water(2), hvac(3) — neither the fixture's
 * order nor alphabetical by code or label.
 */
export async function pickersOfferOnlyWhatIsPresentInVocabularyOrder(): Promise<void> {
  stubApi(STOCK, FILTER_VOCABULARIES, FILTERABLE_TEMPLATES);
  renderPage();

  const domainSelect = await screen.findByRole("combobox", { name: "Filter by domain" });
  expect(
    within(domainSelect)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["All domains", "Electrical plant", "Water treatment", "HVAC"]);

  const orgSelect = screen.getByRole("combobox", { name: "Filter by organization" });
  expect(
    within(orgSelect)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["All organizations", "BETA", "IX"]);
}

/**
 * A picker that could only offer one value is not rendered.
 *
 * This is the location-scoped admin's case: their list holds one organization,
 * so an organization picker would be a control that cannot change anything.
 * The domain picker is still shown here, because two domains are present —
 * which is what stops this passing against a page that rendered no pickers.
 */
export async function aPickerWithASingleValueIsNotRendered(): Promise<void> {
  stubApi(STOCK, FILTER_VOCABULARIES, {
    items: [
      listTemplate({ code: "CHILLER", domain: "hvac" }),
      listTemplate({ code: "TRF", domain: "electrical" }),
    ],
  });
  renderPage();

  expect(await screen.findByText("2 templates")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Filter by organization" })).toBeNull();
  expect(screen.getByRole("combobox", { name: "Filter by domain" })).toBeInTheDocument();
}

/**
 * Searching until the selected domain has no templates clears that filter
 * rather than leaving a control that lies.
 *
 * Without the clamp the `<select>` holds a value with no matching `<option>`,
 * so a browser paints the first one — "All domains" — while the list is still
 * filtered to the vanished domain and shows nothing. The reader would see an
 * empty list, a search term that plainly matches, and no filter set.
 *
 * The last two assertions are what make this more than a screenshot: the row
 * that DOES match the search is on screen, and the subtitle no longer claims
 * anything is hidden.
 */
export async function aFilterWhoseOptionVanishesIsDropped(): Promise<void> {
  stubApi(STOCK, FILTER_VOCABULARIES, FILTERABLE_TEMPLATES);
  renderPage();

  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Filter by domain" }),
    "water",
  );
  expect(await screen.findByText("showing 1 of 4 templates")).toBeInTheDocument();
  expect(screen.getByText("RO")).toBeInTheDocument();

  // CHILLER is hvac, so the water option disappears from the picker entirely.
  await userEvent.type(screen.getByRole("textbox", { name: "Search templates" }), "CHILLER");

  expect(await screen.findByText("1 template")).toBeInTheDocument();
  expect(screen.getByText("CHILLER")).toBeInTheDocument();
  expect(screen.queryByText("No templates match this filter.")).toBeNull();
  // The picker is gone here, because one domain is left — and the stale `water`
  // must not still be filtering behind it.
  expect(screen.queryByRole("combobox", { name: "Filter by domain" })).toBeNull();
}

/**
 * A role that cannot author still gets a properly labelled domain filter.
 *
 * `F2.17` gated `vocabQ` on `mayAuthor`, because only the stock card needed
 * domain labels. The Templates domain filter is this payload's second consumer
 * and is NOT author-gated, so with the old gate a `location_admin` saw bare
 * codes in alphabetical order while an author saw vocabulary labels in
 * `sortOrder` — the same control reading differently for two roles.
 *
 * The order assertion is what makes this more than a spelling check: `sortOrder`
 * here is electrical(1), water(2), hvac(3), so an unlabelled fallback would sort
 * electrical, hvac, water and fail on position as well as on text.
 */
export async function aNonAuthorStillGetsLabelledDomainOptions(): Promise<void> {
  stubApi(STOCK, FILTER_VOCABULARIES, FILTERABLE_TEMPLATES);
  renderPage(locationAdmin);

  const domainSelect = await screen.findByRole("combobox", { name: "Filter by domain" });
  await waitFor(() => {
    expect(
      within(domainSelect)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All domains", "Electrical plant", "Water treatment", "HVAC"]);
  });

  // Still no stock card, and still no stock fetch — widening the vocabulary
  // gate must not have widened anything else.
  expect(screen.queryByRole("heading", { name: "Stock catalog" })).toBeNull();
  expect(api.fetchAdminStockAssetTemplates).not.toHaveBeenCalled();
}

/**
 * Every tab the strip offers renders a card when selected.
 *
 * This is the gap the resolver's own tests cannot see. `runVisibleTabsTests`
 * proves a visible tab resolves to ITSELF; it says nothing about whether the
 * page then renders anything for it. Widen the registry without widening the
 * page guard — `authorOnly: false` on stock, say — and a `location_admin`
 * selects Stock catalog, `tab === "stock" && mayAuthor` is false, and BOTH
 * cards are absent. A blank page under a selected tab, with the whole suite
 * green.
 *
 * Run for both roles, because the failure only appears for the role whose
 * visible set and page guards could disagree.
 */
export async function everyOfferedTabRendersACard(): Promise<void> {
  for (const [user, expected] of [
    [admin, ["Templates", "Stock catalog"]],
    [locationAdmin, ["Templates"]],
  ] as const) {
    stubApi(STOCK, FILTER_VOCABULARIES, FILTERABLE_TEMPLATES);
    renderPage(user);

    const offered = await screen.findAllByRole("tab");
    expect(offered.map((tab) => tab.textContent?.replace(/\d+$/, "").trim())).toEqual([
      ...expected,
    ]);

    for (const label of expected) {
      await userEvent.click(screen.getByRole("tab", { name: new RegExp(label) }));
      expect(
        await screen.findByRole("heading", { name: label }),
        `selecting the "${label}" tab must render a card, not an empty page`,
      ).toBeInTheDocument();
    }

    cleanup();
    vi.restoreAllMocks();
  }
}

/**
 * The strip shows the SELECTED tab's hint, not the first tab's.
 *
 * Nothing else reads hint text — the lib spec only asserts it is non-empty, and
 * the coverage gate stops at `lib/`, so the `.tsx` is unreachable by both. That
 * pairing is exactly why `const current = tabs[0]` would otherwise survive: the
 * stock tab would permanently show the Templates hint.
 */
export async function theStripShowsTheSelectedTabsHint(): Promise<void> {
  stubApi(STOCK, FILTER_VOCABULARIES, FILTERABLE_TEMPLATES);
  renderPage();

  expect(
    await screen.findByText("The templates this organization owns, newest version first."),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole("tab", { name: /Stock catalog/ }));

  expect(
    await screen.findByText(
      "Repository class templates every organization can import (ADR 0052).",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("The templates this organization owns, newest version first."),
  ).toBeNull();
}

/**
 * A tab holding zero rows shows `0`; a tab still loading shows no count at all.
 *
 * Both halves are needed. `count ? … : null` would hide a real zero, which
 * reads as "still loading"; dropping the `listQ.data ?` guard would show a
 * confident `0` before the list has arrived, which is the thing the strip's
 * docblock says the `undefined` exists to prevent.
 */
export async function aZeroCountRendersButAPendingOneDoesNot(): Promise<void> {
  stubApi(STOCK, FILTER_VOCABULARIES, { items: [] });
  renderPage();

  const templatesTab = await screen.findByRole("tab", { name: /Templates/ });
  await waitFor(() => {
    expect(within(templatesTab).getByText("0")).toBeInTheDocument();
  });

  cleanup();
  vi.restoreAllMocks();

  // Now a list that never arrives: the count must be absent, not `0`.
  stubApi(STOCK, FILTER_VOCABULARIES);
  vi.spyOn(api, "fetchAdminAssetTemplates").mockReturnValue(new Promise(() => {}) as never);
  renderPage();

  const pendingTab = await screen.findByRole("tab", { name: /Templates/ });
  expect(pendingTab.textContent).toBe("Templates");
}

/**
 * The group header prints the vocabulary's label, not the bare domain code.
 *
 * `F2.21` made this visible rather than introducing it: the new picker beside
 * the list prints "HVAC", so a header reading `hvac` meant filtering by a word
 * that appeared nowhere in the rows it kept.
 */
export async function theGroupHeaderPrintsTheDomainLabel(): Promise<void> {
  stubApi(STOCK, FILTER_VOCABULARIES, FILTERABLE_TEMPLATES);
  renderPage();

  expect(await screen.findByText("IX · unit · HVAC")).toBeInTheDocument();
  expect(screen.queryByText("IX · unit · hvac")).toBeNull();
}
