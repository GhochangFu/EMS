import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminPointKeyDto } from "@bms/shared";

import * as api from "../../api/admin/point-keys";
import * as assetsApi from "../../api/assets";
import * as systemStatusApi from "../../api/system-status";
import type { AuthUser } from "../../stores/auth-store";
import { PointKeysAdminPage } from "./point-keys-page";

/**
 * `F3.68` / ADR 0076 decision 7 — the headline rank on `/admin/point-keys`
 * (plan U3, W1–W5). Assertions live here; `point-keys-page.test.tsx` is the
 * Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * **The page renders `AppShell`**, through `MasterDataLayout` — the plan's
 * "no `AppShell`" note was wrong. `AppShell` polls `fetchSystemStatus`, so it
 * is stubbed: an unstubbed fetch reaches the real API on :4000 (the `F4.160`
 * lesson). `fetchAssets` is also stubbed, kept from the F4.156 interim gate
 * (removed as of `F3.70` U5b) in case another render path still reaches it.
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const orgAdmin: AuthUser = {
  id: "u2",
  email: "phe-admin@bms.local",
  displayName: "Org Admin",
  role: "organization_admin",
} as unknown as AuthUser;

/**
 * Domain and unit are non-null on both rows, so the only `—` a row can render
 * is the rank's — W1 reads the cell under the "Headline rank" header anyway.
 */
const RANKED: AdminPointKeyDto = {
  id: "aaaa0000-0000-4000-8000-000000000001",
  code: "f368_spec_ranked",
  name: "Spec ranked",
  domain: "electrical",
  unit: "kW",
  description: null,
  active: true,
  createdAt: new Date(0).toISOString(),
  headlineRank: 3,
};

const UNRANKED: AdminPointKeyDto = {
  id: "aaaa0000-0000-4000-8000-000000000002",
  code: "f368_spec_unranked",
  name: "Spec unranked",
  domain: "electrical",
  unit: "kWh",
  description: null,
  active: true,
  createdAt: new Date(0).toISOString(),
  headlineRank: null,
};

function stubApi() {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  vi.spyOn(api, "fetchAdminPointKeys").mockResolvedValue({ items: [RANKED, UNRANKED] });
  return {
    update: vi.spyOn(api, "updateAdminPointKey").mockResolvedValue(RANKED),
    create: vi.spyOn(api, "createAdminPointKey").mockResolvedValue(RANKED),
  };
}

function renderPage(as: AuthUser): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/point-keys"]}>
        <PointKeysAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The `<tr>` holding `code`, once the list has rendered. */
async function rowFor(code: string): Promise<HTMLElement> {
  const cell = await screen.findByText(code);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no <tr> around ${code}`);
  return row as HTMLElement;
}

/** The text of `row`'s cell under the "Headline rank" header. */
function rankCell(row: HTMLElement): string {
  const headers = screen.getAllByRole("columnheader").map((th) => th.textContent?.trim());
  const index = headers.indexOf("Headline rank");
  expect(index, "no Headline rank column header").toBeGreaterThanOrEqual(0);
  return within(row).getAllByRole("cell")[index]?.textContent?.trim() ?? "";
}

async function openEdit(code: string): Promise<HTMLInputElement> {
  const row = await rowFor(code);
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
  return (await screen.findByLabelText("Headline rank")) as HTMLInputElement;
}

/**
 * W6 (step-5 finding Q1) — the rank field's hint does not promise that
 * clearing is permanent: `seedPointKeyHeadlineRanks` refills a NULL rank on a
 * seeded code at the next `pnpm db:seed` (OQ3 protects a set rank, not a
 * cleared one). Read through the field's `aria-describedby`, so the hint is
 * the one the field names.
 */
export async function rankHintSaysASeededCodeIsReRanked(): Promise<void> {
  stubApi();
  renderPage(admin);
  const field = await openEdit(RANKED.code);
  const hintId = field.getAttribute("aria-describedby") ?? "";
  expect(document.getElementById(hintId)?.textContent).toBe(
    "Lower shows first on a generated site card. Leave empty to unrank; a seeded code gets its default rank again on the next seed.",
  );
}

/** W1 — the column shows `3` for a ranked key. */
export async function columnShowsTheRank(): Promise<void> {
  stubApi();
  renderPage(admin);
  expect(rankCell(await rowFor(RANKED.code))).toBe("3");
}

/** W1b — and `—` for an unranked one. */
export async function columnShowsADashForNoRank(): Promise<void> {
  stubApi();
  renderPage(admin);
  expect(rankCell(await rowFor(UNRANKED.code))).toBe("—");
}

/** W2 — clearing the field sends an explicit `headlineRank: null`, for that id. */
export async function clearingSendsNull(): Promise<void> {
  const { update } = stubApi();
  renderPage(admin);
  const field = await openEdit(RANKED.code);
  expect(field.value, "the modal must open with the stored rank").toBe("3");
  await userEvent.clear(field);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  const [id, body] = update.mock.calls[0]!;
  expect(id).toBe(RANKED.id);
  // `toHaveProperty`, not `toMatchObject({ headlineRank: undefined })`: the
  // key must be PRESENT with `null`, or `JSON.stringify` drops it and the
  // rank is never cleared.
  expect(body).toHaveProperty("headlineRank", null);
}

/** W3 — typing `2` sends the number `2`. */
export async function typingTwoSendsTwo(): Promise<void> {
  const { update } = stubApi();
  renderPage(admin);
  const field = await openEdit(UNRANKED.code);
  expect(field).toHaveAttribute("type", "text");
  expect(field).toHaveAttribute("inputmode", "numeric");
  await userEvent.type(field, "2");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  const [id, body] = update.mock.calls[0]!;
  expect(id).toBe(UNRANKED.id);
  expect(body).toHaveProperty("headlineRank", 2);
}

/** W4 — `x` is refused on the page, with no API call. */
export async function aNonNumberIsRefusedWithoutACall(): Promise<void> {
  const { update } = stubApi();
  // A request that never settles: were the page to send one, the modal and
  // its error text would stay, so only the no-call assertion can fail.
  update.mockImplementation(() => new Promise(() => undefined));
  renderPage(admin);
  const field = await openEdit(UNRANKED.code);
  await userEvent.type(field, "x");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/must be a whole number/)).toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
}

/** W5 — an `organization_admin` sees the rows and no Edit button. */
export async function organizationAdminSeesNoEdit(): Promise<void> {
  stubApi();
  renderPage(orgAdmin);
  const row = await rowFor(RANKED.code);
  // Positive control: the row rendered, with its read-only marker and rank.
  expect(within(row).getByText("Read only")).toBeInTheDocument();
  expect(rankCell(row)).toBe("3");
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
}
