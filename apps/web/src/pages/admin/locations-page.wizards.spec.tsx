import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminLocationDto } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import * as api from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { useWizardStore } from "../../stores/wizard-store";
import type { AuthUser } from "../../stores/auth-store";
import { LocationsAdminPage } from "./locations-page";
import { submitWizard, toPlaceStep } from "./locations-page.spec";

/**
 * `F3.86` PR 3a (ADR 0099 decision 6, plan §5.2) — the locations page's
 * wizards: Add is `location.create`, Edit is `location.update`, and
 * Deactivate and Reactivate are Review-only wizards (ruling Q9). Each claim
 * is one exported function; `locations-page.wizards.test.tsx` is the Vitest
 * entry point. The older page behaviours (timezone, type, the tree and the
 * move dialog) stay in `locations-page.spec.tsx` and `.tree.spec.tsx`.
 */

const ORG_ID = "33333333-3333-4333-8333-333333333333";
const ROW_ID = "11111111-1111-4111-8111-111111111111";
const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;

const ROW: AdminLocationDto = {
  id: ROW_ID,
  parentId: null,
  organizationId: ORG_ID,
  organizationCode: "PHEWB",
  organizationName: "PHE West Bengal",
  code: "LOT-1",
  slug: "lot-1",
  name: "Lotapata",
  type: "rsmoc",
  typeLabel: "RSMOC",
  province: "West Bengal",
  capital: null,
  timezone: "Asia/Kolkata",
  latitude: 22.5,
  longitude: 88.3,
  active: true,
  meta: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const ORGANIZATIONS = {
  items: [{ id: ORG_ID, code: "PHEWB", name: "PHE West Bengal", active: true, meta: null, createdAt: new Date(0).toISOString() }],
};
const TYPES = { items: [{ code: "rsmoc", label: "RSMOC" }, { code: "csmoc", label: "CSMOC" }] };

function stubApi(rows: AdminLocationDto[] = [ROW]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(api, "fetchAdminLocations").mockResolvedValue({ items: rows });
  vi.spyOn(api, "fetchAdminLocationTypes").mockResolvedValue(TYPES);
  vi.spyOn(api, "createAdminLocation").mockResolvedValue(ROW);
  vi.spyOn(api, "updateAdminLocation").mockResolvedValue(ROW);
  vi.spyOn(api, "deactivateAdminLocation").mockResolvedValue({ ...ROW, active: false });
  vi.spyOn(api, "reactivateAdminLocation").mockResolvedValue(ROW);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGANIZATIONS as never);
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocationsAdminPage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openAdd(): Promise<HTMLElement> {
  await screen.findByText("Lotapata");
  await userEvent.click(screen.getByRole("button", { name: "Add location" }));
  return screen.findByRole("dialog", { name: "Add location" });
}

async function openRowAction(action: "Edit" | "Deactivate" | "Reactivate", name = "Lotapata"): Promise<void> {
  const row = (await screen.findByText(name)).closest("tr")!;
  await userEvent.click(within(row).getByRole("button", { name: action }));
}

/** The wizard's step list, as rendered: "1. Basics", … */
function stepTitles(): string[] {
  return within(screen.getByRole("list", { name: "Steps" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

/** Every Basics field a create needs, the Organization select first. */
async function fillBasics(): Promise<void> {
  await userEvent.selectOptions(screen.getByLabelText("Organization"), ORG_ID);
  await within(screen.getByLabelText("Type")).findByText("RSMOC");
  await userEvent.type(screen.getByLabelText("code"), "PUNE-1");
  await userEvent.type(screen.getByLabelText("slug"), "pune-1");
  await userEvent.type(screen.getByLabelText("name"), "Pune Works");
}

/** The create wizard's steps are the entry's, in its order, then Review. */
export async function theCreateStepsAreTheEntrys(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  const entry = catalogEntry("location.create")!;
  expect(stepTitles()).toEqual([...entry.steps.map((step) => step.title), "Review"].map((title, i) => `${i + 1}. ${title}`));
  expect(stepTitles()).toEqual(["1. Basics", "2. Place", "3. Metadata", "4. Review"]);
}

/** A select picked first in a fresh wizard keeps its pick (the `F3.85` PR 9 regression). */
export async function aSelectPickedFirstStays(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  const organization = screen.getByLabelText("Organization") as HTMLSelectElement;
  await userEvent.selectOptions(organization, ORG_ID);
  expect(organization.value).toBe(ORG_ID);
}

/**
 * The request body is the wizard's values: every field the steps hold, as
 * Review parsed them. A literal, so a `createLocationValues` that drops a
 * field reddens this case.
 */
export async function theCreateBodyIsTheWizardsValues(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  await fillBasics();
  await toPlaceStep();
  await userEvent.type(screen.getByLabelText("Province"), "Maharashtra");
  await submitWizard();
  await waitFor(() =>
    expect(api.createAdminLocation).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      code: "PUNE-1",
      slug: "pune-1",
      name: "Pune Works",
      type: "rsmoc",
      parentId: null,
      province: "Maharashtra",
      capital: null,
      latitude: 19.076,
      longitude: 72.8777,
      timezone: null,
    }),
  );
}

/**
 * A wizard used alone sends the plain request — no `X-Copilot-Change`. Read
 * on the wire: `fetch` is stubbed and the real `createAdminLocation` runs;
 * the POST to the route sits beside the absence.
 */
export async function theCreateSendsNoCopilotHeader(): Promise<void> {
  stubApi();
  vi.mocked(api.createAdminLocation).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(ROW), { status: 201 });
  });
  renderPage();
  await openAdd();
  await fillBasics();
  await submitWizard();
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
  const post = calls.find((call) => call.init?.method === "POST") as { url: string; init: RequestInit };
  expect(post.url).toBe(`${base}/api/v1/admin/locations`);
  expect(JSON.parse(post.init.body as string)).toMatchObject({ code: "PUNE-1", organizationId: ORG_ID });
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
  vi.unstubAllGlobals();
}

/** A copilot `fill_step` fills the named step's fields only: a field of another step keeps its text. */
export async function aFillFillsItsStepOnly(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  await fillBasics();
  await toPlaceStep();
  act(() => {
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "location.create", stepId: "place", values: { province: "Gujarat", code: "HIJACK" } });
  });
  await waitFor(() => expect((screen.getByLabelText("Province") as HTMLInputElement).value).toBe("Gujarat"));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect((await screen.findByLabelText("code") as HTMLInputElement).value).toBe("PUNE-1");
}

/** The edit's Review shows the stored value beside the new one: Now, then After. */
export async function theEditReviewShowsNowBesideAfter(): Promise<void> {
  stubApi();
  renderPage();
  await openRowAction("Edit");
  await screen.findByRole("dialog", { name: "Edit location" });
  const name = screen.getByLabelText("name");
  await userEvent.clear(name);
  await userEvent.type(name, "Lotapata North");
  for (let step = 0; step < 3; step += 1) await userEvent.click(screen.getByRole("button", { name: "Next" }));
  const card = await screen.findByRole("region", { name: "Edit a location" });
  const row = within(card).getByRole("row", { name: /^name/i });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Lotapata", "Lotapata North"]);
}

/** The edit sends the plain PATCH for that row, no header, with the typed name. */
export async function theEditSendsThePatchWithoutAHeader(): Promise<void> {
  stubApi();
  vi.mocked(api.updateAdminLocation).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(ROW), { status: 200 });
  });
  renderPage();
  await openRowAction("Edit");
  const name = await screen.findByLabelText("name");
  await userEvent.clear(name);
  await userEvent.type(name, "Lotapata North");
  await submitWizard();
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
  const patch = calls.find((call) => call.init?.method === "PATCH") as { url: string; init: RequestInit };
  expect(patch.url).toBe(`${base}/api/v1/admin/locations/${ROW_ID}`);
  expect(JSON.parse(patch.init.body as string)).toMatchObject({ name: "Lotapata North" });
  expect(new Headers(patch.init.headers).get("X-Copilot-Change")).toBeNull();
  vi.unstubAllGlobals();
}

/** Deactivate is Review alone, red, and Submit sends the plain `POST …/deactivate` for that row. */
export async function deactivateIsARedReviewThatPosts(): Promise<void> {
  stubApi();
  renderPage();
  await openRowAction("Deactivate");
  const dialog = await screen.findByRole("dialog", { name: "Deactivate Lotapata" });
  expect(stepTitles()).toEqual(["1. Review"]);
  const card = within(dialog).getByRole("region", { name: "Deactivate a location" });
  expect(card.className).toContain("border-critical-line");
  expect(api.deactivateAdminLocation).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(api.deactivateAdminLocation).toHaveBeenCalledWith(ROW_ID));
  expect(api.reactivateAdminLocation).not.toHaveBeenCalled();
}

/** Reactivate is Review alone and not red (positive control beside the red deactivate). */
export async function reactivateIsAPlainReviewThatPosts(): Promise<void> {
  stubApi([{ ...ROW, active: false }]);
  renderPage();
  await openRowAction("Reactivate");
  const dialog = await screen.findByRole("dialog", { name: "Reactivate Lotapata" });
  const card = within(dialog).getByRole("region", { name: "Reactivate a location" });
  expect(card.className).not.toContain("border-critical-line");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(api.reactivateAdminLocation).toHaveBeenCalledWith(ROW_ID));
}
