import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/dashboard-templates";
import * as groupsApi from "../../api/admin/asset-groups";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { DashboardTemplateDetailPage } from "./dashboard-template-detail-page";

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

const TEMPLATE_ID = "11111111-1111-1111-1111-111111111111";

function draftTemplate() {
  return {
    id: TEMPLATE_ID,
    organizationId: "org-1",
    code: "ELECTRICAL",
    version: 1,
    name: "Electrical overview",
    section: "electrical",
    description: null,
    status: "draft",
    content: { widgets: [] },
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function publishedTemplate() {
  return {
    ...draftTemplate(),
    status: "published",
    publishedAt: new Date(0).toISOString(),
    content: {
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
function roleFreeTemplate() {
  return {
    ...publishedTemplate(),
    section: "sustainability",
    content: {
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

const GROUPS = { items: [{ id: "grp-1", name: "Electrical train", locationName: "Plant 1", memberCount: 2 }] };

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [{ code: "incoming-supply", label: "Incoming Supply", sortOrder: 10, active: true }],
  dashboardSections: [],
  waterBalanceRoles: [],
};

function stubApi(overrides: Partial<Record<string, unknown>> = {}): void {
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

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

/**
 * The load-bearing assertion: a `partial` widget is named, with its
 * `matchedMembers` and `boundPoints`, inside the instantiate dialog itself —
 * ADR 0049 Amendment 2 decisions 1 and 6.
 */
export async function resolutionReportNamesAPartialWidget(): Promise<void> {
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateAdminDashboardTemplate: () =>
      Promise.resolve({
        dashboard: { id: "d1", name: "Electrical train dashboard" },
        resolutions: [
          { widgetKey: "w1", assetRoleCodes: ["incoming-supply"], matchedMembers: 3, boundPoints: 2, outcome: "partial" },
        ],
      }),
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Asset group" }),
    "grp-1",
  );
  await userEvent.type(screen.getByRole("textbox", { name: "Slug" }), "electrical-p1");
  await userEvent.click(screen.getByRole("button", { name: "Confirm instantiate" }));

  // `getByRole("cell", …)` rather than `getByText("w1")`: the widget editor
  // below the (still-mounted) dialog also shows the key "w1" as a label, and
  // the resolution table is what must name it — that is the assertion, so it
  // is scoped to the table cell rather than to any element with that text.
  await waitFor(() => {
    expect(screen.getByRole("cell", { name: "w1" })).toBeInTheDocument();
  });
  expect(screen.getByRole("cell", { name: "3" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument();
  expect(screen.getByText(/Partial/)).toBeInTheDocument();
  expect(screen.getByText(/Electrical train dashboard/)).toBeInTheDocument();
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

/** The dialog sends `assetGroupId: null` when the organization-wide option is
 * chosen — the sentinel `__organization_wide__` is a `<select>` value and must
 * never reach the wire. */
export async function organizationWideOptionSendsANullAssetGroup(): Promise<void> {
  const calls: unknown[] = [];
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(roleFreeTemplate()),
    instantiateAdminDashboardTemplate: (_id: string, input: unknown) => {
      calls.push(input);
      return Promise.resolve({ dashboard: { id: "d1", name: "Sustainability" }, resolutions: [] });
    },
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Asset group" }),
    "__organization_wide__",
  );
  await userEvent.type(screen.getByRole("textbox", { name: "Slug" }), "enterprise");
  await userEvent.click(screen.getByRole("button", { name: "Confirm instantiate" }));

  await waitFor(() => {
    expect(calls).toHaveLength(1);
  });
  expect((calls[0] as { assetGroupId: unknown }).assetGroupId).toBeNull();
}

/**
 * `E4.2` PR 2 sweep — **the dialog gates on the slug RULE, not on emptiness.**
 *
 * PR 2 tightened `instantiateSectionTemplateBodySchema.slug` to
 * `.min(2).max(64)` on `/^[a-z0-9-]+$/` and left `canSubmit` asking only for a
 * character, so an administrator who typed a name filled the whole form and got
 * a 400 on submit.
 *
 * The enabled half is the adjacent positive control, and it is in this function
 * on purpose: a dialog whose button was disabled for an unrelated reason (a
 * group never chosen, a mutation in flight) would pass the refusal alone.
 */
export async function aTypedNameLeavesTheInstantiateButtonDisabled(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(roleFreeTemplate()) });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Asset group" }),
    "__organization_wide__",
  );
  const slugField = screen.getByRole("textbox", { name: "Slug" });
  await userEvent.type(slugField, "Sustainability Overview");
  expect(
    screen.getByRole("button", { name: "Confirm instantiate" }),
    "a capital and a space are a 400 from the API — the form must not offer to send them",
  ).toBeDisabled();

  await userEvent.clear(slugField);
  await userEvent.type(slugField, "sustainability-overview");
  expect(
    screen.getByRole("button", { name: "Confirm instantiate" }),
    "the positive control — the same form with a valid slug submits",
  ).toBeEnabled();
}
