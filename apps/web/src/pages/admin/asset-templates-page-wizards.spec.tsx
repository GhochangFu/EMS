import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/asset-templates";
import {
  admin,
  GROUPED_VOCABULARIES,
  IMPORT_BUTTON,
  ORG_UUID,
  renderPage,
  STOCK,
  STOCK_TAB,
  stubApi,
} from "./asset-templates-page.spec";

/**
 * `F4.254` PR 2 / ADR 0099 decision 6 (plan §4.4, §4.5) — the list page's New
 * template and a stock row's Import are steppers on the shared `WizardShell`
 * (`assetTemplate.create`, `assetTemplate.importStock`): the entry's steps,
 * then Review, and only Review's Submit sends. Used alone, neither sends
 * `X-Copilot-Change`. In their own file: `asset-templates-page.spec.tsx` is at
 * the AGENTS.md §4.5 cap. Vitest entry point: the sibling `.test.tsx`.
 */

type Seen = { url: string; init: RequestInit };

/** Every request the page puts on the wire through the real `adminFetch`; each answers `answer`. */
function stubWire(answer: unknown): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return seen;
}

const CREATED = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: ORG_UUID,
  organizationCode: "IX",
  organizationName: "Ion Exchange",
  code: "CHILLER",
  version: 1,
  name: "Chiller",
  assetType: "chiller",
  domain: "electrical",
  description: null,
  status: "draft",
  content: {},
  publishedAt: null,
  archivedAt: null,
  stockCode: null,
  stockVersion: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  points: [],
};

/** New template, the six inputs filled (with stray spaces), Next: the Review is on screen. */
async function fillTheCreateWizard(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "New template" }));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Organization" }), ORG_UUID);
  await userEvent.type(screen.getByRole("textbox", { name: "Code" }), " CHILLER ");
  await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Chiller ");
  await userEvent.type(screen.getByRole("textbox", { name: "Asset type" }), " chiller");
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Domain" }), "electrical");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** The create Review names the entry's summary, and nothing is sent before Submit. */
export async function theCreateReviewShowsTheSummaryAndSendsNothing(): Promise<void> {
  stubApi(STOCK, GROUPED_VOCABULARIES);
  const create = vi.spyOn(api, "createAdminAssetTemplate").mockResolvedValue(CREATED as never);
  renderPage(admin);

  await fillTheCreateWizard();

  expect(
    await screen.findByText('Create the asset template "Chiller" (CHILLER) in Ion Exchange.'),
  ).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
}

/** Submit sends the trimmed form, a blank description as `null` — the modal's normalization. */
export async function theCreateSubmitSendsTheTrimmedForm(): Promise<void> {
  stubApi(STOCK, GROUPED_VOCABULARIES);
  const create = vi.spyOn(api, "createAdminAssetTemplate").mockResolvedValue(CREATED as never);
  renderPage(admin);

  await fillTheCreateWizard();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(create).toHaveBeenCalledTimes(1);
  });
  expect(create).toHaveBeenCalledWith({
    organizationId: ORG_UUID,
    code: "CHILLER",
    name: "Chiller",
    assetType: "chiller",
    domain: "electrical",
    description: null,
  });
}

/** A create that succeeds closes the wizard. */
export async function aCreatedTemplateClosesTheWizard(): Promise<void> {
  stubApi(STOCK, GROUPED_VOCABULARIES);
  const create = vi.spyOn(api, "createAdminAssetTemplate").mockResolvedValue(CREATED as never);
  renderPage(admin);

  await fillTheCreateWizard();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(create).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => {
    expect(screen.queryByRole("heading", { name: "New template" })).toBeNull();
  });
}

/** A refused create shows the service's sentence on the card, never the raw envelope. */
export async function aRefusedCreateShowsTheSentence(): Promise<void> {
  stubApi(STOCK, GROUPED_VOCABULARIES);
  const raw = '{"message":"Organization is outside your access scope","error":"Forbidden","statusCode":403}';
  vi.spyOn(api, "createAdminAssetTemplate").mockRejectedValue(new Error(raw));
  renderPage(admin);

  await fillTheCreateWizard();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));

  expect(await screen.findByText("Organization is outside your access scope")).toBeInTheDocument();
  expect(screen.queryByText(raw)).toBeNull();
}

/**
 * The create wizard alone sends **no** `X-Copilot-Change` header. The API
 * function is left unspied and `fetch` stubbed, because the header is only
 * observable on the request. The positive first: the `POST` fired.
 */
export async function theCreateWizardSendsNoCopilotHeader(): Promise<void> {
  stubApi(STOCK, GROUPED_VOCABULARIES);
  const seen = stubWire(CREATED);
  try {
    renderPage(admin);

    await fillTheCreateWizard();
    await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
    await waitFor(() => {
      expect(seen.filter((call) => call.init.method === "POST")).toHaveLength(1);
    });

    const request = seen.find((call) => call.init.method === "POST");
    expect(request?.url).toMatch(/\/api\/v1\/admin\/asset-templates$/);
    const headers = new Headers(request?.init.headers);
    expect([...headers.keys()].filter((name) => name.toLowerCase() === "x-copilot-change")).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
}

/**
 * With no organization chosen, the import Review names the missing
 * `organizationId` and its Submit sends nothing (a step checks only the values
 * it holds; Review parses the whole body). The positive first: the problem shows.
 */
export async function importSubmitIsRefusedUntilAnOrganizationIsChosen(): Promise<void> {
  stubApi();
  const importer = vi.mocked(api.importAdminStockAssetTemplate);
  renderPage(admin, STOCK_TAB);

  await userEvent.click(await screen.findByRole("button", { name: IMPORT_BUTTON }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/organizationId/);
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(importer).not.toHaveBeenCalled();
}

/** The import Review names the entry's summary: the stock code and the chosen organization. */
export async function theImportReviewNamesTheCodeAndTheOrganization(): Promise<void> {
  stubApi();
  renderPage(admin, STOCK_TAB);

  await userEvent.click(await screen.findByRole("button", { name: IMPORT_BUTTON }));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Organization" }), ORG_UUID);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(
    screen.getByText('Import the stock asset template "electrical-feeder" into Ion Exchange.'),
  ).toBeInTheDocument();
}

/** The import wizard alone sends **no** `X-Copilot-Change` header (positive first: the `POST …/import`). */
export async function theImportWizardSendsNoCopilotHeader(): Promise<void> {
  stubApi();
  vi.mocked(api.importAdminStockAssetTemplate).mockRestore();
  const seen = stubWire({ ...CREATED, stockCode: "electrical-feeder", stockVersion: 1 });
  try {
    renderPage(admin, STOCK_TAB);

    await userEvent.click(await screen.findByRole("button", { name: IMPORT_BUTTON }));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Organization" }), ORG_UUID);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => {
      expect(seen.filter((call) => call.init.method === "POST")).toHaveLength(1);
    });

    const request = seen.find((call) => call.init.method === "POST");
    expect(request?.url).toMatch(/\/api\/v1\/admin\/asset-templates\/stock\/electrical-feeder\/import$/);
    const headers = new Headers(request?.init.headers);
    expect([...headers.keys()].filter((name) => name.toLowerCase() === "x-copilot-change")).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
}

const REFUSED = "Organization is outside your access scope";

/** Rejects the wire with a 409 once `release()` runs, so the dialog can be cancelled first. */
function holdThenRefuse(): { release: () => void } {
  let resolveGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
    if (init.method !== "POST") return new Response(JSON.stringify({ items: [] }), { status: 200 });
    await gate;
    return new Response(JSON.stringify({ message: REFUSED }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { release: () => resolveGate?.() };
}

/**
 * C1 — an import refused after its dialog was cancelled shows the sentence on
 * the page banner, once (the card is gone). Mutation: drop the wizard's
 * `onClosedError` call → red.
 */
export async function aRefusalAfterCancellingTheImportShowsOnThePage(): Promise<void> {
  stubApi();
  vi.mocked(api.importAdminStockAssetTemplate).mockRestore();
  const gate = holdThenRefuse();
  renderPage(admin, STOCK_TAB);

  await userEvent.click(await screen.findByRole("button", { name: IMPORT_BUTTON }));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Organization" }), ORG_UUID);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  // The form is dirty (an organization was chosen), so the shell asks first.
  await userEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
  expect(screen.queryByRole("region", { name: "Import a stock asset template" })).toBeNull();

  gate.release();

  expect(await screen.findByText(REFUSED)).toBeInTheDocument();
  expect(screen.getAllByText(REFUSED)).toHaveLength(1);
}
