import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardDto, UserRole } from "@bms/shared";

import * as assetGroupsApi from "../../api/admin/asset-groups";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as assetsApi from "../../api/assets";
import * as dashboardsApi from "../../api/dashboards";
import * as mimicLayoutsApi from "../../api/mimic-layouts";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { scopeColumns } from "../../lib/dashboard-scope";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { useWizardStore } from "../../stores/wizard-store";
import { DashboardBuilderPage } from "./dashboard-builder-page";
import * as copilotApi from "../../api/copilot";

/**
 * `F3.1d` Unit 7 — the dashboard create page.
 *
 * Assertions live here; `dashboard-builder-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 2): an `asset_group_admin` reaches this page and
 * authors a group dashboard from `/auth/me`'s `scope.assetGroups` — the cases below set that
 * scope on the store first (`http.spec.ts`'s idiom); the `.test.tsx` resets it in `afterEach`,
 * because a reset at the tail of a case never runs when an `expect` throws. The three admin
 * fetches are still spied (`stubMasterData`) so that a regression is RECORDED as a call, not
 * lost as an unhandled `fetch` in jsdom.
 *
 * `F3.85` PR 9 (ADR 0099 decision 6, plan §11.1): the page is two wizards in order —
 * `dashboard.create` (Basics → Scope → Review), then, once the create has answered,
 * `dashboard.widgets.replace` (Layout → Review) on the new dashboard. The scope radios are the
 * Scope step's, and the widget canvas is the Layout step's, so the cases step there first. The
 * wizards parse every id as a uuid, so the fixtures' ids are uuids.
 */

const ORG_1 = "30000000-0000-4000-8000-000000000001";
const LOC_1 = "10000000-0000-4000-8000-000000000001";
const GRP_1 = "20000000-0000-4000-8000-000000000001";
const CREATED_ID = "60000000-0000-4000-8000-000000000001";

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

const ORGANIZATIONS = [
  { id: ORG_1, code: "IONX", name: "Ion Exchange", active: true, currency: "INR", timezone: "Asia/Kolkata", meta: null, createdAt: new Date(0).toISOString() },
];

const LOCATION = {
  id: LOC_1,
  parentId: null,
  organizationId: ORG_1,
  organizationCode: "IONX",
  organizationName: "Ion Exchange",
  code: "KOL",
  slug: "kolkata-works",
  name: "Kolkata Works",
  type: "smoc_campus" as const,
  typeLabel: "SMOC campus",
  province: null,
  capital: null,
  timezone: null,
  latitude: 0,
  longitude: 0,
  active: true,
  meta: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

/** `fetchAdminAssetGroups`'s real response shape — the full `AdminAssetGroupDto`, no cast, so a
 * missing `organizationId` (the field "choosing a group decides the organization" rests on) fails
 * the compiler rather than the run. */
const ASSET_GROUP = {
  id: GRP_1,
  code: "hvac",
  name: "Hvac",
  description: null,
  locationId: LOC_1,
  locationName: "Kolkata Works",
  organizationId: ORG_1,
  memberCount: 3,
  createdAt: new Date(0).toISOString(),
};

/** The dashboard the create answers — group-scoped unless a case says otherwise. */
function createdDashboard(overrides: Partial<DashboardDto> = {}): DashboardDto {
  return {
    id: CREATED_ID,
    organizationId: ORG_1,
    slug: "hvac-kolkata",
    name: "HVAC Kolkata",
    description: null,
    locationId: null,
    assetGroupId: GRP_1,
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    templateId: null,
    tabs: [],
    widgets: [],
    ...overrides,
  };
}

/** Stubs every master-data query the page issues — including `fetchAdminAssetGroups` (`F3.34`),
 * without which the asset-groups query hits `fetch` in jsdom and logs an unhandled rejection. */
function stubMasterData(): void {
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: ORGANIZATIONS });
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [LOCATION] });
  vi.spyOn(assetGroupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [ASSET_GROUP] });
  // `F3.32c` — `WidgetInspector` reads the layout library on every mount; unstubbed, the read
  // reaches a local API on :4000, answers 401 and clears the session.
  vi.spyOn(mimicLayoutsApi, "fetchMimicLayouts").mockResolvedValue({ items: [] });
  // `AppShell` mounts `SystemStatusIndicator`, whose `GET /system/status` is the same leak: a
  // local API on :4000 answers 401 and clears the session, emptying the role's group list.
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
}

function renderPage(user: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardBuilderPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** `F3.85` PR 9 — the page's two wizards. */
const createWizard = (): HTMLElement => screen.getByRole("region", { name: "Create the dashboard" });
const layoutWizard = (): HTMLElement => screen.getByRole("region", { name: "Lay out the widgets" });

/** The wizard's step list, as its `<ol aria-label="Steps">` names them. */
function stepTitles(region: HTMLElement): string[] {
  return within(within(region).getByRole("list", { name: "Steps" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

/** Basics → Scope (Next never fails on Basics: an empty field is left unset). */
async function openScopeStep(): Promise<void> {
  await userEvent.click(within(createWizard()).getByRole("button", { name: "Next" }));
  await within(createWizard()).findByRole("region", { name: "Scope" });
}

/** Next until Review, then Submit. A step that refuses to move on leaves no Submit to click. */
async function submitWizard(region: () => HTMLElement): Promise<void> {
  for (let guard = 0; guard < 4; guard += 1) {
    const next = within(region()).queryByRole("button", { name: "Next" });
    if (next === null) break;
    await userEvent.click(next);
  }
  const submit = within(region()).queryByRole("button", { name: "Submit" });
  if (submit !== null) await userEvent.click(submit);
}

/** Fills Basics and an organization-wide or asset-group Scope as `admin`, then submits the create. */
async function fillAndCreate(kind: "Organization-wide" | "Asset group", name: string, slug: string): Promise<void> {
  await userEvent.type(await within(createWizard()).findByLabelText("Name"), name);
  await userEvent.type(within(createWizard()).getByLabelText("Slug"), slug);
  await openScopeStep();
  await userEvent.click(screen.getByRole("radio", { name: kind }));
  if (kind === "Asset group") {
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Asset group" }), GRP_1);
  } else {
    await userEvent.selectOptions(await screen.findByLabelText("Organization"), ORG_1);
  }
  await submitWizard(createWizard);
}

/** `admin` creates a dashboard of `kind` (the create stubbed) and waits for the Layout step. */
async function createAs(kind: "Organization-wide" | "Asset group"): Promise<void> {
  vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue(
    kind === "Asset group" ? createdDashboard() : createdDashboard({ assetGroupId: null }),
  );
  stubMasterData();
  renderPage(asUser("admin"));
  await fillAndCreate(kind, "HVAC Kolkata", "hvac-kolkata");
  await screen.findByRole("region", { name: "Lay out the widgets" });
}

/** Plan §10.4 browser-pass item 7, held in jsdom too: no organization-wide
 * option reaches a `location_admin`'s create form, composed page and all. */
export async function locationAdminGetsNoOrganizationWideOptionOnTheComposedPage(): Promise<void> {
  stubMasterData();
  renderPage(asUser("location_admin"));

  await openScopeStep();
  await screen.findByRole("radio", { name: "Location" });
  expect(screen.queryByRole("radio", { name: "Organization-wide" })).not.toBeInTheDocument();
}

/** `F3.34` (ADR 0047 Amendment 5) — the create page's body gains `assetGroupId`. Choosing a group
 * sends its id, sends `locationId: null`, and takes the organization from the group DTO. */
export async function creatingWithAnAssetGroupSendsAssetGroupIdAndNoLocationId(): Promise<void> {
  stubMasterData();
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue(createdDashboard());
  renderPage(asUser("admin"));

  await fillAndCreate("Asset group", "HVAC Kolkata", "hvac-kolkata");

  await waitFor(() => {
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_1, assetGroupId: GRP_1, locationId: null }),
    );
  });
}

/** The `Asset group` radio is absent from a `location_admin`'s composed create page — the
 * `Location` radio found first is the positive control that the fields rendered at all. */
export async function locationAdminGetsNoAssetGroupOptionOnTheComposedPage(): Promise<void> {
  stubMasterData();
  renderPage(asUser("location_admin"));

  await openScopeStep();
  await screen.findByRole("radio", { name: "Location" });
  expect(screen.queryByRole("radio", { name: "Asset group" })).not.toBeInTheDocument();
}

/** Adding a widget places a tile on the canvas and opens it for editing. `F3.85` PR 9: on the
 * Layout step, after the create. */
export async function addingAWidgetSelectsItForEditing(): Promise<void> {
  await createAs("Organization-wide");
  await userEvent.click(within(layoutWizard()).getByRole("button", { name: /Value tile/i }));

  expect(screen.getByLabelText("Title")).toBeInTheDocument();
  expect(screen.getByText("Bound points")).toBeInTheDocument();
}

/** `F3.32` (ADR 0079 decision 4) — the Layout step offers "Plant mimic" only on a group scope. The
 * Value tile button is the positive control that the widget buttons rendered at all. `F3.85` PR 9:
 * the scope is the created dashboard's, so this is the organization-wide half; the group half is
 * `aGroupDashboardsLayoutStepOffersPlantMimic`. */
export async function createPageOffersPlantMimicOnlyOnAGroupScope(): Promise<void> {
  await createAs("Organization-wide");

  expect(within(layoutWizard()).getByRole("button", { name: /Value tile/i })).toBeInTheDocument();
  expect(within(layoutWizard()).queryByRole("button", { name: /Plant mimic/i })).not.toBeInTheDocument();
}

/** The group half: a dashboard created on an asset group offers "Plant mimic" on its Layout step. */
export async function aGroupDashboardsLayoutStepOffersPlantMimic(): Promise<void> {
  await createAs("Asset group");

  expect(within(layoutWizard()).getByRole("button", { name: /Plant mimic/i })).toBeInTheDocument();
}

/**
 * Review finding — `WidgetInspector` renders only the SELECTED widget's problems, so adding a
 * second widget (which `addWidget` auto-selects) hid the FIRST widget's own problem entirely:
 * the save refused, and nothing on the page named which widget or why. This is the exact
 * reproduction the finding names: two value tiles, the second selected, the first (unselected)
 * still missing its required point binding.
 */
export async function anUnselectedWidgetsProblemRendersInTheSummary(): Promise<void> {
  await createAs("Organization-wide");
  await userEvent.click(within(layoutWizard()).getByRole("button", { name: "+ Value tile" }));
  await userEvent.click(within(layoutWizard()).getByRole("button", { name: "+ Value tile" }));

  // The second widget just added is auto-selected (`addWidget`'s own behaviour); the first is
  // now unselected and still has zero bound points, which `WidgetInspector` cannot show.
  expect(screen.getByText("Fix the problems below to save.")).toBeInTheDocument();
  expect(screen.getByText(/Widget 1 \(Value tile\):/)).toBeInTheDocument();
}

/** `F3.85` PR 9 — a widget with a problem (a value tile with no point) never reaches the PUT. Two
 * gates hold it, either enough: the Layout step's parse, and the page's own `problems` check in
 * the widgets `onSubmit`. The positive control is `aMimicOnAGroupScopeLeavesCreateEnabled`. */
export async function aWidgetProblemRefusesTheWidgetsSubmit(): Promise<void> {
  const putSpy = vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(createdDashboard());
  await createAs("Organization-wide");
  await userEvent.click(within(layoutWizard()).getByRole("button", { name: "+ Value tile" }));

  await submitWizard(layoutWizard);

  expect(putSpy).not.toHaveBeenCalled();
}

/** The create sends nothing until name, slug and scope are filled: with the fields empty the
 * Scope step refuses an unchosen location, and no request fires. The second half fills them and
 * the request fires — the positive control. */
export async function createIsDisabledUntilRequiredFieldsAreFilled(): Promise<void> {
  stubMasterData();
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue(createdDashboard());
  renderPage(asUser("admin"));

  await openScopeStep();
  await submitWizard(createWizard);
  expect(createSpy).not.toHaveBeenCalled();

  await userEvent.click(within(createWizard()).getByRole("button", { name: "Back" }));
  await userEvent.type(await within(createWizard()).findByLabelText("Name"), "Site A Overview");
  await userEvent.type(within(createWizard()).getByLabelText("Slug"), "site-a-overview");
  await openScopeStep();
  await userEvent.click(screen.getByRole("radio", { name: "Organization-wide" }));
  await userEvent.selectOptions(await screen.findByLabelText("Organization"), ORG_1);
  await submitWizard(createWizard);

  await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
}

/** `F3.85` PR 9 — the create wizard's steps are the catalog entry's (Basics, Scope), then Review. */
export async function theCreateWizardStepsAreBasicsScopeReview(): Promise<void> {
  stubMasterData();
  renderPage(asUser("admin"));

  expect(stepTitles(await screen.findByRole("region", { name: "Create the dashboard" }))).toEqual([
    "1. Basics",
    "2. Scope",
    "3. Review",
  ]);
}

/** `F3.85` PR 9 — the widgets wizard, once open, is Layout then Review. */
export async function theWidgetsWizardStepsAreLayoutReview(): Promise<void> {
  await createAs("Asset group");

  expect(stepTitles(layoutWizard())).toEqual(["1. Layout", "2. Review"]);
}

/** `F3.85` PR 9 (plan §11.1) — the first request's body is exactly `scopeColumns(scope)` plus the
 * organization, the name and the slug (trimmed); no description was typed, so none is sent.
 * Mutation: drop `...scopeColumns(scope)` from the values => red. */
export async function theCreateBodyIsTheScopeColumnsPlusNameAndSlug(): Promise<void> {
  stubMasterData();
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue(createdDashboard());
  renderPage(asUser("admin"));

  await fillAndCreate("Asset group", "  HVAC Kolkata ", "hvac-kolkata");

  await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
  expect(createSpy.mock.calls[0]![0]).toEqual({
    organizationId: ORG_1,
    name: "HVAC Kolkata",
    slug: "hvac-kolkata",
    ...scopeColumns({ kind: "assetGroup", organizationId: ORG_1, assetGroupId: GRP_1 }),
  });
}

/** A create whose answer the case holds back, and the hand that releases it. */
function deferredCreate() {
  let release: (dto: DashboardDto) => void = () => undefined;
  const pending = new Promise<DashboardDto>((resolve) => {
    release = resolve;
  });
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockReturnValue(pending);
  return { createSpy, release: (dto: DashboardDto) => release(dto) };
}

/** `F3.85` PR 9 (plan §11.1) — the second card cannot submit before the first succeeded: while
 * the create is in flight there is no widgets wizard at all, and no PUT. Its positive control is
 * `theWidgetsWizardOpensWhenTheCreateResolves`. */
export async function theWidgetsWizardIsAbsentWhileTheCreateIsPending(): Promise<void> {
  stubMasterData();
  const { createSpy } = deferredCreate();
  const putSpy = vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(createdDashboard());
  renderPage(asUser("admin"));

  await fillAndCreate("Asset group", "HVAC Kolkata", "hvac-kolkata");
  await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));

  expect(screen.queryByRole("region", { name: "Lay out the widgets" })).toBeNull();
  expect(putSpy).not.toHaveBeenCalled();
}

/** The positive half: the same create, released — the widgets wizard opens on its Layout step. */
export async function theWidgetsWizardOpensWhenTheCreateResolves(): Promise<void> {
  stubMasterData();
  const { createSpy, release } = deferredCreate();
  renderPage(asUser("admin"));

  await fillAndCreate("Asset group", "HVAC Kolkata", "hvac-kolkata");
  await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
  release(createdDashboard());

  const region = await screen.findByRole("region", { name: "Lay out the widgets" });
  expect(within(region).getByRole("region", { name: "Layout" })).toBeInTheDocument();
}

/** `F3.85` PR 9 — the widgets Submit puts the builder's widgets to the NEW dashboard's id, with
 * no tabs. Mutation: put to `""` instead of `created.id` => red. */
export async function theWidgetsSubmitPutsToTheNewDashboard(): Promise<void> {
  const putSpy = vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(createdDashboard());
  await createAs("Asset group");

  await submitWizard(layoutWizard);

  await waitFor(() => expect(putSpy).toHaveBeenCalledWith(CREATED_ID, { tabs: [], widgets: [] }));
}

/** `fetch`, stubbed at the global: the create answers the dashboard; anything else a 404. */
function stubFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v1/dashboards") && init?.method === "POST") {
      return new Response(JSON.stringify(createdDashboard()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  });
}

/** The create's `POST /dashboards`, as the stubbed `fetch` received it. */
function createCall(fetchSpy: ReturnType<typeof stubFetch>): RequestInit | undefined {
  const call = fetchSpy.mock.calls.find(
    ([input, init]) => String(input).endsWith("/api/v1/dashboards") && init?.method === "POST",
  );
  return call?.[1];
}

/** `F3.85` PR 9 (plan §10.5) — the wizard used alone, through the real `createDashboard`: the
 * `POST /dashboards` fires with the wizard's body. The positive half beside the no-header case. */
export async function theCreateRequestFiresWithTheWizardsBody(): Promise<void> {
  stubMasterData();
  const fetchSpy = stubFetch();
  renderPage(asUser("admin"));

  await fillAndCreate("Asset group", "HVAC Kolkata", "hvac-kolkata");

  await waitFor(() => expect(createCall(fetchSpy)).toBeDefined());
  expect(JSON.parse(String(createCall(fetchSpy)?.body))).toEqual({
    organizationId: ORG_1,
    name: "HVAC Kolkata",
    slug: "hvac-kolkata",
    locationId: null,
    assetGroupId: GRP_1,
  });
}

/** The absence half: that same request carries no `X-Copilot-Change` header — a copilot write goes
 * through the dock's Confirm card only. Mutation: add the header in `createDashboard` => red. */
export async function theCreateRequestCarriesNoCopilotHeader(): Promise<void> {
  stubMasterData();
  const fetchSpy = stubFetch();
  renderPage(asUser("admin"));

  await fillAndCreate("Asset group", "HVAC Kolkata", "hvac-kolkata");

  await waitFor(() => expect(createCall(fetchSpy)).toBeDefined());
  expect(new Headers(createCall(fetchSpy)?.headers).get("X-Copilot-Change")).toBeNull();
}

/** `/auth/me`'s scope for an `asset_group_admin` — `accessibleScopeSchema`'s exact shape. The
 * location's id matches the group's `locationId`, so `scopeAssetGroupOptions` resolves the
 * label `Hvac — Western Cape`; a miss would degrade it to `Hvac` for a fixture reason. */
function signInAsAssetGroupAdmin(): void {
  useAuthStore.setState({
    scope: {
      kind: "asset_group",
      locations: [
        { id: LOC_1, code: "WC", slug: "western-cape", name: "Western Cape", type: "smoc_campus", province: null, parentId: null },
      ],
      assetGroups: [{ id: GRP_1, locationId: LOC_1, code: "hvac", name: "Hvac", organizationId: ORG_1 }],
      assetIds: ["a1"],
    },
  });
}

/** Renders the role's create page, opens the Scope step and waits for its one radio, checked —
 * the fields' clamp has rewritten the page's default `location` state to an unchosen group by
 * then. This is the positive control every absence assertion below sits beside. */
async function renderAssetGroupAdminsPage(): Promise<void> {
  stubMasterData();
  signInAsAssetGroupAdmin();
  renderPage(asUser("asset_group_admin"));
  await openScopeStep();
  await screen.findByRole("radio", { name: "Asset group", checked: true });
}

/** `GET /admin/organizations` is a 403 for the role; `organizationsQ` is gated on
 * `canCreateOrganizationWideDashboard`. Mutation: drop that `enabled` clause ⇒ red. */
export async function assetGroupAdminsCreateFormDoesNotFetchOrganizations(): Promise<void> {
  await renderAssetGroupAdminsPage();
  expect(organizationsApi.fetchAdminOrganizations).not.toHaveBeenCalled();
}

/** `GET /admin/locations` is a 403 for the role; the hook gates it on
 * `canChooseLocationDashboardScope`. Mutation: drop that clause ⇒ red. */
export async function assetGroupAdminsCreateFormDoesNotFetchLocations(): Promise<void> {
  await renderAssetGroupAdminsPage();
  expect(locationsApi.fetchAdminLocations).not.toHaveBeenCalled();
}

/** `GET /admin/asset-groups` stays refused for the role (Amendment 6 §Q1 point 2); the hook
 * reads the store instead. Mutation: gate the admin query on the group predicate alone ⇒ red. */
export async function assetGroupAdminsCreateFormDoesNotFetchAdminAssetGroups(): Promise<void> {
  await renderAssetGroupAdminsPage();
  expect(assetGroupsApi.fetchAdminAssetGroups).not.toHaveBeenCalled();
}

/** The group list is the store's `scope.assetGroups`, labelled with the location resolved from
 * `scope.locations`. Mutation: feed the role `[]` instead of the store ⇒ red. */
export async function assetGroupAdminsGroupListComesFromItsOwnScope(): Promise<void> {
  await renderAssetGroupAdminsPage();
  expect(await screen.findByRole("option", { name: "Hvac — Western Cape" })).toBeInTheDocument();
}

/** The role's create: the group chosen on Scope, then Basics filled, then Submit. */
async function assetGroupAdminCreates(): Promise<void> {
  await renderAssetGroupAdminsPage();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), GRP_1);
  await userEvent.click(within(createWizard()).getByRole("button", { name: "Back" }));
  await userEvent.type(await within(createWizard()).findByLabelText("Name"), "HVAC Western Cape");
  await userEvent.type(within(createWizard()).getByLabelText("Slug"), "hvac-western-cape");
  await submitWizard(createWizard);
}

/** The create body derives `organizationId` from the chosen group's own `organizationId`
 * (`accessAssetGroupSchema`, Unit 2) — the role has no organization list to take it from.
 * Mutation: derive it from `""` ⇒ red. */
export async function assetGroupAdminCreatesAGroupDashboardFromItsOwnScope(): Promise<void> {
  const createSpy = vi
    .spyOn(dashboardsApi, "createDashboard")
    .mockResolvedValue(createdDashboard({ slug: "hvac-western-cape", name: "HVAC Western Cape" }));
  await assetGroupAdminCreates();

  await waitFor(() => {
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_1, assetGroupId: GRP_1, locationId: null }),
    );
  });
}

/** The `F3.34` residual its closure recorded: a `location_admin` issued an unread
 * `GET /admin/asset-groups` on every builder load. The hook's admin query is gated on
 * `canChooseAssetGroupDashboardScope`, which refuses the role. Mutation: drop the clause ⇒ red. */
export async function locationAdminDoesNotFetchAssetGroups(): Promise<void> {
  stubMasterData();
  renderPage(asUser("location_admin"));

  await openScopeStep();
  await screen.findByRole("radio", { name: "Location" });
  expect(assetGroupsApi.fetchAdminAssetGroups).not.toHaveBeenCalled();
}

/** The page passes the AUTHOR's role to `WidgetInspector`, whose `PointPicker` forks on it
 * (Unit 6): for the role the picker's first control is the `Asset` select from
 * `GET /assets?organizationId=`, not the master-data `Location` chain. Surfaced by mutation —
 * a hard-coded `role="admin"` survived every other case in this file. Mutation: pass a
 * constant master-data role ⇒ red. */
export async function assetGroupAdminsWidgetInspectorOffersTheAssetChain(): Promise<void> {
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue(
    createdDashboard({ slug: "hvac-western-cape", name: "HVAC Western Cape" }),
  );
  await assetGroupAdminCreates();

  // The picker's asset read is gated on a chosen organization, which the created dashboard holds.
  await userEvent.click(await within(await screen.findByRole("region", { name: "Lay out the widgets" })).findByRole("button", { name: "+ Value tile" }));

  expect(await screen.findByRole("combobox", { name: "Asset" })).toBeInTheDocument();
}

/** A null store scope (no session written yet) is an EMPTY list for the role, not a crash: the
 * hook guards the `scopeAssetGroupOptions` call. The form still renders its one radio and the
 * select with only the placeholder. Mutation: call `scopeAssetGroupOptions` unguarded ⇒ a
 * TypeError on first render ⇒ red. */
export async function assetGroupAdminWithNoStoreScopeGetsAnEmptyGroupList(): Promise<void> {
  stubMasterData();
  useAuthStore.setState({ scope: null });
  renderPage(asUser("asset_group_admin"));

  await openScopeStep();
  await screen.findByRole("radio", { name: "Asset group", checked: true });
  const values = within(screen.getByRole("combobox", { name: "Asset group" }))
    .getAllByRole("option")
    .map((option) => (option as HTMLOptionElement).value);
  expect(values).toEqual([""]);
}

/** `F3.32` review finding (High), as `F3.85` PR 9 leaves it: a mimic switched off its group scope
 * after it was added can no longer arise (the widgets are composed after the create, on a scope
 * no step can change), so the case that pinned its refusal is retired and the organization-wide
 * half is `createPageOffersPlantMimicOnlyOnAGroupScope`. This is the positive control that stays:
 * on a group dashboard a mimic is added with no scope sentence, and the widgets Submit sends it. */
export async function aMimicOnAGroupScopeLeavesCreateEnabled(): Promise<void> {
  const putSpy = vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(createdDashboard());
  await createAs("Asset group");
  await userEvent.click(within(layoutWizard()).getByRole("button", { name: /Plant mimic/i }));

  expect(screen.queryByText(/A plant mimic needs an asset-group scope./)).not.toBeInTheDocument();
  await submitWizard(layoutWizard);
  await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
}

/** `F3.85` PR 9 review fix (C3) — a Scope fill that names a location after the author chose a
 * group makes a location scope. The shell merges the fill over the form's values, so the group id
 * is still there; the old mapper read the group first and dropped the location. Mutation: read the
 * kind in the old order (group id first, whatever changed) => red. */
export async function aLocationFillAfterAGroupChoiceChoosesTheLocation(): Promise<void> {
  stubMasterData();
  renderPage(asUser("admin"));
  await openScopeStep();
  await userEvent.click(screen.getByRole("radio", { name: "Asset group" }));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Asset group" }), GRP_1);

  act(() => {
    useWizardStore.getState().receiveFill({ catalogId: "dashboard.create", stepId: "scope", values: { locationId: LOC_1 } });
  });

  expect(await screen.findByRole("radio", { name: "Location", checked: true })).toBeInTheDocument();
}

/** A `location_admin` fills Basics, chooses its location (which sets the organization) and
 * reaches Review. */
async function locationAdminReachesReview() {
  stubMasterData();
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue(createdDashboard());
  renderPage(asUser("location_admin"));
  await userEvent.type(await within(createWizard()).findByLabelText("Name"), "Kolkata");
  await userEvent.type(within(createWizard()).getByLabelText("Slug"), "kolkata");
  await openScopeStep();
  await screen.findByRole("option", { name: "Kolkata Works" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), LOC_1);
  await userEvent.click(within(createWizard()).getByRole("button", { name: "Next" }));
  await within(createWizard()).findByRole("button", { name: "Submit" });
  return createSpy;
}

/** Review fix (PR9-SEC-2) — the positive control: the `location_admin`'s own location creates. */
export async function locationAdminCreatesOnItsOwnLocation(): Promise<void> {
  const createSpy = await locationAdminReachesReview();
  await userEvent.click(within(createWizard()).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
}

/** Review fix (PR9-SEC-2) — a Scope fill of two nulls that lands on Review would make an
 * organization-wide body, a kind the role is never offered. The page's own clamp rewrites it to
 * an unchosen location, so Submit sends nothing. Mutation: drop the page's clamp effect => red. */
export async function anOrganizationWideFillOnReviewDoesNotCreateForALocationAdmin(): Promise<void> {
  const createSpy = await locationAdminReachesReview();
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "dashboard.create",
      stepId: "scope",
      values: { locationId: null, assetGroupId: null },
    });
  });
  await userEvent.click(within(createWizard()).getByRole("button", { name: "Submit" }));
  expect(createSpy).not.toHaveBeenCalled();
}

/** An organization-wide dashboard created, a Breaker table added (it reads a group, so on this
 * scope it is always empty — a builder problem the API and the Layout parse both accept), and the
 * widgets wizard taken to Review. */
async function aBreakerTableOnAnOrganizationWideDashboard() {
  const putSpy = vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(createdDashboard());
  await createAs("Organization-wide");
  await userEvent.click(within(layoutWizard()).getByRole("button", { name: "+ Breaker table" }));
  await submitWizard(layoutWizard);
  return putSpy;
}

/** Review fix (compliance F1) — the case reaches Review, so the guard that refuses it is the
 * page's `problems` check in the widgets `onSubmit`, not the step parse. */
export async function aBreakerTableOnAnOrganizationWideDashboardReachesReview(): Promise<void> {
  await aBreakerTableOnAnOrganizationWideDashboard();
  expect(within(layoutWizard()).getByText("Fix the problems on the Layout step to save.")).toBeInTheDocument();
}

/** The request half: no PUT. Mutation: send whatever `problems` holds in the widgets `onSubmit` => red. */
export async function aBreakerTableOnAnOrganizationWideDashboardSendsNoPut(): Promise<void> {
  const putSpy = await aBreakerTableOnAnOrganizationWideDashboard();
  expect(putSpy).not.toHaveBeenCalled();
}

/** Review fix (C4) — a widget added by a click is no field `change`, so the shell would let Cancel
 * leave for the edit page at once and lose it: the page's `dirty` prop (`rows.length > 0`) makes
 * the shell ask first. Mutation: drop the page's `dirty` prop => red. */
export async function cancellingClickOnlyLayoutWorkAsksFirst(): Promise<void> {
  await createAs("Organization-wide");
  await userEvent.click(within(layoutWizard()).getByRole("button", { name: "+ Value tile" }));
  await userEvent.click(within(layoutWizard()).getByRole("button", { name: "Cancel" }));

  expect(within(layoutWizard()).getByRole("alertdialog", { name: "Leave the wizard" })).toBeInTheDocument();
}
