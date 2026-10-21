import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/dashboard-templates";
import * as groupsApi from "../../api/admin/asset-groups";
import * as locationsApi from "../../api/admin/locations";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import { resetWizardStore, useWizardStore } from "../../stores/wizard-store";
import { DashboardTemplateDetailPage } from "./dashboard-template-detail-page";
import * as copilotApi from "../../api/copilot";

/**
 * `F3.36` Part F — the section template detail screen, rendered (ADR 0042).
 *
 * Assertions live here; `dashboard-template-detail-page.test.tsx` is the
 * Vitest entry point (ADR 0014).
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

export const TEMPLATE_ID = "11111111-1111-1111-1111-111111111111";

export function draftTemplate() {
  return {
    id: TEMPLATE_ID,
    organizationId: "org-1",
    code: "ELECTRICAL",
    version: 1,
    name: "Electrical overview",
    section: "electrical",
    description: null,
    status: "draft",
    content: { widgets: [], tabs: [] },
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

export function publishedTemplate() {
  return {
    ...draftTemplate(),
    status: "published",
    publishedAt: new Date(0).toISOString(),
    content: {
      tabs: [],
      widgets: [
        {
          key: "w1",
          title: "Load",
          gridX: 0,
          gridY: 0,
          gridW: 4,
          gridH: 4,
          bindings: [{ assetRoleCode: "incoming-supply", pointKey: "kW", pointRole: "primary", sortOrder: 0 }],
          sources: [],
          widgetType: "value_tile",
          config: {},
        },
      ],
    },
  };
}

/** `E4.2` — the published fixture with its one binding removed. */
export function roleFreeTemplate() {
  return {
    ...publishedTemplate(),
    section: "sustainability",
    content: {
      tabs: [],
      widgets: [
        {
          ...publishedTemplate().content.widgets[0],
          bindings: [],
          sources: [{ catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }],
        },
      ],
    },
  };
}

/** Uuids: the instantiate wizard checks each step against the body schema (`F3.85` PR 10b). */
export const GROUP_ID = "22222222-2222-4222-8222-222222222222";
export const LOC_1 = "33333333-3333-4333-8333-333333333331";
export const LOC_2 = "33333333-3333-4333-8333-333333333332";

const GROUPS = { items: [{ id: GROUP_ID, name: "Electrical train", locationName: "Plant 1", memberCount: 2 }] };

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [{ code: "incoming-supply", label: "Incoming Supply", sortOrder: 10, active: true }],
  dashboardSections: [],
  waterBalanceRoles: [],
};

export function stubApi(overrides: Partial<Record<string, unknown>> = {}): void {
  // The layout's status read: unstubbed, it reaches a live API on :4000, whose 401 clears the session.
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(groupsApi, "fetchAdminAssetGroups").mockResolvedValue(GROUPS as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  for (const [name, impl] of Object.entries(overrides)) {
    vi.spyOn(api, name as keyof typeof api).mockImplementation(impl as never);
  }
}

/**
 * Where a successful delete must land (`F3.62`). A probe route rather than a
 * spy on `useNavigate`: the claim is that the SPA leaves the deleted row's
 * page, and only a rendered landing proves the router actually moved. The
 * same shape `dashboard-template-stock-view-page.spec.tsx`'s `DraftLanding`
 * uses for the import.
 */
const LIST_LANDING_TEXT = "landed on the template list";

function ListLanding() {
  return <div>{LIST_LANDING_TEXT}</div>;
}

export function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/dashboard-templates/${TEMPLATE_ID}`]}>
        <Routes>
          <Route path="/admin/dashboard-templates" element={<ListLanding />} />
          <Route
            path="/admin/dashboard-templates/:templateId"
            element={<DashboardTemplateDetailPage user={admin} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A draft offers Publish and Delete, and no Archive or Instantiate. */
export async function draftShowsPublishAndDelete(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()) });
  renderPage();

  expect(await screen.findByRole("button", { name: "Publish" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete draft" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Instantiate" })).not.toBeInTheDocument();
}

/** A published version offers Archive and Instantiate, and no Publish or Delete. */
export async function publishedShowsArchiveAndInstantiate(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage();

  expect(await screen.findByRole("button", { name: "Archive" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Instantiate" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete draft" })).not.toBeInTheDocument();
}

/** Adding a widget grows the canvas, and its role picker is vocabulary-fed. */
export async function addWidgetAddsAWidgetEditor(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()) });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Add widget" }));
  expect(await screen.findByRole("combobox", { name: "Asset role" })).toBeInTheDocument();
}

/**
 * `F3.61` — the round-trip through `updateWidget`: the component spec asserts
 * the patch `WidgetEditor` emits; this asserts the page's state took it and
 * re-rendered — the metric's own `×` is there, the role picker is gone (the
 * two kinds are exclusive, and the contract refuses both) and the metric is
 * listed by its label. The positive control is `findByRole` on the `×`
 * button, not `findByText` on the label: `MetricSourcePicker`'s own
 * `<option>Active alarms</option>` renders the label text before the add, so
 * `findByText("Active alarms")` resolves at once and is not a live control
 * (measured: dropping `sources` from `updateWidget`'s patch does not redden
 * it — the failure lands on the role-picker absence instead). The `×`
 * button's aria-label only exists once the state update lands a bound
 * source, so it is what the state change actually produces.
 */
export async function addingAMetricListsItAndHidesTheRolePicker(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()) });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Add widget" }));
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Add named metric" }),
    "alarms.active.count",
  );

  expect(
    await screen.findByRole("button", { name: "Remove metric Active alarms" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Asset role" }),
    "the role picker stayed on screen beside a bound metric",
  ).toBeNull();
  expect(screen.getByText("Active alarms")).toBeInTheDocument();
}

/**
 * `F3.62` — a successful `Delete draft` leaves the deleted row's page and lands
 * on the list. Before the fix `deleteM.onSuccess` only invalidated the list
 * query, so the SPA stayed on `/admin/dashboard-templates/<id>` with the
 * deleted draft still in the header from the cached row, and the next
 * lifecycle click answered 404. The twin authoring page
 * (`asset-template-detail-page.tsx`) has navigated in the same handler since
 * `F3.36`; this is that parity.
 */
export async function deleteDraftLandsOnTheList(): Promise<void> {
  const deleteDraft = vi.fn(() => Promise.resolve());
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()),
    deleteAdminDashboardTemplateDraft: deleteDraft,
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Delete draft" }));

  expect(await screen.findByText(LIST_LANDING_TEXT)).toBeInTheDocument();
  expect(deleteDraft).toHaveBeenCalledWith(TEMPLATE_ID);
}

/**
 * The other direction: a refused delete stays on the page and shows the
 * error, so the navigate cannot be firing unconditionally. Without this case a
 * `navigate` placed outside `onSuccess` would pass the case above.
 */
export async function refusedDeleteStaysOnThePage(): Promise<void> {
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()),
    deleteAdminDashboardTemplateDraft: () => Promise.reject(new Error("Only a draft can be deleted")),
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Delete draft" }));

  expect(await screen.findByText("Only a draft can be deleted")).toBeInTheDocument();
  expect(screen.queryByText(LIST_LANDING_TEXT)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete draft" })).toBeInTheDocument();
}

/**
 * `E4.2` U8b, ADR 0072 decision 1 — the instantiate dialog offers
 * **Organization-wide (no group)** for a template that binds no role.
 *
 * `publishedTemplate()` binds `incoming-supply/kW`, so the fixture below strips
 * the bindings rather than reusing it: the option's whole condition is the
 * absence of a binding, and a fixture that carried one would assert the
 * opposite direction by accident.
 */
export async function roleFreeTemplateOffersTheOrganizationWideOption(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(roleFreeTemplate()) });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  expect(
    await screen.findByRole("option", { name: "Organization-wide (no group)" }),
  ).toBeInTheDocument();
}

/**
 * The other direction, and the adjacent positive control with it.
 *
 * A template that binds a role must NOT offer the option — the API answers that
 * combination with a 400, after the slug and the name have been typed. The
 * control is the asset-group option, which proves the select rendered and the
 * absence assertion is reading a real, populated dropdown rather than an empty
 * one.
 */
export async function bindingTemplateHidesTheOrganizationWideOption(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  expect(
    await screen.findByRole("option", { name: /Electrical train/ }),
    "the positive control — the group dropdown rendered and is populated",
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Organization-wide (no group)" }),
  ).not.toBeInTheDocument();
}

/**
 * `F4.168` B3 arrange — a draft template; Publish is clicked, its wizard's
 * Submit (`F3.85` PR 10b) sends, and `publishM` is held pending. Resolves with
 * the page's button once "Publishing…" shows.
 */
async function publishHeldPending(): Promise<HTMLElement> {
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()),
    publishAdminDashboardTemplate: () => new Promise(() => {}),
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  return screen.findByRole("button", { name: "Publishing…" });
}

/**
 * `F4.168` B3 — the shared `busy` disables every lifecycle action, but each
 * one's own name is keyed on its own mutation: Publish becomes "Publishing…",
 * with `aria-busy="true"`, while `publishM` is pending.
 */
export async function publishAnnouncesPublishing(): Promise<void> {
  const pending = await publishHeldPending();
  expect(pending).toHaveAttribute("aria-busy", "true");
}

/**
 * `F4.168` B3 — Delete draft keeps its name and reports `aria-busy="false"`
 * while Publish pends, because `deleteM` itself is not pending.
 */
export async function deleteDraftKeepsItsNameWhilePublishPends(): Promise<void> {
  await publishHeldPending();
  expect(screen.getByRole("button", { name: "Delete draft" })).toHaveAttribute("aria-busy", "false");
}

/** `F4.168` B3 — the shared `busy` disables Delete draft while Publish pends. */
export async function deleteDraftIsDisabledWhilePublishPends(): Promise<void> {
  await publishHeldPending();
  expect(screen.getByRole("button", { name: "Delete draft" })).toBeDisabled();
}

/** `F3.73` — a site-target draft: every widget sits in a tab, and the top-level canvas is empty. */
function siteDraftTemplate() {
  const tile = { ...publishedTemplate().content.widgets[0], bindings: [], key: "o1" };
  return {
    ...draftTemplate(),
    section: "site",
    target: "site",
    content: {
      widgets: [],
      tabs: [
        { key: "overview", label: "Overview", sortOrder: 0, domain: null, widgets: [tile] },
        { key: "sld", label: "SLD", sortOrder: 1, domain: "electrical", widgets: [{ ...tile, key: "s1" }] },
      ],
    },
  };
}

export function publishedSiteTemplate() {
  return { ...siteDraftTemplate(), status: "published", publishedAt: new Date(0).toISOString() };
}

const SITE_LOCATIONS = {
  items: [
    { id: LOC_1, name: "Plant 1", slug: "plant-1", active: true },
    { id: LOC_2, name: "Plant 2", slug: "plant-2", active: true },
  ],
};

/** The site arm reads the organization's locations; unstubbed it would reach :4000. */
export function stubSiteApi(overrides: Partial<Record<string, unknown>> = {}): void {
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue(SITE_LOCATIONS as never);
  stubApi(overrides);
}

/**
 * `F3.73` Task 5.3 — "Apply to all sites" shows for a published SITE template only. The
 * adjacent positive control is the same button on the published site template; the two
 * absences are a published asset-group template (wrong target) and a site draft (wrong status).
 */
export async function applyToAllSitesShowsOnlyForAPublishedSiteTemplate(): Promise<void> {
  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()) });
  renderPage();
  expect(await screen.findByRole("button", { name: "Apply to all sites" })).toBeInTheDocument();
  cleanup();
  vi.restoreAllMocks();

  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage();
  expect(await screen.findByRole("button", { name: "Archive" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Apply to all sites" }),
    "an asset-group template offered the bulk site action",
  ).not.toBeInTheDocument();
  cleanup();
  vi.restoreAllMocks();

  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(siteDraftTemplate()) });
  renderPage();
  expect(await screen.findByRole("button", { name: "Publish" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Apply to all sites" }),
    "a draft offered the bulk site action",
  ).not.toBeInTheDocument();
}

/**
 * A published site template (0 top-level widgets, two tabs of one widget each) reads "2 widgets"
 * and lists its tabs with label, domain and count — never the empty-canvas message. The adjacent
 * positive control is the asset-group template, whose count and empty message are unchanged.
 */
export async function siteTemplateCountsAndListsItsTabWidgets(): Promise<void> {
  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()) });
  renderPage();

  expect(await screen.findByText(/site · 2 widgets/)).toBeInTheDocument();
  expect(screen.queryByText("This template has no widgets yet.")).not.toBeInTheDocument();
  const tabs = screen.getByRole("list", { name: "Site tabs" });
  expect(within(tabs).getAllByRole("listitem")).toHaveLength(2);
  expect(within(tabs).getByText("SLD")).toBeInTheDocument();
  expect(within(tabs).getByText("electrical")).toBeInTheDocument();
  expect(within(tabs).getByText("overview")).toBeInTheDocument();
  expect(within(tabs).getAllByText("1 widget")).toHaveLength(2);
}

/** A group template is unchanged: its own widgets are the count, and no tab list shows. */
export async function groupTemplateCountAndEmptyMessageAreUnchanged(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage();
  expect(await screen.findByText(/electrical · 1 widget$/)).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Site tabs" })).not.toBeInTheDocument();
  cleanup();
  vi.restoreAllMocks();

  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()) });
  renderPage();
  expect(await screen.findByText(/electrical · 0 widgets/)).toBeInTheDocument();
  expect(screen.getByText("This template has no widgets yet.")).toBeInTheDocument();
}

/**
 * `F3.73` critique — Archive is not a filled primary button beside Instantiate. The positive
 * control is Instantiate, which keeps the accent fill.
 */
export async function archiveIsNotAPrimaryFill(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage();

  const archive = await screen.findByRole("button", { name: "Archive" });
  expect(screen.getByRole("button", { name: "Instantiate" }).className).toContain("bg-accent");
  expect(archive.className, "Archive kept the primary accent fill").not.toContain("bg-accent");
}

/**
 * `F3.73` critique — the read-only notice says why in plain words and cites no ADR number, and
 * is capped at a readable measure.
 */
export async function readOnlyNoticeGivesAPlainReason(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage();

  const notice = await screen.findByText(/This version is read-only/);
  expect(notice.textContent).toContain("published");
  expect(notice.textContent, "the notice cites an ADR number").not.toMatch(/ADR/);
  expect(notice.className).toContain("max-w-prose");
}

/**
 * `F3.73` review — Save canvas on a site draft sends the stored tabs back. The builder edits
 * the top-level canvas only; before this, its `{ widgets }` PATCH read as "clear every tab"
 * and wiped the draft at 200. The server now refuses an omitted `tabs` on a site template,
 * so this is also what keeps Save working there.
 */
export async function saveCanvasSendsTheStoredTabsBack(): Promise<void> {
  const calls: unknown[] = [];
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(siteDraftTemplate()),
    updateAdminDashboardTemplate: (_id: string, input: unknown) => {
      calls.push(input);
      return Promise.resolve(siteDraftTemplate());
    },
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));
  // `F3.85` PR 10a — Save opens the update wizard; Review's Submit sends the request.
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(calls).toHaveLength(1);
  });
  expect((calls[0] as { content: { tabs?: unknown } }).content.tabs).toEqual(
    siteDraftTemplate().content.tabs,
  );
}

/* --------------------------------------------------------------------------
 * `F3.85` PR 10a / ADR 0099 decision 6 (plan §11.2) — Save canvas is the
 * `dashboardTemplate.update` stepper: Basics, Content, then a Review with the
 * stored values beside the new ones.
 * ------------------------------------------------------------------------ */

export const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export function stepTitles(): string[] {
  const list = screen.getByRole("list", { name: "Steps" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

/** Save canvas opens the update wizard — Basics, Content, Review — and sends nothing yet. */
export async function saveCanvasOpensTheUpdateWizard(): Promise<void> {
  const update = vi.fn(() => Promise.resolve(draftTemplate()));
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()), updateAdminDashboardTemplate: update });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));

  expect(stepTitles()).toEqual(["1. Basics", "2. Content", "3. Review"]);
  expect(update).not.toHaveBeenCalled();
}

/** The Review card shows the stored value under Now beside the new one, for a field the user changed. */
export async function updateReviewShowsCurrentBesideNew(): Promise<void> {
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()),
    updateAdminDashboardTemplate: () => Promise.resolve(draftTemplate()),
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Renamed overview" } });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  const card = screen.getByRole("region", { name: "Edit a dashboard template" });
  expect(within(card).getByRole("columnheader", { name: "Now" })).toBeInTheDocument();
  const nameRow = within(card).getByRole("rowheader", { name: "Name" }).closest("tr") as HTMLElement;
  expect(within(nameRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "Electrical overview",
    "Renamed overview",
  ]);
}

/**
 * The update wizard alone sends the PATCH with the canvas (the positive) and
 * no `X-Copilot-Change` header (plan §10.5). The write is not spied, so the
 * real `adminFetch` puts it on the wire.
 */
export async function saveWizardAloneSendsNoCopilotHeader(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()) });
  const seen: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(draftTemplate()), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => expect(seen.filter((call) => call.init.method === "PATCH")).toHaveLength(1));
  const patch = seen.find((call) => call.init.method === "PATCH") as { url: string; init: RequestInit };
  expect(patch.url).toBe(`${BASE}/api/v1/admin/dashboard-templates/${TEMPLATE_ID}`);
  expect(JSON.parse(patch.init.body as string)).toEqual({ content: { widgets: [], tabs: [] } });
  expect(new Headers(patch.init.headers).get("X-Copilot-Change")).toBeNull();
}

/** Stubs the reads and a spied update, and returns the inputs the update is called with. */
function spyUpdate(template = draftTemplate()): unknown[] {
  const calls: unknown[] = [];
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(template),
    updateAdminDashboardTemplate: (_id: string, input: unknown) => {
      calls.push(input);
      return Promise.resolve(template);
    },
  });
  return calls;
}

async function nextNextSubmit(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

/**
 * Review finding F1 — the canvas the PATCH sends is the one edited on this
 * screen: a widget added before Save canvas is in `content.widgets`. The
 * draft fixture starts with none, so a seed from the stored row sends `[]`.
 */
export async function saveCanvasSendsTheEditedWidgets(): Promise<void> {
  const calls = spyUpdate();
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Add widget" }));
  await userEvent.click(screen.getByRole("button", { name: "Save canvas" }));
  await nextNextSubmit();

  await waitFor(() => expect(calls).toHaveLength(1));
  expect((calls[0] as { content: { widgets: unknown[] } }).content.widgets).toHaveLength(1);
}

/** Review finding C3 — a padded name is sent trimmed, as the create path trims it. */
export async function saveSendsATrimmedName(): Promise<void> {
  const calls = spyUpdate();
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: " Renamed overview " } });
  await nextNextSubmit();

  await waitFor(() => expect(calls).toHaveLength(1));
  expect((calls[0] as { name?: unknown }).name).toBe("Renamed overview");
}

/** Leaving the Name field trims it, so the Review row shows the name Submit sends. */
export async function reviewShowsTheTrimmedNameAfterBlur(): Promise<void> {
  spyUpdate();
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));
  const name = screen.getByRole("textbox", { name: "Name" });
  fireEvent.change(name, { target: { value: " Renamed overview " } });
  fireEvent.blur(name);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  const card = screen.getByRole("region", { name: "Edit a dashboard template" });
  const nameRow = within(card).getByRole("rowheader", { name: "Name" }).closest("tr") as HTMLElement;
  expect(within(nameRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "Electrical overview",
    "Renamed overview",
  ]);
}

/**
 * Review finding PR10a-2 — a name of spaces is not sent: the PATCH keeps the
 * stored name. The positive: the request fired, with the canvas.
 */
export async function saveSendsNoNameForABlankOne(): Promise<void> {
  const calls = spyUpdate();
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "   " } });
  await nextNextSubmit();

  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toEqual({ content: { widgets: [], tabs: [] } });
}

/** A refused Save, then Back to Basics and a new name, then on to Review again. */
async function refuseSaveThenRename(): Promise<HTMLElement> {
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()),
    updateAdminDashboardTemplate: () => Promise.reject(new Error("The name is taken")),
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));
  await nextNextSubmit();
  await screen.findAllByText("The name is taken");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Another name" } });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  return screen.getByRole("region", { name: "Edit a dashboard template" });
}

/**
 * Review finding C1 — a value change clears the last refusal: after a failed
 * Submit, Back and a new name, Review no longer shows the old server error.
 */
export async function aValueChangeClearsTheSaveRefusal(): Promise<void> {
  const card = await refuseSaveThenRename();
  expect(within(card).queryByText("The name is taken")).toBeNull();
}

/** The positive beside the absence above: the Review reached after the refusal shows the new name. */
export async function aValueChangeShowsTheNewReviewAfterARefusal(): Promise<void> {
  const card = await refuseSaveThenRename();
  const nameRow = within(card).getByRole("rowheader", { name: "Name" }).closest("tr") as HTMLElement;
  expect(within(nameRow).getByText("Another name")).toBeInTheDocument();
}

/**
 * Review findings C2 / PR10a-3 — the Content step describes what Submit
 * sends: a copilot fill that replaces `content` is counted, and named as not
 * the canvas on this screen.
 */
export async function saveContentStepDescribesAFilledContent(): Promise<void> {
  resetWizardStore();
  spyUpdate();
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "dashboardTemplate.update", params: { id: TEMPLATE_ID },
      stepId: "content",
      // One top-level widget and one in a tab: the count is both, as the header counts.
      values: {
        content: {
          widgets: publishedTemplate().content.widgets,
          tabs: [{ key: "t1", title: "Tab", widgets: publishedTemplate().content.widgets }],
        },
      },
    }, null);
  });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByRole("region", { name: "Content" }).textContent).toContain(
    "The content to save: 2 widgets. It is not the canvas on this screen (0 widgets).",
  );
}

/** Review finding PR10a-3 — a `section` the copilot filled is shown on Basics, which has no input for it. */
export async function saveBasicsShowsAFilledSection(): Promise<void> {
  resetWizardStore();
  spyUpdate();
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Save canvas" }));
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "dashboardTemplate.update", params: { id: TEMPLATE_ID },
      stepId: "basics",
      values: { section: "water" },
    }, null);
  });

  expect(screen.getByRole("region", { name: "Basics" }).textContent).toContain(
    "Section: water (filled by the copilot; now electrical).",
  );
}
