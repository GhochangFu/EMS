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

const GROUPS = { items: [{ id: "grp-1", name: "Electrical train", locationName: "Plant 1", memberCount: 2 }] };

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [{ code: "incoming-supply", label: "Incoming Supply", sortOrder: 10, active: true }],
  dashboardSections: [],
};

function stubApi(overrides: Partial<Record<string, unknown>> = {}): void {
  vi.spyOn(groupsApi, "fetchAdminAssetGroups").mockResolvedValue(GROUPS as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  for (const [name, impl] of Object.entries(overrides)) {
    vi.spyOn(api, name as keyof typeof api).mockImplementation(impl as never);
  }
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/dashboard-templates/${TEMPLATE_ID}`]}>
        <Routes>
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
