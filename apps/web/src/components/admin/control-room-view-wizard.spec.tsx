import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import type {
  AdminAssetGroupListResponse,
  DashboardSummaryDto,
  DashboardsListResponse,
  SiteControlRoomViewSettingDto,
} from "@bms/shared";

import * as groupsApi from "../../api/admin/asset-groups";
import * as api from "../../api/admin/locations";
import * as dashboardsApi from "../../api/dashboards";
import { useWizardStore } from "../../stores/wizard-store";
import { ControlRoomViewWizard } from "./control-room-view-wizard";

/**
 * `F3.86` PR 3d (plan §5.5, ruling Q7(b)) — the `location.controlRoomView.set`
 * wizard: View, then Review. The field cases (W3, W7–W10) moved here from
 * `locations-page.control-room-view.spec.tsx` with the field; the page spec
 * now holds that the Edit form has none and sends no second write.
 *
 * The reads are spies; the `PUT` runs the real `putSiteControlRoomView`
 * against a stubbed `fetch`, so the body and the headers are the wire's.
 * Vitest entry point: the sibling `.test.tsx` (jsdom docblock there).
 */

const ORG_ID = "33333333-3333-4333-8333-333333333333";
const SITE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SITE_ID = "22222222-2222-4222-8222-222222222222";
const SITE_GROUP_ID = "44444444-4444-4444-8444-444444444444";
const SITE_DASHBOARD_ID = "55555555-5555-4555-8555-555555555551";
const GROUP_DASHBOARD_ID = "55555555-5555-4555-8555-555555555552";
const OTHER_DASHBOARD_ID = "55555555-5555-4555-8555-555555555553";
const ASSET_DASHBOARD_ID = "55555555-5555-4555-8555-555555555554";

const FAIL_FAST = { onTimeout: (error: Error) => error };
const SITE = { id: SITE_ID, name: "RSMOC-like site", organizationId: ORG_ID };

function setting(overrides: Partial<SiteControlRoomViewSettingDto> = {}): SiteControlRoomViewSettingDto {
  return {
    locationId: SITE_ID,
    organizationId: ORG_ID,
    kind: "generated",
    dashboardId: null,
    builtinKey: null,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function dashboard(overrides: Partial<DashboardSummaryDto>): DashboardSummaryDto {
  return {
    id: SITE_DASHBOARD_ID,
    organizationId: ORG_ID,
    slug: "site-dashboard",
    name: "Site dashboard",
    description: null,
    locationId: null,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    assetCode: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    widgetCount: 0,
    ...overrides,
  };
}

/** One of each scope: the site's own, one of its groups', another site's, and an asset's. */
const DASHBOARDS: DashboardsListResponse = {
  items: [
    dashboard({ id: SITE_DASHBOARD_ID, slug: "site-dashboard", name: "Site dashboard", locationId: SITE_ID }),
    dashboard({ id: GROUP_DASHBOARD_ID, slug: "group-dashboard", name: "Group dashboard", assetGroupId: SITE_GROUP_ID }),
    dashboard({ id: OTHER_DASHBOARD_ID, slug: "other-dashboard", name: "Other site dashboard", locationId: OTHER_SITE_ID }),
    dashboard({ id: ASSET_DASHBOARD_ID, slug: "asset-dashboard", name: "Asset dashboard", assetId: "66666666-6666-4666-8666-666666666666", assetCode: "P-1" }),
  ],
} as DashboardsListResponse;

const GROUPS: AdminAssetGroupListResponse = {
  items: [
    {
      id: SITE_GROUP_ID,
      code: "F367-G1",
      name: "Site group",
      description: null,
      locationId: SITE_ID,
      locationName: "RSMOC-like site",
      organizationId: ORG_ID,
      memberCount: 0,
      createdAt: new Date(0).toISOString(),
    },
  ],
};

type WireCall = { url: string; init: RequestInit };

/** Spies the three reads; stubs `fetch` for the `PUT`, answering `status` with the stored setting or `refusal`. */
function stub(stored: SiteControlRoomViewSettingDto, status = 200, refusal = ""): { calls: WireCall[]; onClose: () => void } {
  vi.spyOn(api, "fetchSiteControlRoomView").mockResolvedValue(stored);
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(DASHBOARDS);
  vi.spyOn(groupsApi, "fetchAdminAssetGroups").mockResolvedValue(GROUPS);
  const calls: WireCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return status === 200
      ? new Response(JSON.stringify(stored), { status })
      : new Response(refusal, { status });
  });
  return { calls, onClose: vi.fn() };
}

function renderWizard(canSetBuiltin: boolean, onClose: () => void): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ControlRoomViewWizard location={SITE} canSetBuiltin={canSetBuiltin} onClose={onClose} />
    </QueryClientProvider>,
  );
}

function viewSelect(): HTMLSelectElement {
  return screen.getByLabelText("Control Room view") as HTMLSelectElement;
}

async function waitForStoredKind(kind: SiteControlRoomViewSettingDto["kind"]): Promise<void> {
  await waitFor(() => expect(viewSelect().value).toBe(kind), FAIL_FAST);
}

async function next(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

async function submit(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }, FAIL_FAST));
}

function puts(calls: WireCall[]): WireCall[] {
  return calls.filter((call) => call.init.method === "PUT");
}

/** The wizard's one step is View, then Review (the entry's order). */
export async function theStepsAreViewThenReview(): Promise<void> {
  stub(setting());
  renderWizard(true, vi.fn());
  await waitForStoredKind("generated");
  const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
  expect(steps.map((step) => step.textContent)).toEqual(["1. View", "2. Review"]);
  expect(steps[0]).toHaveAttribute("aria-current", "step");
}

/** A stored `dashboard` shows as Now, beside the new kind. Mutation: drop `current`. */
export async function theStoredDashboardShowsAsNow(): Promise<void> {
  stub(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderWizard(true, vi.fn());
  await waitForStoredKind("dashboard");
  await userEvent.selectOptions(viewSelect(), "generated");
  await next();

  expect(await screen.findByRole("columnheader", { name: "Now" }, FAIL_FAST)).toBeInTheDocument();
  const kindRow = screen.getByRole("rowheader", { name: "Kind" }).closest("tr")!;
  expect(Array.from(kindRow.querySelectorAll("td")).map((cell) => cell.textContent)).toEqual(["dashboard", "generated"]);
}

/** Picking `generated` and Submit sends the exact body, once, to the site's route. Mutation: send the draft. */
export async function generatedSendsTheExactBody(): Promise<void> {
  const { calls, onClose } = stub(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderWizard(true, onClose);
  await waitForStoredKind("dashboard");
  await userEvent.selectOptions(viewSelect(), "generated");
  await next();
  await submit();

  await waitFor(() => expect(puts(calls)).toHaveLength(1), FAIL_FAST);
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  expect(puts(calls)[0]!.url).toBe(`${base}/api/v1/admin/locations/${SITE_ID}/control-room-view`);
  expect(JSON.parse(puts(calls)[0]!.init.body as string)).toEqual({ kind: "generated" });
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), FAIL_FAST);
}

/** A wizard alone is not a copilot change: no `X-Copilot-Change` header (the PUT is the positive). */
export async function theWizardSendsNoCopilotHeader(): Promise<void> {
  const { calls } = stub(setting());
  renderWizard(true, vi.fn());
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "builtin");
  await next();
  await submit();

  await waitFor(() => expect(puts(calls)).toHaveLength(1), FAIL_FAST);
  expect(new Headers(puts(calls)[0]!.init.headers).get("X-Copilot-Change")).toBeNull();
}

/** The global admin's built-in view sends the built-in body. */
export async function anAdminsBuiltinSendsTheBuiltinBody(): Promise<void> {
  const { calls } = stub(setting());
  renderWizard(true, vi.fn());
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "builtin");
  await next();
  await submit();

  await waitFor(() => expect(puts(calls)).toHaveLength(1), FAIL_FAST);
  expect(JSON.parse(puts(calls)[0]!.init.body as string)).toEqual({ kind: "builtin", builtinKey: "smoc" });
}

/** A chosen site dashboard sends the dashboard body. */
export async function aDashboardViewSendsItsId(): Promise<void> {
  const { calls } = stub(setting());
  renderWizard(true, vi.fn());
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "dashboard");
  const picker = (await screen.findByLabelText("Control Room dashboard", undefined, FAIL_FAST)) as HTMLSelectElement;
  await within(picker).findByRole("option", { name: "Site dashboard" }, FAIL_FAST);
  await userEvent.selectOptions(picker, SITE_DASHBOARD_ID);
  await next();
  await submit();

  await waitFor(() => expect(puts(calls)).toHaveLength(1), FAIL_FAST);
  expect(JSON.parse(puts(calls)[0]!.init.body as string)).toEqual({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID });
}

/** A dashboard view with no dashboard chosen stops at Review with the schema's sentence and sends nothing. */
export async function aDashboardViewWithNoDashboardSendsNothing(): Promise<void> {
  const { calls } = stub(setting());
  renderWizard(true, vi.fn());
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "dashboard");
  await next();

  expect((await screen.findByRole("alert", undefined, FAIL_FAST)).textContent).toContain("A dashboard view needs a dashboardId");
  await submit();
  expect(puts(calls)).toEqual([]);
}

/** OQ3 — a non-admin over a stored built-in view sees it, read-only, and is offered no Submit or Next. */
export async function aNonAdminOverABuiltinIsOfferedNoSubmit(): Promise<void> {
  const { calls } = stub(setting({ kind: "builtin", builtinKey: "smoc" }));
  renderWizard(false, vi.fn());

  const select = (await screen.findByLabelText("Control Room view", undefined, FAIL_FAST)) as HTMLSelectElement;
  expect(select.value).toBe("builtin");
  expect(select).toBeDisabled();
  // Positive control beside the absences: the dialog's own Close is there.
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  expect(calls).toEqual([]);
}

/** W8c — the global admin's field on the same built-in site is enabled. */
export async function anAdminOverABuiltinGetsAnEnabledField(): Promise<void> {
  stub(setting({ kind: "builtin", builtinKey: "smoc" }));
  renderWizard(true, vi.fn());
  await waitForStoredKind("builtin");
  expect(viewSelect()).toBeEnabled();
  expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
}

/** W3 — the picker lists the site- and group-scoped dashboards, and neither another site's nor an asset's. */
export async function thePickerListsOnlyEligibleDashboards(): Promise<void> {
  stub(setting());
  renderWizard(true, vi.fn());
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "dashboard");

  const picker = (await screen.findByLabelText("Control Room dashboard", undefined, FAIL_FAST)) as HTMLSelectElement;
  await within(picker).findByRole("option", { name: "Group dashboard" }, FAIL_FAST);
  expect(within(picker).getByRole("option", { name: "Site dashboard" })).toBeInTheDocument();
  expect(within(picker).queryByRole("option", { name: "Other site dashboard" })).toBeNull();
  expect(within(picker).queryByRole("option", { name: "Asset dashboard" })).toBeNull();
}

function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.querySelectorAll("option")).map((option) => option.value);
}

/** W7a/W7b (OQ1) — `builtin` is offered to the global admin only. */
export async function builtinIsOfferedToTheGlobalAdminOnly(): Promise<void> {
  stub(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderWizard(false, vi.fn());
  await waitForStoredKind("dashboard");
  expect(optionValues(viewSelect())).toEqual(["generated", "dashboard"]);
}

export async function builtinIsOfferedToTheGlobalAdmin(): Promise<void> {
  stub(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderWizard(true, vi.fn());
  await waitForStoredKind("dashboard");
  expect(optionValues(viewSelect())).toContain("builtin");
}

async function storedDashboardPicker(): Promise<HTMLSelectElement> {
  await waitForStoredKind("dashboard");
  return (await screen.findByLabelText("Control Room dashboard", undefined, FAIL_FAST)) as HTMLSelectElement;
}

/** W10a/W10c — a deleted stored dashboard reads "(no longer available)", disabled. */
export async function aRemovedStoredDashboardIsNoLongerAvailable(): Promise<void> {
  stub(setting({ kind: "dashboard", dashboardId: null }));
  renderWizard(true, vi.fn());
  const picker = await storedDashboardPicker();
  expect(picker.selectedOptions[0]?.textContent).toBe("(no longer available)");
  expect(picker.selectedOptions[0]).toBeDisabled();
}

/** W10b — a re-scoped stored dashboard stays selected as "(no longer available)". */
export async function aRescopedStoredDashboardIsNoLongerAvailable(): Promise<void> {
  stub(setting({ kind: "dashboard", dashboardId: OTHER_DASHBOARD_ID }));
  renderWizard(true, vi.fn());
  const picker = await storedDashboardPicker();
  await within(picker).findByRole("option", { name: "Group dashboard" }, FAIL_FAST);
  expect(picker.value).toBe(OTHER_DASHBOARD_ID);
  expect(picker.selectedOptions[0]?.textContent).toBe("(no longer available)");
}

/** W9a/W9c — the untouched picker is not `required`; a touched one is. */
export async function onlyATouchedPickerIsRequired(): Promise<void> {
  stub(setting({ kind: "dashboard", dashboardId: null }));
  renderWizard(true, vi.fn());
  expect(await storedDashboardPicker()).not.toBeRequired();
  await userEvent.selectOptions(viewSelect(), "generated");
  await userEvent.selectOptions(viewSelect(), "dashboard");
  expect(await screen.findByLabelText("Control Room dashboard", undefined, FAIL_FAST)).toBeRequired();
}

/** W6 — a refused `PUT` shows the route's sentence on Review and keeps the wizard open. */
export async function aRefusedPutShowsItsSentence(): Promise<void> {
  const sentence = "Dashboard must be scoped to this site or to one of its asset groups";
  const { onClose } = stub(setting(), 400, JSON.stringify({ statusCode: 400, message: sentence }));
  renderWizard(true, onClose);
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "builtin");
  await next();
  await submit();

  expect((await screen.findByRole("alert", undefined, FAIL_FAST)).textContent).toBe(sentence);
  expect(onClose).not.toHaveBeenCalled();
}

/** A copilot `fill_step` for the View step fills the field. */
export async function aFillStepFillsTheView(): Promise<void> {
  stub(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderWizard(true, vi.fn());
  await waitForStoredKind("dashboard");
  useWizardStore.getState().receiveFill({ catalogId: "location.controlRoomView.set", stepId: "view", values: { kind: "generated" } });
  await waitForStoredKind("generated");
}
