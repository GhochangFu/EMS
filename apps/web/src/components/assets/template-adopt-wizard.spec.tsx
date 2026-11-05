import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import type { TemplateAdoptionPreviewResponse, TemplateAdoptionRefusalDto } from "@bms/shared";

import * as templatesApi from "../../api/admin/asset-templates";
import { ApiError } from "../../lib/api-error";
import type { AdoptingAsset } from "../../lib/template-adoption";
import { TemplateAdoptWizard } from "./template-adopt-wizard";

/**
 * `F4.312` PR 3 (ADR 0109 Amendment 1, A1 and decisions 2, 3 and 5) — the
 * adopt wizard: the version picker outside the shell, the Assets step's
 * preview, Next gated on `canApply`, the adopt call and its 409. Each claim is
 * one exported function naming the mutation it catches;
 * `template-adopt-wizard.test.tsx` is the Vitest entry point.
 */

const V_OK = "f4312000-0000-4000-8000-0000000000c1";
const ASSET: AdoptingAsset = {
  id: "f4312000-0000-4000-8000-0000000000a1",
  code: "FDR-01",
  organizationCode: "ESKOM",
  domain: "electrical",
  templateId: null,
};

function version(id: string, code: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: "org-eskom",
    organizationCode: "ESKOM",
    organizationName: "Eskom",
    code,
    version: 1,
    name: `${code} name`,
    assetType: "feeder",
    domain: "electrical",
    description: null,
    status: "published",
    content: {},
    publishedAt: null,
    pointCount: 2,
    ...extra,
  };
}

const VERSIONS = [
  version(V_OK, "FEEDER"),
  version("f4312000-0000-4000-8000-0000000000c2", "DRAFTY", { status: "draft" }),
  version("f4312000-0000-4000-8000-0000000000c3", "PHEPUMP", { organizationCode: "PHEWB" }),
  version("f4312000-0000-4000-8000-0000000000c4", "AHU", { domain: "hvac" }),
];

const REFUSAL: TemplateAdoptionRefusalDto = {
  reason: "standalone_calc_not_declared",
  assetId: ASSET.id,
  assetCode: "FDR-01",
  pointKey: "kvar",
  message: 'The standalone calculated point "kvar" is not declared by FEEDER v1.',
};
const SENTENCE = 'FDR-01 · kvar: The standalone calculated point "kvar" is not declared by FEEDER v1.';

function preview(extra: Partial<TemplateAdoptionPreviewResponse> = {}): TemplateAdoptionPreviewResponse {
  return {
    templateId: V_OK,
    templateCode: "FEEDER",
    templateVersion: 1,
    assets: [
      {
        assetId: ASSET.id,
        assetCode: "FDR-01",
        assetName: "Feeder one",
        kept: ["kw"],
        added: [{ pointKey: "pf", sourceDataKey: "FDR-01.pf", unit: null }],
        converted: ["kva"],
        skipped: [],
        inheritsDefaults: [],
      },
    ],
    refusals: [],
    refusalCount: 0,
    canApply: true,
    ...extra,
  };
}

function stubApi(previewed: TemplateAdoptionPreviewResponse = preview()): void {
  vi.spyOn(templatesApi, "fetchAdminAssetTemplates").mockResolvedValue({ items: VERSIONS } as never);
  vi.spyOn(templatesApi, "previewAdminAssetTemplateAdoption").mockResolvedValue(previewed);
  vi.spyOn(templatesApi, "adoptAdminAssetTemplateAssets").mockResolvedValue({} as never);
}

function renderWizard(assets: readonly AdoptingAsset[] = [ASSET], onDone = vi.fn()): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TemplateAdoptWizard assets={assets} onCancel={vi.fn()} onDone={onDone} />
    </QueryClientProvider>,
  );
  return client;
}

async function picker(): Promise<HTMLSelectElement> {
  const select = (await screen.findByLabelText("Template version")) as HTMLSelectElement;
  await waitFor(() => expect(templatesApi.fetchAdminAssetTemplates).toHaveBeenCalled());
  return select;
}

async function pickFeeder(): Promise<void> {
  const select = await picker();
  await within(select).findByText("FEEDER v1 · FEEDER name");
  await userEvent.selectOptions(select, V_OK);
}

// Catches: the A1 filter dropped (a draft, another organization's or another domain's version offered).
export async function thePickerListsOnlyPublishedSameOrganizationSameDomainVersions(): Promise<void> {
  stubApi();
  renderWizard();
  const select = await picker();
  await within(select).findByText("FEEDER v1 · FEEDER name");
  expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Pick a published version",
    "FEEDER v1 · FEEDER name",
  ]);
}

// Catches: a mixed batch offered the first asset's versions instead of none and a reason.
export async function aMixedOrganizationBatchOffersNoVersion(): Promise<void> {
  stubApi();
  renderWizard([ASSET, { ...ASSET, id: "f4312000-0000-4000-8000-0000000000a2", code: "PMP-9", organizationCode: "PHEWB" }]);
  expect(
    await screen.findByText(
      "The selected assets belong to 2 organizations (ESKOM, PHEWB); a batch adopts one organization's version.",
    ),
  ).toBeTruthy();
}

// Catches: a mixed batch's picker still holding a version option.
export async function aMixedDomainBatchPickerHoldsNoVersion(): Promise<void> {
  stubApi();
  renderWizard([ASSET, { ...ASSET, id: "f4312000-0000-4000-8000-0000000000a2", code: "AHU-1", domain: "hvac" }]);
  const select = await picker();
  await screen.findByText(/span 2 domains/);
  expect(within(select).getAllByRole("option")).toHaveLength(1);
}

// Catches: the preview's kept / added / converted groups not shown on the Assets step.
export async function thePreviewListsKeptAddedAndConverted(): Promise<void> {
  stubApi();
  renderWizard();
  await pickFeeder();
  const plan = await screen.findByRole("region", { name: "Plan for FDR-01" });
  expect(
    [...plan.querySelectorAll("p")].map((line) => line.textContent).slice(1),
  ).toEqual(["Kept: kw", "Added (unmapped): pf", "Converted (standalone calc → template override): kva"]);
}

// Catches: the preview sent another selection or another version than the one picked.
export async function thePreviewIsOfThePickedVersionAndTheSelection(): Promise<void> {
  stubApi();
  renderWizard();
  await pickFeeder();
  await waitFor(() =>
    expect(templatesApi.previewAdminAssetTemplateAdoption).toHaveBeenCalledWith(V_OK, [ASSET.id]),
  );
}

// Catches: a refused preview that still lets the wizard reach Review's Submit.
export async function nextIsDisabledWhileARefusalExists(): Promise<void> {
  stubApi(preview({ canApply: false, refusals: [REFUSAL], refusalCount: 1 }));
  renderWizard();
  await pickFeeder();
  await screen.findByText(SENTENCE);
  expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
}

// Catches: a refusal shown without the asset code and the point key.
export async function theRefusalSentenceNamesTheAssetCodeAndTheKey(): Promise<void> {
  stubApi(preview({ canApply: false, refusals: [REFUSAL], refusalCount: 1 }));
  renderWizard();
  await pickFeeder();
  const list = await screen.findByRole("list", { name: "Refusals" });
  expect(list.textContent).toBe(SENTENCE);
}

// Catches: F4.315 B1 — "This adoption is refused … See below." printed under the list it points to.
export async function theRefusedSentenceSitsAboveItsList(): Promise<void> {
  stubApi(preview({ canApply: false, refusals: [REFUSAL], refusalCount: 1 }));
  renderWizard();
  await pickFeeder();
  const list = await screen.findByRole("list", { name: "Refusals" });
  const alert = screen.getByRole("alert");
  expect(alert.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

// Catches: inherited defaults hidden from the Assets step.
export async function inheritedDefaultsShowAsANotice(): Promise<void> {
  const base = preview();
  stubApi({ ...base, assets: [{ ...base.assets[0]!, inheritsDefaults: [{ pointKey: "kw", fields: ["minValue"] }] }] });
  renderWizard();
  await pickFeeder();
  expect(await screen.findByText("kw reads minValue from the template version until the asset sets them.")).toBeTruthy();
}

async function toReviewAndSubmit(): Promise<void> {
  await pickFeeder();
  await screen.findByRole("region", { name: "Plan for FDR-01" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
}

// Catches: a clean preview whose Submit does not post `{ assetIds }` to the picked version.
export async function aCleanPreviewSubmitsTheAssetIdsToThePickedVersion(): Promise<void> {
  stubApi();
  renderWizard();
  await toReviewAndSubmit();
  await waitFor(() => expect(templatesApi.adoptAdminAssetTemplateAssets).toHaveBeenCalledWith(V_OK, [ASSET.id]));
}

// Catches: a success that leaves the wizard open.
export async function aSuccessClosesTheWizard(): Promise<void> {
  stubApi();
  const onDone = vi.fn();
  renderWizard([ASSET], onDone);
  await toReviewAndSubmit();
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
}

// Catches: a success that re-reads the assets but not the rules (or any one of the five lists).
export async function aSuccessInvalidatesAssetsPointsCalcPointsDashboardsAndRules(): Promise<void> {
  stubApi();
  const client = renderWizard();
  const spy = vi.spyOn(client, "invalidateQueries");
  await toReviewAndSubmit();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
  expect(
    ['["admin","assets"]', '["admin","asset-points"]', '["admin","asset-calc-points"]', '["dashboards"]', '["rules"]'].every(
      (key) => keys.includes(key),
    ),
  ).toBe(true);
}

// Catches: a 409 from adopt whose refusals are not listed beside the card.
export async function a409ShowsItsRefusalsBesideTheCard(): Promise<void> {
  stubApi();
  vi.mocked(templatesApi.adoptAdminAssetTemplateAssets).mockRejectedValue(
    new ApiError(
      JSON.stringify({ message: "This adoption is refused. Nothing was written.", refusals: [REFUSAL], refusalCount: 1 }),
      409,
    ),
  );
  renderWizard();
  await toReviewAndSubmit();
  const list = await screen.findByRole("list", { name: "Refused assets" });
  expect(list.textContent).toBe(SENTENCE);
}

const REFUSED_PREVIEW = preview({ canApply: false, refusals: [REFUSAL], refusalCount: 1 });
const REFUSED_409 = new ApiError(
  JSON.stringify({ message: "This adoption is refused. Nothing was written.", refusals: [REFUSAL], refusalCount: 1 }),
  409,
);

/** A clean first preview, a refused one on every re-read, and a 409 from adopt. */
function stubCleanThenRefused(): void {
  stubApi();
  vi.mocked(templatesApi.previewAdminAssetTemplateAdoption)
    .mockReset()
    .mockResolvedValueOnce(preview())
    .mockResolvedValue(REFUSED_PREVIEW);
  vi.mocked(templatesApi.adoptAdminAssetTemplateAssets).mockRejectedValue(REFUSED_409);
}

// Catches: a 409 that leaves the stale clean preview behind Back (no re-read).
export async function after409BackListsTheServersRefusals(): Promise<void> {
  stubCleanThenRefused();
  renderWizard();
  await toReviewAndSubmit();
  await screen.findByRole("list", { name: "Refused assets" });
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect((await screen.findByRole("list", { name: "Refusals" })).textContent).toBe(SENTENCE);
}

// Catches: a 409 after which Back lets Next through to Submit again.
export async function after409BackDisablesNext(): Promise<void> {
  stubCleanThenRefused();
  renderWizard();
  await toReviewAndSubmit();
  await screen.findByRole("list", { name: "Refused assets" });
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("list", { name: "Refusals" });
  expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
}

/** Reaches Review on a clean preview, then the preview re-reads as refused. */
async function reviewThenPreviewRefuses(): Promise<void> {
  stubApi();
  const client = renderWizard();
  await pickFeeder();
  await screen.findByRole("region", { name: "Plan for FDR-01" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("button", { name: "Submit" });
  vi.mocked(templatesApi.previewAdminAssetTemplateAdoption).mockResolvedValue(REFUSED_PREVIEW);
  await client.invalidateQueries({ queryKey: ["admin", "asset-template-adoption-preview"] });
}

// Catches: a preview refused while Review is open, with Review saying nothing of it.
export async function aPreviewRefusedOnReviewSaysWhy(): Promise<void> {
  await reviewThenPreviewRefuses();
  expect(await screen.findByText("This adoption is refused. See the reason below.")).toBeTruthy();
}

// Catches: Submit sending an adopt the preview now refuses.
export async function aPreviewRefusedOnReviewSendsNothing(): Promise<void> {
  await reviewThenPreviewRefuses();
  await screen.findByText(SENTENCE);
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(templatesApi.adoptAdminAssetTemplateAssets).not.toHaveBeenCalled();
}

// Catches: the last refusal's banner left on screen while a new Submit is in flight.
export async function aNewSubmitClearsTheEarlierError(): Promise<void> {
  stubApi();
  vi.mocked(templatesApi.adoptAdminAssetTemplateAssets)
    .mockRejectedValueOnce(new ApiError(JSON.stringify({ statusCode: 503, message: "Try again." }), 503))
    .mockReturnValue(new Promise(() => undefined));
  renderWizard();
  await toReviewAndSubmit();
  await screen.findByText("Try again.");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(templatesApi.adoptAdminAssetTemplateAssets).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Try again.")).toBeNull();
}
