import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/dashboard-templates";
import * as orgApi from "../../api/admin/organizations";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { DashboardTemplatesAdminPage } from "./dashboard-templates-page";

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

const ORGS = {
  items: [{ id: "org-1", code: "IX", name: "Ion Exchange" }],
};

/** Deliberately not the seeded six sections — the `F4.43` guard's fixture shape. */
const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
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

/** The section filter comes from the vocabulary fetch, not a hardcoded list. */
export async function sectionFilterComesFromTheVocabularyFetch(): Promise<void> {
  stubApi();
  renderPage();

  const select = await screen.findByRole("combobox", { name: "Filter by section" });
  await waitFor(() => {
    expect(select.textContent).toContain("Spec Section");
  });
}

/** Importing requires an organization, then calls the API and refreshes the list. */
export async function importCallsTheApiWithTheChosenOrganization(): Promise<void> {
  stubApi();
  renderPage();

  const importButton = await screen.findByRole("button", { name: "Import Electrical (stock)" });
  expect(importButton).toBeDisabled();

  const orgSelect = screen.getByRole("combobox", { name: "Import into organization" });
  await userEvent.selectOptions(orgSelect, "org-1");
  expect(importButton).not.toBeDisabled();

  await userEvent.click(importButton);
  await waitFor(() => {
    expect(api.importAdminStockDashboardTemplate).toHaveBeenCalledWith(
      "electrical-default",
      "org-1",
    );
  });
}
