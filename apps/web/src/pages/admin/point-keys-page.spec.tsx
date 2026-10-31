import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminPointKeyDto } from "@bms/shared";

import * as api from "../../api/admin/point-keys";
import * as assetsApi from "../../api/assets";
import * as systemStatusApi from "../../api/system-status";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { resetWizardStore, useWizardStore } from "../../stores/wizard-store";
import { PointKeysAdminPage } from "./point-keys-page";
import * as copilotApi from "../../api/copilot";

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
 *
 * `F3.86` PR 3c (ADR 0099 decision 6, ruling Q9): Add and Edit are the
 * `pointKey.create` / `pointKey.update` wizards (Basics → Details → Review),
 * and Deactivate / Reactivate are Review-alone wizards. The rank field sits
 * on Details, so an edit walks Basics first.
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
  trendDefault: true,
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
  trendDefault: false,
};

/** An inactive key, for the reactivate wizard. */
const RETIRED: AdminPointKeyDto = {
  id: "aaaa0000-0000-4000-8000-000000000003",
  code: "f386_spec_retired",
  name: "Spec retired",
  domain: "electrical",
  unit: "V",
  description: null,
  active: false,
  createdAt: new Date(0).toISOString(),
  headlineRank: null,
  trendDefault: false,
};

function stubApi() {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  vi.spyOn(api, "fetchAdminPointKeys").mockResolvedValue({ items: [RANKED, UNRANKED, RETIRED] });
  return {
    update: vi.spyOn(api, "updateAdminPointKey").mockResolvedValue(RANKED),
    create: vi.spyOn(api, "createAdminPointKey").mockResolvedValue(RANKED),
    deactivate: vi.spyOn(api, "deactivateAdminPointKey").mockResolvedValue({ ...RANKED, active: false }),
    reactivate: vi.spyOn(api, "reactivateAdminPointKey").mockResolvedValue({ ...RETIRED, active: true }),
  };
}

function renderPage(as: AuthUser): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
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

/** Presses the wizard's Next. */
async function next(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** The wizard's step list, as rendered: "1. Basics", … */
function stepTitles(): string[] {
  return within(screen.getByRole("list", { name: "Steps" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

/** The step the wizard has open (`aria-current="step"`). */
function currentStep(): string {
  return screen.getByRole("list", { name: "Steps" }).querySelector('[aria-current="step"]')?.textContent ?? "";
}

/** Opens Edit on `code` and walks Basics → Details, where the rank field is. */
async function openEdit(code: string): Promise<HTMLInputElement> {
  const row = await rowFor(code);
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
  await screen.findByRole("textbox", { name: "Name" });
  await next();
  return (await screen.findByLabelText("Headline rank")) as HTMLInputElement;
}

/** From the Details step: Next to Review, then Submit. */
async function reviewAndSubmit(): Promise<void> {
  await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
}

/** Opens the create wizard on Basics. */
async function openCreate(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Add point key" }));
  await screen.findByRole("textbox", { name: "Code" });
}

/** The body the create walk below sends, and Review shows. */
const CREATED = { code: "f386_spec_new", name: "Spec new", domain: "electrical", unit: "kW", description: "A spec key", headlineRank: 4 };

/** Fills Basics and Details of the create wizard with {@link CREATED} and stops on Review. */
async function walkCreateToReview(): Promise<void> {
  await openCreate();
  fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: CREATED.code } });
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: CREATED.name } });
  fireEvent.change(screen.getByRole("textbox", { name: "Domain" }), { target: { value: CREATED.domain } });
  fireEvent.change(screen.getByRole("textbox", { name: "Unit" }), { target: { value: CREATED.unit } });
  await next();
  fireEvent.change(await screen.findByLabelText("Headline rank"), { target: { value: "4" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: CREATED.description } });
  await next();
  await screen.findByRole("button", { name: "Submit" });
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
  expect(field.value, "the wizard must open with the stored rank").toBe("3");
  fireEvent.change(field, { target: { value: "" } });
  await reviewAndSubmit();
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
  await reviewAndSubmit();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  const [id, body] = update.mock.calls[0]!;
  expect(id).toBe(UNRANKED.id);
  expect(body).toHaveProperty("headlineRank", 2);
}

/** W4 — `x` is refused on the page: the field says why, Next holds the Details step, and no API call is made. */
export async function aNonNumberIsRefusedWithoutACall(): Promise<void> {
  const { update } = stubApi();
  // A request that never settles: were the page to send one, only the no-call assertion could fail.
  update.mockImplementation(() => new Promise(() => undefined));
  renderPage(admin);
  const field = await openEdit(UNRANKED.code);
  await userEvent.type(field, "x");
  expect(await screen.findByText(/must be a whole number/)).toBeInTheDocument();
  await next();
  await screen.findByRole("alert");
  expect(currentStep()).toBe("2. Details");
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

/**
 * `F4.204` — an `ApiError` carries the whole response body, so a refusal read
 * through `err.message` showed `{"statusCode":409,…}`. Each site reads it through
 * `apiErrorMessage`; one case per site, because a site left on `err.message`
 * reddens only its own case. The sentence is found by text (the banner has no
 * role), and the element holding it must not also hold the envelope.
 */

/** F4.204 — a refused save shows the sentence, not the envelope. */
export async function aRefusedSaveShowsTheSentence(): Promise<void> {
  const { update } = stubApi();
  update.mockRejectedValue(
    new ApiError(
      '{"statusCode":409,"message":"That headline rank is already taken","error":"Conflict"}',
      409,
    ),
  );
  renderPage(admin);
  await openEdit(UNRANKED.code);
  await reviewAndSubmit();
  const banner = await screen.findByText(/That headline rank is already taken/);
  expect(banner.textContent).not.toContain('{"');
}

/** `F3.86` PR 3c — the create wizard's steps are the catalog entry's, in its order, then Review. */
export async function createStepsAreBasicsDetailsReview(): Promise<void> {
  stubApi();
  renderPage(admin);
  await openCreate();
  expect(stepTitles()).toEqual(["1. Basics", "2. Details", "3. Review"]);
}

/** `F3.86` PR 3c — Submit sends exactly the body Review showed, once. */
export async function theCreateWizardSendsTheReviewedBody(): Promise<void> {
  const { create } = stubApi();
  renderPage(admin);
  await walkCreateToReview();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(create.mock.calls).toEqual([[CREATED]]));
}

/** An empty code holds the Basics step: the wizard is not a `<form>`, so `required` cannot. */
export async function anEmptyCodeHoldsTheBasicsStep(): Promise<void> {
  const { create } = stubApi();
  renderPage(admin);
  await openCreate();
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "No code" } });
  await next();
  await screen.findByRole("alert");
  expect(currentStep()).toBe("1. Basics");
  expect(create).not.toHaveBeenCalled();
}

/**
 * The header rule (plan §10.5 of release 1): the wizard used alone sends the
 * plain request — no `X-Copilot-Change`. Read on the wire: `fetch` is stubbed
 * and the REAL `createAdminPointKey` runs. The positive sits beside the
 * absence: the POST went out, to the route.
 */
export async function theCreateWizardSendsNoCopilotHeader(): Promise<void> {
  stubApi();
  vi.mocked(api.createAdminPointKey).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ...RANKED, ...CREATED, id: RETIRED.id }), { status: 201 });
  });
  renderPage(admin);
  await walkCreateToReview();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init.method === "POST")).toBe(true));
  const post = calls.find((call) => call.init.method === "POST") as { url: string; init: RequestInit };
  expect(post.url).toBe(`${base}/api/v1/admin/point-keys`);
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
}

/** A copilot `fill_step` fills the open step's fields only; a field of another step is ignored. */
export async function aFillFillsTheNamedStepOnly(): Promise<void> {
  resetWizardStore();
  stubApi();
  renderPage(admin);
  await openCreate();
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "pointKey.create", params: {},
      stepId: "basics",
      values: { code: "f386_filled", name: "Filled", description: "not a Basics field" },
    }, null);
  });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("f386_filled"));
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Filled");
  await next();
  expect(await screen.findByRole("textbox", { name: "Description" })).toHaveValue("");
}

/** An edit's Review shows the stored value beside the new one. */
export async function theEditReviewShowsNowBesideAfter(): Promise<void> {
  stubApi();
  renderPage(admin);
  await userEvent.click(within(await rowFor(RANKED.code)).getByRole("button", { name: "Edit" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), { target: { value: "Spec renamed" } });
  await next();
  await next();
  const card = await screen.findByRole("region", { name: "Edit a point key" });
  const row = within(card).getByRole("row", { name: /^Name/ });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Spec ranked", "Spec renamed"]);
}

/** Ruling Q9 — Deactivate is a Review-alone wizard, red, and Submit fires the plain deactivate for that key. */
export async function deactivateIsARedReviewThatPostsDeactivate(): Promise<void> {
  const { deactivate } = stubApi();
  renderPage(admin);
  await userEvent.click(within(await rowFor(RANKED.code)).getByRole("button", { name: "Deactivate" }));
  expect(stepTitles()).toEqual(["1. Review"]);
  expect(screen.getByRole("region", { name: "Deactivate a point key" })).toHaveAttribute("data-risk", "deactivate");
  expect(deactivate, "the click deactivated before the Review was answered").not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(deactivate.mock.calls).toEqual([[RANKED.id]]));
}

/** Reactivate is a Review-alone wizard too, not red, and fires the plain reactivate. */
export async function reactivateIsAReviewThatPostsReactivate(): Promise<void> {
  const { reactivate, deactivate } = stubApi();
  renderPage(admin);
  await userEvent.click(within(await rowFor(RETIRED.code)).getByRole("button", { name: "Reactivate" }));
  expect(screen.getByRole("region", { name: "Reactivate a point key" })).toHaveAttribute("data-risk", "edit");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(reactivate.mock.calls).toEqual([[RETIRED.id]]));
  expect(deactivate).not.toHaveBeenCalled();
}

/** The text of `row`'s cell under the "Trend default" header. */
function trendCell(row: HTMLElement): string {
  const headers = screen.getAllByRole("columnheader").map((th) => th.textContent?.trim());
  const index = headers.indexOf("Trend default");
  expect(index, "no Trend default column header").toBeGreaterThanOrEqual(0);
  return within(row).getAllByRole("cell")[index]?.textContent?.trim() ?? "";
}

/** F4.300 U6 — the column shows Yes for a trend default key and a dash for one that is not. */
export async function columnShowsTheTrendDefault(): Promise<void> {
  stubApi();
  renderPage(admin);
  expect(trendCell(await rowFor(RANKED.code))).toBe("Yes");
  expect(trendCell(await rowFor(UNRANKED.code))).toBe("—");
}

/** F4.300 U6 — the Details step has a Trend default checkbox, checked from the stored flag. */
export async function editFormHasATrendDefaultCheckbox(): Promise<void> {
  stubApi();
  renderPage(admin);
  await openEdit(RANKED.code);
  expect(await screen.findByRole("checkbox", { name: "Trend default" })).toBeChecked();
}

/** F4.300 U6 — checking the box on create sends trendDefault: true. */
export async function createWithTheBoxSendsTrue(): Promise<void> {
  const { create } = stubApi();
  renderPage(admin);
  await walkCreateToReview();
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(await screen.findByRole("checkbox", { name: "Trend default" }));
  await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(create.mock.calls).toEqual([[{ ...CREATED, trendDefault: true }]]));
}

/** F4.300 U6 — unchecking a stored true sends an explicit false (a decided value, not omission). */
export async function uncheckingSendsFalse(): Promise<void> {
  const { update } = stubApi();
  renderPage(admin);
  await openEdit(RANKED.code);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Trend default" }));
  await reviewAndSubmit();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]![1]).toHaveProperty("trendDefault", false);
}

/** F4.300 U6 — an edit that leaves the box alone sends no trendDefault, so an undecided flag stays undecided. */
export async function untouchedBoxSendsNothing(): Promise<void> {
  const { update } = stubApi();
  renderPage(admin);
  await openEdit(UNRANKED.code);
  await reviewAndSubmit();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]![1]).not.toHaveProperty("trendDefault");
}

/** F4.300 U6 — an organization_admin sees the column and no checkbox (the write form is closed to them). */
export async function organizationAdminSeesTheFlagButNoControl(): Promise<void> {
  stubApi();
  renderPage(orgAdmin);
  expect(trendCell(await rowFor(RANKED.code))).toBe("Yes");
  expect(screen.queryByRole("checkbox", { name: "Trend default" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
}
