import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminOrganizationDto } from "@bms/shared";

import * as api from "../../api/admin/organizations";
import type { AuthUser } from "../../stores/auth-store";
import { OrganizationsAdminPage } from "./organizations-page";

/**
 * `E4.1c` / ADR 0070 decision 8 — the organization form's Currency field,
 * rendered (ADR 0042). Assertions live here; `organizations-page.test.tsx` is
 * the Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * The harness is `locations-page.spec.tsx`'s: real component, real TanStack
 * Query, `vi.spyOn` on the API module. Queries go by label and text (ADR 0042
 * decision 5).
 */

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

function organization(overrides: Partial<AdminOrganizationDto>): AdminOrganizationDto {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    code: "E41C-SPEC",
    name: "Spec organization",
    active: true,
    currency: "ZAR",
    meta: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

/** Two rows with two currencies, so O3 can tell the column from a constant. */
const ORGANIZATIONS = {
  items: [
    organization({
      id: "11111111-1111-1111-1111-111111111111",
      code: "E41C-ZAR",
      name: "Rand organization",
      currency: "ZAR",
    }),
    organization({
      id: "22222222-2222-2222-2222-222222222222",
      code: "E41C-INR",
      name: "Rupee organization",
      currency: "INR",
    }),
  ],
};

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrganizationsAdminPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubApi(): void {
  vi.spyOn(api, "fetchAdminOrganizations").mockResolvedValue(ORGANIZATIONS);
  vi.spyOn(api, "createAdminOrganization").mockResolvedValue(ORGANIZATIONS.items[0]!);
  vi.spyOn(api, "updateAdminOrganization").mockResolvedValue(ORGANIZATIONS.items[0]!);
}

async function openCreateForm(): Promise<void> {
  await screen.findByText("Rand organization");
  await userEvent.click(screen.getByRole("button", { name: "Add organization" }));
  await screen.findByRole("heading", { name: "Add organization" });
}

/** O1 — the form has a Currency input bound to a datalist with at least one option. */
export async function formHasACurrencyInputWithADatalist(): Promise<void> {
  stubApi();
  renderPage();
  await openCreateForm();

  const input = screen.getByLabelText("Currency (ISO 4217)") as HTMLInputElement;
  expect(input.getAttribute("list")).toBe("currency-list");
  expect(input.required, "the field is required on create — the API refuses a create without it").toBe(true);
  const list = document.getElementById("currency-list");
  expect(list, "the datalist the input names must exist").not.toBeNull();
  expect(list!.querySelectorAll("option").length).toBeGreaterThanOrEqual(1);
  // The options are the engine's ISO 4217 table, not a constant: INR is in it.
  expect(list!.querySelector('option[value="INR"]')).not.toBeNull();
}

/** O2 — a lower-case `inr` is submitted as `currency: "INR"`, beside the code and name. */
export async function typedCurrencyIsUppercasedAndSubmitted(): Promise<void> {
  stubApi();
  renderPage();
  await openCreateForm();
  await userEvent.type(screen.getByLabelText("Code"), "e41c-new");
  await userEvent.type(screen.getByLabelText("Name"), "New organization");
  await userEvent.type(screen.getByLabelText("Currency (ISO 4217)"), "inr");

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.createAdminOrganization).toHaveBeenCalledTimes(1);
  });
  const payload = vi.mocked(api.createAdminOrganization).mock.calls[0]![0];
  expect(payload).toHaveProperty("currency", "INR");
  // Adjacent negative: a field wired to the neighbouring key would pass the
  // line above only if Code had received the currency — it did not.
  expect(payload.code).toBe("E41C-NEW");
  expect(payload.name).toBe("New organization");
}

/** O3 — the list has a Currency column carrying each row's own code. */
export async function listRendersTheCurrencyColumn(): Promise<void> {
  stubApi();
  renderPage();
  const rand = (await screen.findByText("Rand organization")).closest("tr")!;
  const rupee = screen.getByText("Rupee organization").closest("tr")!;

  expect(screen.getByRole("columnheader", { name: "Currency" })).toBeInTheDocument();
  expect(within(rand).getByText("ZAR")).toBeInTheDocument();
  expect(within(rupee).getByText("INR")).toBeInTheDocument();
  // Negative beside the positive: the rand row does not carry the rupee code.
  expect(within(rand).queryByText("INR")).toBeNull();
}

/** O4 — editing a row prefills the Currency input, and the update sends it. */
export async function editPrefillsTheCurrencyAndSendsIt(): Promise<void> {
  stubApi();
  renderPage();
  const row = (await screen.findByText("Rupee organization")).closest("tr")!;
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
  await screen.findByRole("heading", { name: "Edit organization" });

  const input = screen.getByLabelText("Currency (ISO 4217)") as HTMLInputElement;
  expect(input.value).toBe("INR");

  await userEvent.clear(input);
  await userEvent.type(input, "usd");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.updateAdminOrganization).toHaveBeenCalledTimes(1);
  });
  const [id, payload] = vi.mocked(api.updateAdminOrganization).mock.calls[0]!;
  expect(id).toBe("22222222-2222-2222-2222-222222222222");
  expect(payload).toEqual({ name: "Rupee organization", currency: "USD" });
}
