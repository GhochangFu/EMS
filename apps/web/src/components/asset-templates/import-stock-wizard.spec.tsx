import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as orgApi from "../../api/admin/organizations";
import { resetWizardStore, useWizardStore } from "../../stores/wizard-store";
import { ImportStockWizard } from "./import-stock-wizard";

/**
 * `F4.245` review C2 (ADR 0099 Amendment 4) — the asset stock import's
 * organization is the user's pick in a select, not a field the page fixes, so
 * a copilot fill for this record sets it. Vitest entry point: the sibling
 * `.test.tsx` (ADR 0014).
 */

const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CODE = "pump-default";

function renderWizard(): void {
  resetWizardStore();
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: ORG_ID, code: "IX", name: "Ion Exchange" }],
  } as unknown as Awaited<ReturnType<typeof orgApi.fetchAdminOrganizations>>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ImportStockWizard entry={{ code: CODE, name: "Pump (stock)" }} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fillFor = (code: string) => ({
  catalogId: "assetTemplate.importStock",
  params: { code },
  stepId: "organization",
  values: { organizationId: ORG_ID },
});

/** Mutation: put back `fixedFields={["organizationId"]}` — the select stays empty. */
export async function aFillSetsTheImportsOrganization(): Promise<void> {
  renderWizard();
  await screen.findByRole("option", { name: "IX — Ion Exchange" });
  act(() => useWizardStore.getState().receiveFill(fillFor(CODE), null));
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(ORG_ID);
}

/** The adjacent negative: a fill for another stock entry's import never lands here. */
export async function aFillForAnotherStockEntryIsNotTaken(): Promise<void> {
  renderWizard();
  await screen.findByRole("option", { name: "IX — Ion Exchange" });
  act(() => useWizardStore.getState().receiveFill(fillFor("chiller-default"), null));
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
}
