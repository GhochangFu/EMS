import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { AdminAssetTemplateDto } from "@bms/shared";

import * as locationsApi from "../../api/admin/locations";
import * as rtusApi from "../../api/admin/rtus";
import { resetWizardStore, useWizardStore } from "../../stores/wizard-store";
import {
  admin,
  LOCATION_ID,
  ORG_ID,
  publishedTemplate,
  renderPage,
  stubApi,
  TEMPLATE_ID,
} from "./asset-template-detail-page.spec";

/**
 * `F4.254` PR 3 (plan §5.3, §5.4) — the detail page's Instantiate, now the
 * `assetTemplate.instantiate` wizard (`components/asset-templates/instantiate-wizard.tsx`),
 * rendered through the page with the detail spec's harness. Split out of
 * `asset-template-detail-page.spec.tsx` to keep that file under the AGENTS.md
 * §4.5 cap. Vitest entry point: the sibling `.test.tsx` (ADR 0014, ADR 0042).
 */

const INSTANTIATION_RESULT = {
  templateId: TEMPLATE_ID,
  templateCode: "electrical-feeder",
  templateVersion: 1,
  locationId: LOCATION_ID,
  rtuId: null,
  sourceKind: "unmapped",
  assets: [],
  assetCount: 2,
  pointCount: 8,
  ruleCount: 3,
  disabledRuleCount: 1,
  dashboardCount: 2,
};

const RTU_ID = "66666666-6666-4666-8666-666666666666";

/**
 * Drives the `F4.254` PR 3 instantiate wizard to its Review: Target (the
 * location, then the RTU when `rtu` is given) → Next → Assets (`TX-01`, and
 * `unit` when given) → Next.
 *
 * `HierarchyFilterBar` renders its selects unlabelled, and the Details tab
 * behind the dialog renders comboboxes of its own — taking "the first
 * combobox" found the domain picker instead. Each select is reached through
 * the option it holds.
 */
async function driveInstantiateToReview(options: { rtu?: boolean; unit?: string } = {}): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  const locationOption = await screen.findByRole("option", { name: "West Campus" });
  await userEvent.selectOptions(locationOption.closest("select")!, LOCATION_ID);
  if (options.rtu) {
    const rtuOption = await screen.findByRole("option", { name: "RTU 7" });
    await userEvent.selectOptions(rtuOption.closest("select")!, RTU_ID);
  }
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(await screen.findByLabelText("Asset 1 code"), "TX-01");
  if (options.unit !== undefined && options.unit !== "") {
    await userEvent.type(screen.getByLabelText("Asset 1 unit"), options.unit);
  }
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/**
 * ADR 0067 Q5 — the wizard stays open on success, prints the four counts, and
 * offers Close.
 *
 * The assertions after the sentence are the ones that make this more than a
 * wording check: **Submit is gone**, so the result state cannot be clicked
 * into a second batch of assets (the affordance that did not exist while the
 * dialog closed on success), and Close is present, so the dialog is escapable.
 */
export async function theInstantiateDialogStaysOpenAndShowsTheSummary(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateFromAdminAssetTemplate: () => Promise.resolve(INSTANTIATION_RESULT),
  });
  renderPage(admin);

  await driveInstantiateToReview();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  expect(
    await screen.findByText("Built 2 assets · 8 points · 3 rules · 2 dashboards"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
}

/** The Review shows the entry's own summary: the count, the template and the site by id. */
export async function theInstantiateReviewShowsTheEntrySummary(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage(admin);

  await driveInstantiateToReview();

  expect(
    screen.getByText(`Build 1 asset from the asset template "Feeder" at the location ${LOCATION_ID} in Ion Exchange.`),
  ).toBeInTheDocument();
}

/**
 * An RTU choice sets its location too, and the RTU wins: the body carries
 * `rtuId` (the positive first) and no `locationId`. Mutation: invert the
 * RTU-wins order (`resolveTarget`, which `targetOf` reads) → red.
 */
export async function anRtuChoiceSendsRtuIdAndNoLocationId(): Promise<void> {
  const instantiate = vi.fn((_id: string, _body: unknown) => Promise.resolve(INSTANTIATION_RESULT));
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateFromAdminAssetTemplate: instantiate,
  });
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({
    items: [{ id: RTU_ID, displayName: "RTU 7", locationId: LOCATION_ID, organizationId: ORG_ID }],
  } as never);
  renderPage(admin);

  await driveInstantiateToReview({ rtu: true });
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => expect(instantiate).toHaveBeenCalledTimes(1));
  const body = instantiate.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(instantiate.mock.calls[0]?.[0]).toBe(TEMPLATE_ID);
  expect(body).toMatchObject({ rtuId: RTU_ID, assets: [{ code: "TX-01", name: "TX-01" }] });
  expect(body).not.toHaveProperty("locationId");
}

/**
 * A copilot `fill_step` for the Assets step reaches the row editor: the
 * wizard's values are derived from its rows, so a fill must be mapped back
 * into them (`rowsOfAssets`). Mutation: `onChange={() => undefined}` → red.
 */
export async function aCopilotFillReachesTheAssetRows(): Promise<void> {
  resetWizardStore();
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  await screen.findByRole("option", { name: "West Campus" });
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "assetTemplate.instantiate",
      stepId: "assets",
      values: { assets: [{ code: "F-1", name: "Feeder 1" }] },
    });
  });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(await screen.findByLabelText("Asset 1 code")).toHaveValue("F-1");
}

const LOCATION_2_ID = "77777777-7777-4777-8777-777777777777";

/** Stubs the page with `instantiate` spied, one RTU under West Campus, and East Campus beside it. */
function stubWithAnRtuAndTwoLocations() {
  const instantiate = vi.fn((_id: string, _body: unknown) => Promise.resolve(INSTANTIATION_RESULT));
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateFromAdminAssetTemplate: instantiate,
  });
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [
      { id: LOCATION_ID, name: "West Campus", organizationId: ORG_ID, active: true },
      { id: LOCATION_2_ID, name: "East Campus", organizationId: ORG_ID, active: true },
    ],
  } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({
    items: [{ id: RTU_ID, displayName: "RTU 7", locationId: LOCATION_ID, organizationId: ORG_ID }],
  } as never);
  return instantiate;
}

/** Opens Instantiate and picks West Campus, then RTU 7, on the Target step; returns the location select. */
async function chooseTheRtu(): Promise<HTMLSelectElement> {
  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  const locationSelect = (await screen.findByRole("option", { name: "West Campus" })).closest("select")!;
  await userEvent.selectOptions(locationSelect, LOCATION_ID);
  const rtuOption = await screen.findByRole("option", { name: "RTU 7" });
  await userEvent.selectOptions(rtuOption.closest("select")!, RTU_ID);
  return locationSelect;
}

/** Steps Target → Assets → Review and submits. */
async function nextNextSubmit(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

/**
 * Review C1 — a copilot fill of the Assets step after an RTU choice keeps the
 * picker's location (the values hold only `rtuId`, so rebuilding the
 * selection from them dropped it) and still sends the RTU. Mutation: rebuild
 * the selection from the values' ids → red.
 */
export async function anAssetsFillAfterAnRtuChoiceKeepsTheLocation(): Promise<void> {
  resetWizardStore();
  const instantiate = stubWithAnRtuAndTwoLocations();
  renderPage(admin);

  const locationSelect = await chooseTheRtu();
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "assetTemplate.instantiate",
      stepId: "assets",
      values: { assets: [{ code: "F-1", name: "Feeder 1" }] },
    });
  });

  expect(locationSelect).toHaveValue(LOCATION_ID);
  await nextNextSubmit();
  await waitFor(() => expect(instantiate).toHaveBeenCalledTimes(1));
  const body = instantiate.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(body).toMatchObject({ rtuId: RTU_ID, assets: [{ code: "F-1", name: "Feeder 1" }] });
  expect(body).not.toHaveProperty("locationId");
}

/**
 * Review C1 — a copilot fill of the Target step with a new `locationId` after
 * an RTU choice moves to that location and clears the RTU: the body sends the
 * location (the positive first) and no `rtuId`. Mutation: rebuild the
 * selection from the values' ids (the RTU then wins) → red.
 */
export async function aTargetFillOfALocationAfterAnRtuChoiceSendsTheLocation(): Promise<void> {
  resetWizardStore();
  const instantiate = stubWithAnRtuAndTwoLocations();
  renderPage(admin);

  await chooseTheRtu();
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "assetTemplate.instantiate",
      stepId: "target",
      values: { locationId: LOCATION_2_ID },
    });
  });
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "assetTemplate.instantiate",
      stepId: "assets",
      values: { assets: [{ code: "F-1" }] },
    });
  });

  await nextNextSubmit();
  await waitFor(() => expect(instantiate).toHaveBeenCalledTimes(1));
  const body = instantiate.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(body).toMatchObject({ locationId: LOCATION_2_ID, assets: [{ code: "F-1" }] });
  expect(body).not.toHaveProperty("rtuId");
}

/**
 * Review C2 — a copilot fill's `siteName` reaches the body: the row keeps it
 * (`rowsOfAssets`) and `namedRows` sends it. Mutation: drop `siteName` from
 * `rowsOfAssets` → red.
 */
export async function aFilledSiteNameReachesTheBody(): Promise<void> {
  resetWizardStore();
  const instantiate = vi.fn((_id: string, _body: unknown) => Promise.resolve(INSTANTIATION_RESULT));
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateFromAdminAssetTemplate: instantiate,
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  const locationOption = await screen.findByRole("option", { name: "West Campus" });
  await userEvent.selectOptions(locationOption.closest("select")!, LOCATION_ID);
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "assetTemplate.instantiate",
      stepId: "assets",
      values: { assets: [{ code: "F-1", name: "Feeder 1", siteName: "Plant A" }] },
    });
  });

  await nextNextSubmit();
  await waitFor(() => expect(instantiate).toHaveBeenCalledTimes(1));
  expect(instantiate.mock.calls[0]?.[1]).toMatchObject({
    locationId: LOCATION_ID,
    assets: [{ code: "F-1", siteName: "Plant A" }],
  });
}

/** A template whose measured point's pattern carries the `{unit}` variable. */
function templateWithAVariable(): AdminAssetTemplateDto {
  return {
    ...publishedTemplate(),
    points: [
      {
        id: "p1",
        templateId: TEMPLATE_ID,
        pointKey: "kw",
        label: null,
        unit: null,
        kind: "measured",
        sourceDataKeyPattern: "{asset_code}_{unit}_KW",
        formula: null,
        formulaDialect: null,
        calcTrigger: null,
        calcIntervalSeconds: null,
        maxInputAgeSeconds: null,
        minCoverageRatio: null,
        required: true,
      },
    ],
  } as unknown as AdminAssetTemplateDto;
}

/**
 * A named row without its required variable is refused on Submit with the row
 * and the variable, and nothing is sent. The positive beside it: the same row
 * with the variable sends.
 */
export async function aMissingVariableRefusesSubmitWithTheRowAndName(): Promise<void> {
  const instantiate = vi.fn(() => Promise.resolve(INSTANTIATION_RESULT));
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(templateWithAVariable()),
    instantiateFromAdminAssetTemplate: instantiate,
  });
  renderPage(admin);

  await driveInstantiateToReview();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  expect(await screen.findByText("Asset 1 needs a value for unit.")).toBeInTheDocument();
  expect(instantiate).not.toHaveBeenCalled();
}

/** …and the same row with its variable filled sends it as `sourceDataKeyVars`. */
export async function aFilledVariableIsSent(): Promise<void> {
  const instantiate = vi.fn((_id: string, _body: unknown) => Promise.resolve(INSTANTIATION_RESULT));
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(templateWithAVariable()),
    instantiateFromAdminAssetTemplate: instantiate,
  });
  renderPage(admin);

  await driveInstantiateToReview({ unit: "01" });
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => expect(instantiate).toHaveBeenCalledTimes(1));
  expect(instantiate.mock.calls[0]?.[1]).toMatchObject({ assets: [{ code: "TX-01", sourceDataKeyVars: { unit: "01" } }] });
}

/**
 * The instantiate wizard alone sends **no** `X-Copilot-Change` header. The API
 * function is left unspied and `fetch` stubbed, because the header is only
 * observable on the request. The positive comes first: the `POST …/instantiate` fired.
 */
export async function theInstantiateWizardSendsNoCopilotHeader(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  const seen: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(INSTANTIATION_RESULT), { status: 201 });
  });
  try {
    renderPage(admin);

    await driveInstantiateToReview();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => {
      expect(seen.map((request) => request.url).filter((url) => url.endsWith("/instantiate"))).toHaveLength(1);
    });

    const request = seen.find((candidate) => candidate.url.endsWith("/instantiate"));
    expect(request?.url).toMatch(new RegExp(`/api/v1/admin/asset-templates/${TEMPLATE_ID}/instantiate$`));
    expect(request?.init.method).toBe("POST");
    const headers = new Headers(request?.init.headers);
    expect([...headers.keys()].filter((name) => name.toLowerCase() === "x-copilot-change")).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
}
