import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminRtuDto } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as rtusApi from "../../api/admin/rtus";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { useWizardStore } from "../../stores/wizard-store";
import type { AuthUser } from "../../stores/auth-store";
import { RtusAdminPage } from "./rtus-page";

/**
 * `F3.86` PR 3a (ADR 0099 decision 6, plan §5.2) — the RTUs page's wizards:
 * Add is `rtu.create`, Edit is `rtu.update`, and Deactivate and Reactivate are
 * Review-only wizards (ruling Q9). Each claim is one exported function;
 * `rtus-page.wizards.test.tsx` is the Vitest entry point. The device-ID rules
 * (`F4.182`) stay in `rtus-page.spec.tsx`.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "44444444-4444-4444-8444-444444444444";
const RTU_ID = "22222222-2222-4222-8222-222222222222";

const RTU: AdminRtuDto = {
  id: RTU_ID,
  locationId: SITE_A,
  locationName: "Site A",
  organizationCode: "SPEC",
  code: "GW-1",
  displayName: "Gateway one",
  sourceType: "mqtt",
  domain: null,
  externalRtuId: null,
  rtuCode: null,
  mqttTopic: "site-a/gw-1",
  stationCode: null,
  stationName: null,
  ingestEnabled: true,
  active: true,
  meta: null,
  createdAt: new Date(0).toISOString(),
};

function stubApi(rows: AdminRtuDto[] = [RTU]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [
      { id: SITE_A, name: "Site A" },
      { id: SITE_B, name: "Site B" },
    ],
  } as never);
  vi.spyOn(locationsApi, "fetchAdminLocationSummary").mockResolvedValue({} as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: rows } as never);
  vi.spyOn(rtusApi, "createAdminRtu").mockResolvedValue(RTU);
  vi.spyOn(rtusApi, "updateAdminRtu").mockResolvedValue(RTU);
  vi.spyOn(rtusApi, "deactivateAdminRtu").mockResolvedValue({ ...RTU, active: false });
  vi.spyOn(rtusApi, "reactivateAdminRtu").mockResolvedValue(RTU);
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/rtus"]}>
        <RtusAdminPage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openAdd(): Promise<HTMLElement> {
  await screen.findByText("GW-1");
  await userEvent.click(screen.getByRole("button", { name: "Add RTU" }));
  return screen.findByRole("dialog", { name: "Add RTU" });
}

async function openRowAction(action: "Edit" | "Deactivate" | "Reactivate"): Promise<void> {
  const row = (await screen.findByText("GW-1")).closest("tr")!;
  await userEvent.click(within(row).getByRole("button", { name: action }));
}

function stepTitles(): string[] {
  return within(screen.getByRole("list", { name: "Steps" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

async function next(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** The Basics a create needs, the Location select first. */
async function fillBasics(): Promise<void> {
  await within(screen.getByLabelText("Location")).findByText("Site B");
  await userEvent.selectOptions(screen.getByLabelText("Location"), SITE_B);
  await userEvent.type(screen.getByLabelText("Code"), "GW-9");
  await userEvent.type(screen.getByLabelText("Display name"), "Gateway nine");
  await userEvent.selectOptions(screen.getByLabelText("Source type"), "mqtt");
}

/** The create wizard's steps are the entry's, in its order, then Review. */
export async function theCreateStepsAreTheEntrys(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  const entry = catalogEntry("rtu.create")!;
  expect(stepTitles()).toEqual([...entry.steps.map((step) => step.title), "Review"].map((title, i) => `${i + 1}. ${title}`));
  expect(stepTitles()).toEqual(["1. Basics", "2. Source", "3. Metadata", "4. Review"]);
}

/** A select picked first in a fresh wizard keeps its pick (the `F3.85` PR 9 regression). */
export async function aSelectPickedFirstStays(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  const location = screen.getByLabelText("Location") as HTMLSelectElement;
  await within(location).findByText("Site B");
  await userEvent.selectOptions(location, SITE_B);
  expect(location.value).toBe(SITE_B);
}

/** The request body is the wizard's values, as a literal: a `createRtuValues` that drops a field reddens it. */
export async function theCreateBodyIsTheWizardsValues(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  await fillBasics();
  await next();
  await screen.findByRole("region", { name: "Source" });
  await userEvent.type(screen.getByLabelText("MQTT topic"), " site-b/gw-9 ");
  await userEvent.type(screen.getByLabelText("Station name"), "Pump house");
  await userEvent.click(screen.getByLabelText("Ingest enabled"));
  await next();
  await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect(rtusApi.createAdminRtu).toHaveBeenCalledWith({
      locationId: SITE_B,
      code: "GW-9",
      displayName: "Gateway nine",
      sourceType: "mqtt",
      mqttTopic: "site-b/gw-9",
      stationName: "Pump house",
      ingestEnabled: true,
    }),
  );
}

/** A wizard used alone sends the plain POST — no `X-Copilot-Change` — read on the wire. */
export async function theCreateSendsNoCopilotHeader(): Promise<void> {
  stubApi();
  vi.mocked(rtusApi.createAdminRtu).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(RTU), { status: 201 });
  });
  renderPage();
  await openAdd();
  await fillBasics();
  for (let step = 0; step < 3; step += 1) await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
  const post = calls.find((call) => call.init?.method === "POST") as { url: string; init: RequestInit };
  expect(post.url).toBe(`${base}/api/v1/admin/rtus`);
  expect(JSON.parse(post.init.body as string)).toMatchObject({ code: "GW-9", locationId: SITE_B });
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
  vi.unstubAllGlobals();
}

/** A copilot `fill_step` fills the named step's fields only. */
export async function aFillFillsItsStepOnly(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  await fillBasics();
  await next();
  await screen.findByRole("region", { name: "Source" });
  act(() => {
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "rtu.create", params: {}, stepId: "source", values: { stationCode: "ST-7", code: "HIJACK" } }, null);
  });
  await waitFor(() => expect((screen.getByLabelText("Station code") as HTMLInputElement).value).toBe("ST-7"));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(((await screen.findByLabelText("Code")) as HTMLInputElement).value).toBe("GW-9");
}

/** The edit's Review shows the stored value beside the new one. */
export async function theEditReviewShowsNowBesideAfter(): Promise<void> {
  stubApi();
  renderPage();
  await openRowAction("Edit");
  await screen.findByRole("dialog", { name: "Edit RTU" });
  const name = screen.getByLabelText("Display name");
  await userEvent.clear(name);
  await userEvent.type(name, "Gateway renamed");
  for (let step = 0; step < 3; step += 1) await next();
  const card = await screen.findByRole("region", { name: "Edit an RTU" });
  const row = within(card).getByRole("row", { name: /^display ?name/i });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Gateway one", "Gateway renamed"]);
}

/** The edit sends the plain PATCH for that RTU, without the header; an unchanged topic is not sent. */
export async function theEditSendsThePatchWithoutAHeader(): Promise<void> {
  stubApi();
  vi.mocked(rtusApi.updateAdminRtu).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(RTU), { status: 200 });
  });
  renderPage();
  await openRowAction("Edit");
  const name = await screen.findByLabelText("Display name");
  await userEvent.clear(name);
  await userEvent.type(name, "Gateway renamed");
  for (let step = 0; step < 3; step += 1) await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
  const patch = calls.find((call) => call.init?.method === "PATCH") as { url: string; init: RequestInit };
  expect(patch.url).toBe(`${base}/api/v1/admin/rtus/${RTU_ID}`);
  const body = JSON.parse(patch.init.body as string) as Record<string, unknown>;
  expect(body).toMatchObject({ displayName: "Gateway renamed" });
  expect("mqttTopic" in body).toBe(false);
  expect(new Headers(patch.init.headers).get("X-Copilot-Change")).toBeNull();
  vi.unstubAllGlobals();
}

/** Deactivate is Review alone, red, and Submit sends the plain `POST …/deactivate` for that RTU. */
export async function deactivateIsARedReviewThatPosts(): Promise<void> {
  stubApi();
  renderPage();
  await openRowAction("Deactivate");
  const dialog = await screen.findByRole("dialog", { name: "Deactivate Gateway one" });
  expect(stepTitles()).toEqual(["1. Review"]);
  const card = within(dialog).getByRole("region", { name: "Deactivate an RTU" });
  expect(card.className).toContain("border-critical-line");
  expect(rtusApi.deactivateAdminRtu).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(rtusApi.deactivateAdminRtu).toHaveBeenCalledWith(RTU_ID));
  expect(rtusApi.reactivateAdminRtu).not.toHaveBeenCalled();
}

/** Reactivate is Review alone and not red (positive control beside the red deactivate). */
export async function reactivateIsAPlainReviewThatPosts(): Promise<void> {
  stubApi([{ ...RTU, active: false }]);
  renderPage();
  await openRowAction("Reactivate");
  const dialog = await screen.findByRole("dialog", { name: "Reactivate Gateway one" });
  const card = within(dialog).getByRole("region", { name: "Reactivate an RTU" });
  expect(card.className).not.toContain("border-critical-line");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(rtusApi.reactivateAdminRtu).toHaveBeenCalledWith(RTU_ID));
}
