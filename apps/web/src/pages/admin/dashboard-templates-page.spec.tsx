import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/dashboard-templates";
import * as orgApi from "../../api/admin/organizations";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { resetWizardStore, useWizardStore } from "../../stores/wizard-store";
import { DashboardTemplatesAdminPage } from "./dashboard-templates-page";
import * as copilotApi from "../../api/copilot";

/**
 * `F3.36` Part F — the section template list, rendered (ADR 0042).
 *
 * Assertions live here; `dashboard-templates-page.test.tsx` is the Vitest
 * entry point (ADR 0014). Queries go by role and text (ADR 0042 decision 5).
 */

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const TEMPLATE_ID = "11111111-1111-1111-1111-111111111111";

const LIST = {
  items: [
    {
      id: TEMPLATE_ID,
      organizationId: "org-1",
      code: "ELECTRICAL",
      version: 1,
      name: "Electrical overview",
      section: "electrical",
      description: null,
      status: "draft",
      publishedAt: null,
      archivedAt: null,
      stockCode: null,
      stockVersion: null,
      widgetCount: 3,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  ],
};

const STOCK = {
  items: [
    {
      code: "electrical-default",
      name: "Electrical (stock)",
      section: "electrical",
      description: "Repository default",
      stockVersion: 1,
      content: { widgets: [] },
    },
  ],
};

/** A uuid: the wizards parse `organizationId` with the route's body schema (`z.string().uuid()`). */
const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ORGS = {
  items: [{ id: ORG_ID, code: "IX", name: "Ion Exchange" }],
};

/** Deliberately not the seeded six sections — the `F4.43` guard's fixture shape. */
const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  waterBalanceRoles: [],
  dashboardSections: [
    { code: "f336-spec-section", label: "Spec Section", description: null, sortOrder: 10, active: true },
  ],
};

function stubApi(): void {
  vi.spyOn(api, "fetchAdminDashboardTemplates").mockResolvedValue(LIST as never);
  vi.spyOn(api, "fetchAdminStockDashboardTemplates").mockResolvedValue(STOCK as never);
  vi.spyOn(api, "importAdminStockDashboardTemplate").mockResolvedValue(LIST.items[0] as never);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGS as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardTemplatesAdminPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The list renders its rows, and the stock catalog with an Import action each. */
export async function rendersTemplatesAndStockCatalog(): Promise<void> {
  stubApi();
  renderPage();

  expect(await screen.findByRole("link", { name: /ELECTRICAL v1/ })).toBeInTheDocument();
  expect(await screen.findByText("Electrical (stock)")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import Electrical (stock)" })).toBeInTheDocument();
}

/**
 * `F3.73` Task 5.3 — a site template's row carries a `Site` badge from `target`; an
 * asset-group row beside it does not (the adjacent control for the absence).
 */
export async function siteTemplateRowShowsASiteBadge(): Promise<void> {
  stubApi();
  const site = { ...LIST.items[0], id: "22222222-2222-2222-2222-222222222222", code: "SITE", target: "site" };
  vi.spyOn(api, "fetchAdminDashboardTemplates").mockResolvedValue({
    items: [{ ...LIST.items[0], target: "asset_group" }, site],
  } as never);
  renderPage();

  const siteLink = await screen.findByRole("link", { name: /SITE v1/ });
  const siteRow = siteLink.closest("li") as HTMLElement;
  expect(within(siteRow).getByText("Site")).toBeInTheDocument();
  const groupRow = screen.getByRole("link", { name: /ELECTRICAL v1/ }).closest("li") as HTMLElement;
  expect(within(groupRow).queryByText("Site")).not.toBeInTheDocument();
}

/** The section filter comes from the vocabulary fetch, not a hardcoded list. */
export async function sectionFilterComesFromTheVocabularyFetch(): Promise<void> {
  stubApi();
  renderPage();

  const select = await screen.findByRole("combobox", { name: "Filter by section" });
  await waitFor(() => {
    expect(select.textContent).toContain("Spec Section");
  });
}

/**
 * `F3.44` — the stock row links to the read-only viewer, not gated on
 * `mayAuthor` (plan §5.4 / ADR 0049 decision 3 Q1), and the subtitle derives
 * its count from `stockRows.length` rather than a hardcoded number (Q4).
 */
export async function stockRowLinksToTheViewer(): Promise<void> {
  stubApi();
  renderPage();

  const link = await screen.findByRole("link", { name: "View Electrical (stock)" });
  expect(link).toHaveAttribute("href", "/admin/dashboard-templates/stock/electrical-default");

  const importButton = screen.getByRole("button", { name: "Import Electrical (stock)" });
  expect(importButton).toBeInTheDocument();
  expect(importButton).toBeDisabled();

  expect(await screen.findByText("1 repository default (ADR 0049 decision 3)")).toBeInTheDocument();
}

/**
 * `F3.44` review C1 — a failed stock fetch must not read as "0 repository
 * defaults" over an empty list. The count renders only on success; pending
 * and error get the same lines the templates card above already has.
 * `stubApi` first, then the stock stub is overridden to reject.
 */
export async function aFailedStockFetchDoesNotCountZeroDefaults(): Promise<void> {
  stubApi();
  // `adminFetch` throws the whole response body as the message, so the
  // rejection is shaped like a Nest envelope — a bare "boom" would pass
  // whether or not the card unwraps it (post-merge sweep, finding 2).
  vi.spyOn(api, "fetchAdminStockDashboardTemplates").mockRejectedValue(
    new Error(
      JSON.stringify({ message: "stock boom", error: "Forbidden", statusCode: 403 }),
    ),
  );
  renderPage();

  expect(await screen.findByText("stock boom")).toBeInTheDocument();
  expect(screen.queryByText(/statusCode/)).not.toBeInTheDocument();
  expect(screen.queryByText(/0 repository defaults/)).not.toBeInTheDocument();
  expect(screen.getByText("Repository defaults (ADR 0049 decision 3)")).toBeInTheDocument();
}

/** Importing requires an organization, then calls the API and refreshes the list. */
export async function importCallsTheApiWithTheChosenOrganization(): Promise<void> {
  stubApi();
  renderPage();

  const importButton = await screen.findByRole("button", { name: "Import Electrical (stock)" });
  expect(importButton).toBeDisabled();

  const orgSelect = screen.getByRole("combobox", { name: "Import into organization" });
  await userEvent.selectOptions(orgSelect, ORG_ID);
  expect(importButton).not.toBeDisabled();

  await userEvent.click(importButton);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => {
    expect(api.importAdminStockDashboardTemplate).toHaveBeenCalledWith(
      "electrical-default",
      ORG_ID,
    );
  });
}

/** A second stock entry, so a per-entry pending name has a sibling to stay idle. */
const WATER_STOCK = {
  code: "water-default",
  name: "Water (stock)",
  section: "water",
  description: "Repository default",
  stockVersion: 1,
  content: { widgets: [] },
};

/**
 * `F4.168` B5 arrange — two stock entries; Import on "Electrical (stock)" is
 * clicked and its mutation held pending. Resolves once the pending name shows.
 */
async function importElectricalHeldPending(): Promise<HTMLElement> {
  stubApi();
  vi.spyOn(api, "fetchAdminStockDashboardTemplates").mockResolvedValue({
    items: [...STOCK.items, WATER_STOCK],
  } as never);
  vi.spyOn(api, "importAdminStockDashboardTemplate").mockReturnValue(new Promise(() => {}));
  renderPage();

  const importButton = await screen.findByRole("button", { name: "Import Electrical (stock)" });
  const orgSelect = screen.getByRole("combobox", { name: "Import into organization" });
  await userEvent.selectOptions(orgSelect, ORG_ID);
  await userEvent.click(importButton);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  return screen.findByRole("button", { name: "Importing Electrical (stock)…" });
}

/**
 * `F4.168` B5 — importing a stock entry announces "Importing {name}…" as the
 * button's `aria-label` (its accessible name), with `aria-busy="true"`.
 */
export async function importingAnnouncesImportingThisEntry(): Promise<void> {
  const pending = await importElectricalHeldPending();
  expect(pending).toHaveAttribute("aria-busy", "true");
}

/** `F4.168` B5 — while the entry imports, its old "Import {name}" name is gone. */
export async function importingRemovesThatEntrysIdleName(): Promise<void> {
  await importElectricalHeldPending();
  expect(screen.queryByRole("button", { name: "Import Electrical (stock)" })).not.toBeInTheDocument();
}

/**
 * `F4.168` B5, D4 — the pending name is keyed per entry on
 * `importM.variables === entry.code`: the other entry keeps "Import {name}"
 * and is not busy while the first imports.
 */
export async function anotherEntryKeepsItsNameWhileOneImports(): Promise<void> {
  await importElectricalHeldPending();
  const other = screen.getByRole("button", { name: "Import Water (stock)" });
  expect(other).toHaveAttribute("aria-busy", "false");
}

/* --------------------------------------------------------------------------
 * `F3.85` PR 10a / ADR 0099 decision 6 (plan §11.2) — the create and the
 * stock import are steppers on the shared `WizardShell`.
 * ------------------------------------------------------------------------ */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** The step list's items, in order. */
function stepTitles(): string[] {
  const list = screen.getByRole("list", { name: "Steps" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

/** A DTO the write's response schema parses, so a stubbed response is not an error. */
const CREATED_DTO = {
  ...LIST.items[0],
  organizationId: ORG_ID,
  target: "asset_group",
  content: { widgets: [] },
  createdBy: null,
};

type Seen = { url: string; init: RequestInit };

/**
 * Every request reaching `fetch` — the write is NOT spied, so the real
 * `adminFetch` puts it on the wire. The reads are spied in `stubApi`.
 */
function captureFetch(): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(CREATED_DTO), { status: 201, headers: { "Content-Type": "application/json" } });
  });
  return seen;
}

/** Opens the create wizard and fills its Basics step. */
async function fillCreateBasics(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "New template" }));
  const org = await screen.findByRole("combobox", { name: "Organization" });
  await waitFor(() => expect(org.textContent).toContain("Ion Exchange"));
  await userEvent.selectOptions(org, ORG_ID);
  // `fireEvent.change`, not `userEvent.type`: typing each key ran past the 5 s case timeout.
  fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "  ELEC " } });
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: " Electrical overview " } });
  const sectionSelect = screen.getByRole("combobox", { name: "Section" });
  await waitFor(() => expect(sectionSelect.textContent).toContain("Spec Section"));
  await userEvent.selectOptions(sectionSelect, "f336-spec-section");
}

/** The create wizard's steps are the entry's Basics and Content, then Review. */
export async function createWizardStepsAreBasicsContentReview(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "New template" }));

  expect(stepTitles()).toEqual(["1. Basics", "2. Content", "3. Review"]);
  expect(within(screen.getByRole("list", { name: "Steps" })).getByText("1. Basics")).toHaveAttribute(
    "aria-current",
    "step",
  );
}

/** Submit on Review sends today's body: code and name trimmed, a blank description as null. */
export async function createWizardSendsTheTrimmedBody(): Promise<void> {
  stubApi();
  const create = vi.spyOn(api, "createAdminDashboardTemplate").mockResolvedValue(CREATED_DTO as never);
  renderPage();
  await fillCreateBasics();

  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith({
    organizationId: ORG_ID,
    code: "ELEC",
    name: "Electrical overview",
    section: "f336-spec-section",
    description: null,
  });
}

/** Nothing is sent before Review's Submit: Next through the steps never creates. */
export async function createWizardSendsNothingBeforeSubmit(): Promise<void> {
  stubApi();
  const create = vi.spyOn(api, "createAdminDashboardTemplate").mockResolvedValue(CREATED_DTO as never);
  renderPage();
  await fillCreateBasics();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
}

/**
 * The create wizard alone sends the plain request: it fires with the body
 * (the positive), and with no `X-Copilot-Change` header (plan §10.5).
 */
export async function createWizardAloneSendsNoCopilotHeader(): Promise<void> {
  stubApi();
  const seen = captureFetch();
  renderPage();
  await fillCreateBasics();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => expect(seen.filter((call) => call.init.method === "POST")).toHaveLength(1));
  const post = seen.find((call) => call.init.method === "POST") as Seen;
  expect(post.url).toBe(`${BASE}/api/v1/admin/dashboard-templates`);
  expect(JSON.parse(post.init.body as string)).toEqual({
    organizationId: ORG_ID,
    code: "ELEC",
    name: "Electrical overview",
    section: "f336-spec-section",
    description: null,
  });
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
}

/** Import opens the importStock wizard — Organization, then Review — and sends nothing yet. */
export async function importOpensAWizardBeforeTheRequest(): Promise<void> {
  stubApi();
  renderPage();
  const importButton = await screen.findByRole("button", { name: "Import Electrical (stock)" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Import into organization" }), ORG_ID);
  await userEvent.click(importButton);

  expect(stepTitles()).toEqual(["1. Organization", "2. Review"]);
  expect(api.importAdminStockDashboardTemplate).not.toHaveBeenCalled();
}

/**
 * The import wizard alone sends the entry's body `{organizationId}` to the
 * stock code's route (the positive), with no `X-Copilot-Change` header.
 */
export async function importWizardAloneSendsNoCopilotHeader(): Promise<void> {
  stubApi();
  vi.mocked(api.importAdminStockDashboardTemplate).mockRestore();
  const seen = captureFetch();
  renderPage();
  const importButton = await screen.findByRole("button", { name: "Import Electrical (stock)" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Import into organization" }), ORG_ID);
  await userEvent.click(importButton);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => expect(seen.filter((call) => call.init.method === "POST")).toHaveLength(1));
  const post = seen.find((call) => call.init.method === "POST") as Seen;
  expect(post.url).toBe(`${BASE}/api/v1/admin/dashboard-templates/stock/electrical-default/import`);
  expect(JSON.parse(post.init.body as string)).toEqual({ organizationId: ORG_ID });
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
}

/**
 * A refused create, then Back to Basics with Code cleared, then on to Review
 * again — the review finding C1 path.
 */
async function refuseCreateThenClearCode(): Promise<HTMLElement> {
  stubApi();
  vi.spyOn(api, "createAdminDashboardTemplate").mockRejectedValue(new Error("The code is taken"));
  renderPage();
  await fillCreateBasics();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByText("The code is taken");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "" } });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  return screen.getByRole("region", { name: "Create a dashboard template" });
}

/** Review finding C1 — after a refused create, a value change clears the old server error from Review. */
export async function aValueChangeClearsTheCreateRefusal(): Promise<void> {
  const card = await refuseCreateThenClearCode();
  expect(within(card).queryByText("The code is taken")).toBeNull();
}

/** The positive beside the absence above: Review names the problem that now blocks Submit. */
export async function reviewNamesTheClearedCodeAfterARefusal(): Promise<void> {
  const card = await refuseCreateThenClearCode();
  expect(within(card).getByText(/^code: /)).toBeInTheDocument();
}

/** A refused import, then Back with the organization cleared, then Review again. */
async function refuseImportThenClearOrganization(): Promise<HTMLElement> {
  stubApi();
  vi.mocked(api.importAdminStockDashboardTemplate).mockRejectedValue(new Error("Already imported"));
  renderPage();
  const importButton = await screen.findByRole("button", { name: "Import Electrical (stock)" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Import into organization" }), ORG_ID);
  await userEvent.click(importButton);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findAllByText("Already imported");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Organization" }), "");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  return screen.getByRole("region", { name: "Import a stock dashboard template" });
}

/** Review finding C1 — the import wizard clears the old server error on a value change too. */
export async function aValueChangeClearsTheImportRefusal(): Promise<void> {
  const card = await refuseImportThenClearOrganization();
  expect(within(card).queryByText("Already imported")).toBeNull();
}

/** The positive beside the absence above: Review names the missing organization. */
export async function reviewNamesTheClearedOrganizationAfterARefusal(): Promise<void> {
  const card = await refuseImportThenClearOrganization();
  expect(within(card).getByText(/^organizationId: /)).toBeInTheDocument();
}

/** Opens the create wizard and hands it a copilot fill, as the dock does. */
async function openCreateWithFill(stepId: string, values: Record<string, unknown>): Promise<void> {
  resetWizardStore();
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "New template" }));
  act(() => {
    useWizardStore.getState().receiveFill({ catalogId: "dashboardTemplate.create", stepId, values });
  });
}

/** Review finding C2 — the create Content step describes a content the copilot filled, which Submit sends. */
export async function createContentStepDescribesAFilledContent(): Promise<void> {
  await openCreateWithFill("content", { content: { widgets: [{}, {}] } });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByRole("region", { name: "Content" }).textContent).toContain(
    "The template is created with the filled content: 2 widgets.",
  );
}

/** Review finding PR10a-3 — a `target` the copilot filled is shown on Basics, which has no input for it. */
export async function createBasicsShowsAFilledTarget(): Promise<void> {
  await openCreateWithFill("basics", { target: "site" });

  expect(screen.getByRole("region", { name: "Basics" }).textContent).toContain(
    "Target: site (filled by the copilot).",
  );
}

/** Review finding PR10a-3 — Review names an organization that is not in the list by its id, not "the organization". */
export async function createSummaryNamesAnUnlistedOrganizationById(): Promise<void> {
  const unlisted = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await openCreateWithFill("basics", { organizationId: unlisted, code: "ELEC", name: "Electrical overview" });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByRole("region", { name: "Create a dashboard template" }).textContent).toContain(
    `(ELEC) in ${unlisted}.`,
  );
}
