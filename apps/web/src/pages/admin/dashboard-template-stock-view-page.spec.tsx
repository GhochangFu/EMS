import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { expect, vi } from "vitest";

import { stockDashboardTemplateDtoSchema } from "@bms/shared/contracts";
import type { StockDashboardTemplateDto } from "@bms/shared";

import * as api from "../../api/admin/dashboard-templates";
import * as orgApi from "../../api/admin/organizations";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { DashboardTemplateStockViewPage } from "./dashboard-template-stock-view-page";

/**
 * `F3.44` — the read-only viewer for one stock dashboard-template entry (ADR
 * 0049 decision 3). Assertions live here;
 * `dashboard-template-stock-view-page.test.tsx` is the Vitest entry point
 * (ADR 0014), and it carries `@vitest-environment jsdom` because that is the
 * file Vitest collects (ADR 0042 decision 2).
 *
 * **What this file exists to hold.** The viewer renders repository data through
 * the same `DashboardCanvas` + `WidgetEditor` the authoring detail page uses,
 * with `editable={false}`. The thing that can silently stop being true is that
 * `false`: `WidgetEditor` keeps *Remove*, the binding `×` and the
 * `AssetRoleBindingPicker` under `{editable ? … : null}`, so a flipped flag
 * puts three writable controls on a screen with no save path. Case 1 is built
 * for that, with the ten widget keys and the `meter · kw` binding as the
 * positive control so an absence list cannot pass on an empty render.
 *
 * The fixtures are parsed through `stockDashboardTemplateDtoSchema`, so they
 * are real `StockDashboardTemplateDto`s rather than hand-typed lookalikes.
 * `PUMPING` mirrors `electrical-metered-pumping`'s measured shape in what the
 * editor renders (ten widgets, eight bound) and `NO_BINDINGS` mirrors
 * `sustainability-overview` (four widgets, zero bindings) — the zero-binding
 * edge every metric-catalog-only entry has. The fixtures carry one `sources`
 * entry per widget; the live entries carry four for the whole entry. The
 * difference is inert here because `WidgetEditor` renders no `sources`
 * (`F3.61`); the fixture carries them only so a widget is not a bare tile.
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
const PUMPING_CODE = "electrical-metered-pumping";
const PUMPING_NAME = "Electrical — Metered Pumping";
const PUMPING_WIDGET_COUNT = 10;
const NO_BINDINGS_CODE = "sustainability-overview";
const NO_BINDINGS_NAME = "Sustainability overview";
const NO_BINDINGS_WIDGET_COUNT = 4;

/** The five fields `WidgetEditor` renders per widget: Title and the four grid inputs. */
const INPUTS_PER_WIDGET = 5;

/**
 * One `value_tile` widget. Four per row of the 12-column canvas, so
 * `gridX + gridW` never crosses the `superRefine` bound. `bound` adds one
 * role binding; every widget carries one metric-catalog source, which the
 * editor does not render (`F3.61`).
 */
function stockWidget(index: number, bound: boolean): unknown {
  return {
    key: `w${index}`,
    title: `Widget ${index}`,
    widgetType: "value_tile",
    config: {},
    gridX: (index % 4) * 3,
    gridY: Math.floor(index / 4) * 2,
    gridW: 3,
    gridH: 2,
    bindings: bound
      ? [{ assetRoleCode: index === 3 ? "meter" : "pump", pointKey: index === 3 ? "kw" : `p${index}`, pointRole: "primary", sortOrder: 0 }]
      : [],
    sources: [{ catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }],
  };
}

const PUMPING: StockDashboardTemplateDto = stockDashboardTemplateDtoSchema.parse({
  code: PUMPING_CODE,
  name: PUMPING_NAME,
  section: "electrical",
  description: "Metered pumping with dosing and the alarms table.",
  stockVersion: 1,
  content: {
    // Eight bound out of ten — w0 and w9 are the unbound pair, so the last
    // widget renders with an empty list and still has to be on screen.
    widgets: Array.from({ length: PUMPING_WIDGET_COUNT }, (_unused, index) =>
      stockWidget(index, index !== 0 && index !== 9),
    ),
  },
});

const NO_BINDINGS: StockDashboardTemplateDto = stockDashboardTemplateDtoSchema.parse({
  code: NO_BINDINGS_CODE,
  name: NO_BINDINGS_NAME,
  section: "sustainability",
  description: null,
  stockVersion: 1,
  content: {
    widgets: Array.from({ length: NO_BINDINGS_WIDGET_COUNT }, (_unused, index) =>
      stockWidget(index, false),
    ),
  },
});

/**
 * No live entry has zero widgets; the branch exists because the contract
 * allows it, and case 3b keeps it from rotting (review Q2).
 */
const NO_WIDGETS_CODE = "empty-overview";
const NO_WIDGETS: StockDashboardTemplateDto = stockDashboardTemplateDtoSchema.parse({
  code: NO_WIDGETS_CODE,
  name: "Empty overview",
  section: "sustainability",
  description: null,
  stockVersion: 1,
  content: { widgets: [] },
});

const IMPORTED_DRAFT = {
  id: DRAFT_ID,
  organizationId: "org-1",
  code: PUMPING_CODE,
  version: 1,
  name: PUMPING_NAME,
  section: "electrical",
  description: null,
  status: "draft",
  content: { widgets: [] },
  publishedAt: null,
  archivedAt: null,
  stockCode: PUMPING_CODE,
  stockVersion: 1,
  createdBy: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const ORGS = { items: [{ id: "org-1", code: "IX", name: "Ion Exchange" }] };

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [{ code: "meter", label: "Meter", description: null, sortOrder: 10, active: true }],
  dashboardSections: [],
};

/**
 * The vocabulary fetch is stubbed even though `editable={false}` never issues
 * it: the picker is what an `editable={true}` mutation renders, and the proof
 * that case 1 reaches its target must redden on the `Asset role` combobox, not
 * on an unstubbed fetch.
 */
function stubApi(entries: readonly StockDashboardTemplateDto[] = [PUMPING]): void {
  vi.spyOn(api, "fetchAdminStockDashboardTemplates").mockResolvedValue({ items: entries } as never);
  vi.spyOn(api, "importAdminStockDashboardTemplate").mockResolvedValue(IMPORTED_DRAFT as never);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGS as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
}

/** Where a successful import must land — §5.5, "landing on the new draft". */
function DraftLanding() {
  const { templateId } = useParams();
  return <div>landed on draft {templateId}</div>;
}

function renderViewer(path: string, user: AuthUser = admin): HTMLElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/admin/dashboard-templates/stock/:code"
            element={<DashboardTemplateStockViewPage user={user} />}
          />
          <Route path="/admin/dashboard-templates/:templateId" element={<DraftLanding />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return container;
}

const IMPORT_ORG_LABEL = "Import into organization";
const READ_ONLY_PILL = "Stock catalog · read only";

/**
 * Every button the authoring detail page can render and this page must not.
 * The last two are `DashboardCanvas`'s drag handles: it renders them only
 * when it is given `onArrange`, and the viewer must never pass one — a later
 * `onArrange={…}` would put two drag affordances on a read-only screen with
 * every other case still green (review F1).
 */
const AUTHORING_BUTTONS = [
  "Save canvas",
  "Publish",
  "Archive",
  "Delete draft",
  "Instantiate",
  "Edit this version",
  "Add widget",
  "Remove",
  "Move widget",
  "Resize widget",
] as const;

function canvasCard(): HTMLElement {
  const card = screen.getByRole("heading", { name: "Canvas" }).closest("section");
  if (!card) throw new Error("the Canvas card did not render");
  return card;
}

/**
 * Case 1 — every widget renders, every field is disabled, and no writable
 * control exists. `w9` catches truncation; the input-count floor keeps the
 * disabled sweep from passing on an empty card; the binding text and the ten
 * keys are the positive control for the absence list.
 */
export async function everyWidgetRendersDisabledWithNoWritableControl(): Promise<void> {
  stubApi();
  renderViewer(`/admin/dashboard-templates/stock/${PUMPING_CODE}`);

  await screen.findByText(PUMPING_NAME);
  const card = canvasCard();
  await waitFor(() => {
    expect(within(card).getByText("w9")).toBeInTheDocument();
  });
  expect(within(card).getByText("w0")).toBeInTheDocument();
  expect(within(card).getByText("meter · kw")).toBeInTheDocument();

  // The absence list first, then the disabled sweep. `expect` throws on the
  // first failure, so the order decides which claim an `editable={true}`
  // mutation reddens: measured, `Remove` (this list) and the sweep below each
  // go red on that mutation when placed first.
  for (const name of AUTHORING_BUTTONS) {
    expect(
      screen.queryByRole("button", { name }),
      `the "${name}" control rendered on the stock viewer`,
    ).toBeNull();
  }
  expect(screen.queryByRole("button", { name: /^Remove binding/ })).toBeNull();
  expect(
    screen.queryByRole("combobox", { name: "Asset role" }),
    "the AssetRoleBindingPicker rendered — WidgetEditor's `editable` is no longer false",
  ).toBeNull();

  const inputs = [...card.querySelectorAll<HTMLInputElement>("input")];
  expect(
    inputs.length,
    "the Canvas card rendered too few inputs for the disabled sweep to mean anything",
  ).toBeGreaterThanOrEqual(PUMPING_WIDGET_COUNT * INPUTS_PER_WIDGET);
  expect(
    inputs.filter((input) => !input.disabled).map((input) => input.value),
    "a field on the read-only stock viewer accepts input. There is no save path on this " +
      "screen — ADR 0049 decision 3 makes the catalog repository data.",
  ).toEqual([]);
}

/** Case 2 — the header names the entry: name, code, stock version, count, pill, description. */
export async function theHeaderNamesTheEntry(): Promise<void> {
  stubApi();
  renderViewer(`/admin/dashboard-templates/stock/${PUMPING_CODE}`);

  // The subtitle is several text nodes (`stock v` + `1`), so the claims are
  // made on the page header's textContent rather than on one text node each.
  // The page header is the `<header>` that owns the `h1`; the layout's own
  // `<header>` (the brand bar) is not it.
  const heading = await screen.findByRole("heading", { level: 1, name: PUMPING_NAME });
  const header = heading.closest("header");
  if (!header) throw new Error("the page header did not render");
  const text = header.textContent ?? "";
  expect(text).toContain(PUMPING_CODE);
  expect(text).toContain("stock v1");
  expect(text).toContain(`${PUMPING_WIDGET_COUNT} widgets`);
  // `electrical` alone is satisfied by the eyebrow's code; the section claim
  // is the subtitle's `section · stock vN` pair (review F3).
  expect(text).toContain("electrical · stock v1");
  expect(screen.getByText(READ_ONLY_PILL)).toBeInTheDocument();
  expect(screen.getByText(PUMPING.description as string)).toBeInTheDocument();
}

/**
 * Case 3 — the zero-binding entry renders: four keys, four `Bindings` labels,
 * and no binding row under any of them. The keys are the positive control.
 */
export async function theZeroBindingEntryRenders(): Promise<void> {
  stubApi([NO_BINDINGS]);
  renderViewer(`/admin/dashboard-templates/stock/${NO_BINDINGS_CODE}`);

  await screen.findByText(NO_BINDINGS_NAME);
  const card = canvasCard();
  await waitFor(() => {
    expect(within(card).getByText(`w${NO_BINDINGS_WIDGET_COUNT - 1}`)).toBeInTheDocument();
  });
  for (let index = 0; index < NO_BINDINGS_WIDGET_COUNT; index += 1) {
    expect(within(card).getByText(`w${index}`)).toBeInTheDocument();
  }
  expect(within(card).getAllByText("Bindings")).toHaveLength(NO_BINDINGS_WIDGET_COUNT);
  expect(
    within(card).queryAllByText(/ · /),
    "a binding row rendered for an entry that carries no bindings",
  ).toHaveLength(0);
}

/**
 * Case 3b — the zero-widget entry renders the empty-state sentence and no
 * editor. The header's `0 widgets` is the positive control that the entry
 * resolved; the absent `Bindings` label is the claim.
 */
export async function theZeroWidgetEntryRendersTheEmptyState(): Promise<void> {
  stubApi([NO_WIDGETS]);
  renderViewer(`/admin/dashboard-templates/stock/${NO_WIDGETS_CODE}`);

  const heading = await screen.findByRole("heading", { level: 1, name: "Empty overview" });
  expect(heading.closest("header")?.textContent ?? "").toContain("0 widgets");
  const card = canvasCard();
  expect(within(card).getByText("This template has no widgets.")).toBeInTheDocument();
  expect(within(card).queryAllByText("Bindings")).toHaveLength(0);
}

/**
 * Case 4 — Import lands on the new draft (§5.5). The assertion on the call is
 * a call-shape check (`(code, organizationId)`), not a proof that the resolved
 * code is sent rather than the URL parameter: `findStockEntry` matches on
 * strict equality, so on every branch where Import renders the two strings
 * are identical and no test can tell them apart (review F2). That property
 * holds by construction of the lookup, and the page docblock says so.
 */
export async function importLandsOnTheNewDraft(): Promise<void> {
  stubApi();
  renderViewer(`/admin/dashboard-templates/stock/${PUMPING_CODE}`);

  await screen.findByText(PUMPING_NAME);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: IMPORT_ORG_LABEL }), "org-1");
  await userEvent.click(screen.getByRole("button", { name: `Import ${PUMPING_NAME}` }));

  await waitFor(() => {
    expect(api.importAdminStockDashboardTemplate).toHaveBeenCalledWith(PUMPING_CODE, "org-1");
  });
  expect(await screen.findByText(`landed on draft ${DRAFT_ID}`)).toBeInTheDocument();
}

/** Case 5 — the card's rule, restated because this is a different component. */
export async function importIsDisabledUntilAnOrganizationIsChosen(): Promise<void> {
  stubApi();
  renderViewer(`/admin/dashboard-templates/stock/${PUMPING_CODE}`);

  await screen.findByText(PUMPING_NAME);
  const importButton = screen.getByRole("button", { name: `Import ${PUMPING_NAME}` });
  expect(importButton).toBeDisabled();

  await userEvent.selectOptions(screen.getByRole("combobox", { name: IMPORT_ORG_LABEL }), "org-1");
  expect(importButton).not.toBeDisabled();
}

/**
 * Case 6 — the lookup is the validation (§5.3). An absent code is a panel that
 * names it, cut to 64 characters: positive on the prefix, negative on the whole.
 */
export async function anUnknownCodeRendersTheNotFoundPanel(): Promise<void> {
  stubApi();
  const longCode = "x".repeat(40) + "-not-a-real-code-" + "y".repeat(43);
  expect(longCode).toHaveLength(100);
  renderViewer(`/admin/dashboard-templates/stock/${longCode}`);

  const panel = await screen.findByText(/carries no entry/);
  expect(panel.textContent).toContain(longCode.slice(0, 64));
  expect(
    panel.textContent,
    "the not-found panel echoed the whole URL parameter — the 64-character cut is gone",
  ).not.toContain(longCode);
  expect(screen.getByRole("link", { name: /all templates/i })).toHaveAttribute(
    "href",
    "/admin/dashboard-templates",
  );
  expect(screen.queryByRole("heading", { name: "Canvas" })).toBeNull();
}

/**
 * Case 7 — the inverse of F2.14's refusal case (§5.4). The server admits
 * `location_admin` to the stock list, so the viewer reads the canvas for that
 * role and hides only the picker and Import; the organizations fetch is not
 * issued at all.
 */
export async function aLocationAdminReadsTheCanvasAndGetsNoImport(): Promise<void> {
  stubApi();
  renderViewer(`/admin/dashboard-templates/stock/${PUMPING_CODE}`, locationAdmin);

  await screen.findByText(PUMPING_NAME);
  const card = canvasCard();
  await waitFor(() => {
    expect(within(card).getByText("w9")).toBeInTheDocument();
  });
  for (let index = 0; index < PUMPING_WIDGET_COUNT; index += 1) {
    expect(within(card).getByText(`w${index}`)).toBeInTheDocument();
  }
  expect(api.fetchAdminStockDashboardTemplates).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /^Import / })).toBeNull();
  expect(screen.queryByRole("combobox", { name: IMPORT_ORG_LABEL })).toBeNull();
  expect(
    orgApi.fetchAdminOrganizations,
    "the viewer fetched organizations for a role that cannot import",
  ).not.toHaveBeenCalled();
}

/** Case 8 — a failed catalog fetch renders the error text and the back link. */
export async function aFailedCatalogFetchRendersTheError(): Promise<void> {
  stubApi();
  vi.spyOn(api, "fetchAdminStockDashboardTemplates").mockRejectedValue(new Error("boom"));
  renderViewer(`/admin/dashboard-templates/stock/${PUMPING_CODE}`);

  expect(await screen.findByText(/boom/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /all templates/i })).toHaveAttribute(
    "href",
    "/admin/dashboard-templates",
  );
  expect(screen.queryByRole("heading", { name: "Canvas" })).toBeNull();
}
