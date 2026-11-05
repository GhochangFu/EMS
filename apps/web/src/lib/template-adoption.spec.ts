import { expect } from "vitest";
import type {
  AssetTemplatesListResponse,
  TemplateAdoptionAssetPlanDto,
  TemplateAdoptionPreviewResponse,
  TemplateAdoptionRefusalDto,
} from "@bms/shared";
import { TEMPLATE_ADOPTION_MAX_ASSETS } from "@bms/shared/contracts";

import { ApiError } from "./api-error";
import {
  adoptActionState,
  adoptionBulkState,
  adoptionPlanSections,
  adoptionRefusalSentence,
  adoptionRefusedBody,
  adoptionVersionChoices,
  type AdoptingAsset,
} from "./template-adoption";

/**
 * `F4.312` PR 3 (ADR 0109 Amendment 1 A1, decisions 2, 3 and 5) —
 * `template-adoption.ts`'s rules, one exported function per claim;
 * `template-adoption.test.ts` is the Vitest entry point (ADR 0014). Each
 * names the mutation it catches.
 */

type Version = AssetTemplatesListResponse["items"][number];
type Asset = AdoptingAsset;

function version(overrides: Partial<Version>): Version {
  return {
    id: "v-1",
    organizationId: "org-eskom",
    organizationCode: "ESKOM",
    organizationName: "Eskom",
    code: "FEEDER",
    version: 1,
    name: "Feeder",
    assetType: "feeder",
    domain: "electrical",
    description: null,
    status: "published",
    content: {},
    publishedAt: "2026-11-01T00:00:00.000Z",
    pointCount: 3,
    ...overrides,
  } as Version;
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: "a-1",
    code: "FDR-01",
    organizationCode: "ESKOM",
    domain: "electrical",
    templateId: null,
    rtuDisplayName: null,
    locationName: null,
    ...overrides,
  };
}

function plan(overrides: Partial<TemplateAdoptionAssetPlanDto>): TemplateAdoptionAssetPlanDto {
  return {
    assetId: "a-1",
    assetCode: "FDR-01",
    assetRtuName: null,
    assetLocationName: null,
    assetName: "Feeder 1",
    kept: [],
    added: [],
    converted: [],
    skipped: [],
    inheritsDefaults: [],
    ...overrides,
  };
}

const REFUSAL: TemplateAdoptionRefusalDto = {
  reason: "standalone_calc_not_declared",
  assetId: "a-1",
  assetCode: "FDR-01",
  pointKey: "kvar",
  message: 'The standalone calculated point "kvar" is not declared by FEEDER v1.',
};

function preview(overrides: Partial<TemplateAdoptionPreviewResponse>): TemplateAdoptionPreviewResponse {
  return {
    templateId: "v-1",
    templateCode: "FEEDER",
    templateVersion: 1,
    assets: [plan({})],
    refusals: [],
    refusalCount: 0,
    canApply: true,
    ...overrides,
  };
}

const VERSIONS: Version[] = [
  version({ id: "ok" }),
  version({ id: "draft", status: "draft" }),
  version({ id: "archived", status: "archived" }),
  version({ id: "other-org", organizationId: "org-phe", organizationCode: "PHEWB" }),
  version({ id: "other-domain", domain: "hvac" }),
];

// Catches: a draft or archived version offered (A1: published only).
export function onlyAPublishedVersionIsOffered(): void {
  expect(adoptionVersionChoices([asset({})], [VERSIONS[0]!, VERSIONS[1]!, VERSIONS[2]!]).versions.map((v) => v.id)).toEqual([
    "ok",
  ]);
}

// Catches: a version of another organization offered (A1: the asset's own organization).
export function aVersionOfAnotherOrganizationIsNotOffered(): void {
  expect(adoptionVersionChoices([asset({})], [VERSIONS[0]!, VERSIONS[3]!]).versions.map((v) => v.id)).toEqual(["ok"]);
}

// Catches: a version of another domain offered (A1: the same domain).
export function aVersionOfAnotherDomainIsNotOffered(): void {
  expect(adoptionVersionChoices([asset({})], [VERSIONS[0]!, VERSIONS[4]!]).versions.map((v) => v.id)).toEqual(["ok"]);
}

// Catches: a batch spanning two organizations still offered the first asset's versions.
export function aBatchOfTwoOrganizationsOffersNothing(): void {
  expect(
    adoptionVersionChoices([asset({}), asset({ id: "a-2", organizationCode: "PHEWB" })], VERSIONS).versions,
  ).toEqual([]);
}

// Catches: the mixed-organization batch left without a reason.
export function aBatchOfTwoOrganizationsSaysWhy(): void {
  expect(
    adoptionVersionChoices([asset({}), asset({ id: "a-2", organizationCode: "PHEWB" })], VERSIONS).reason,
  ).toBe("The selected assets belong to 2 organizations (ESKOM, PHEWB); a batch adopts one organization's version.");
}

// Catches: a batch spanning two domains still offered the first asset's versions.
export function aBatchOfTwoDomainsOffersNothing(): void {
  expect(adoptionVersionChoices([asset({}), asset({ id: "a-2", domain: "hvac" })], VERSIONS).versions).toEqual([]);
}

// Catches: the mixed-domain batch left without a reason.
export function aBatchOfTwoDomainsSaysWhy(): void {
  expect(adoptionVersionChoices([asset({}), asset({ id: "a-2", domain: "hvac" })], VERSIONS).reason).toBe(
    "The selected assets span 2 domains (electrical, hvac); a batch adopts one domain's version.",
  );
}

// Catches: an empty list with no sentence when nothing matches.
export function noMatchingVersionSaysWhy(): void {
  expect(adoptionVersionChoices([asset({})], [VERSIONS[1]!]).reason).toBe(
    "ESKOM has no published template version for the electrical domain.",
  );
}

// Catches: a reason shown beside a list that has versions in it.
export function aMatchingVersionHasNoReason(): void {
  expect(adoptionVersionChoices([asset({})], VERSIONS).reason).toBeNull();
}

// Catches: a pinned asset counted as adoptable in the bulk action.
export function aPinnedAssetDisablesTheBulkAction(): void {
  expect(adoptionBulkState([asset({}), asset({ id: "a-2", code: "FDR-02", templateId: "v-9" })]).enabled).toBe(false);
}

// Catches: the bulk refusal not naming the pinned asset.
export function theBulkRefusalNamesThePinnedAsset(): void {
  expect(adoptionBulkState([asset({}), asset({ id: "a-2", code: "FDR-02", templateId: "v-9" })]).reason).toBe(
    "FDR-02 already has a template; only template-less assets can adopt one.",
  );
}

// Catches: the cap not applied to the bulk action.
export function aBatchAboveTheCapDisablesTheBulkAction(): void {
  const many = Array.from({ length: TEMPLATE_ADOPTION_MAX_ASSETS + 1 }, (_, i) => asset({ id: `a-${i}` }));
  expect(adoptionBulkState(many).reason).toBe(
    `A template can be adopted by at most ${TEMPLATE_ADOPTION_MAX_ASSETS} assets at once; ` +
      `${TEMPLATE_ADOPTION_MAX_ASSETS + 1} are selected.`,
  );
}

// Catches: an empty selection enabling the bulk action.
export function anEmptySelectionDisablesTheBulkAction(): void {
  expect(adoptionBulkState([]).enabled).toBe(false);
}

// Catches: an all-template-less selection refused.
export function aTemplateLessSelectionEnablesTheBulkAction(): void {
  expect(adoptionBulkState([asset({}), asset({ id: "a-2" })])).toEqual({ enabled: true, reason: null });
}

// Catches: a group dropped, mislabelled or reordered in the per-asset plan.
export function thePlanIsGroupedKeptAddedConvertedSkipped(): void {
  expect(
    adoptionPlanSections(
      plan({
        kept: ["kw"],
        added: [{ pointKey: "pf", sourceDataKey: "FDR-01.pf", unit: null }],
        converted: ["kvar"],
        skipped: ["thd"],
      }),
    ).groups,
  ).toEqual([
    { kind: "kept", label: "Kept", keys: ["kw"] },
    { kind: "added", label: "Added (unmapped)", keys: ["pf"] },
    { kind: "converted", label: "Converted (standalone calc → template override)", keys: ["kvar"] },
    { kind: "skipped", label: "Skipped", keys: ["thd"] },
  ]);
}

// Catches: an empty group rendered as a heading with nothing under it.
export function anEmptyGroupIsLeftOut(): void {
  expect(adoptionPlanSections(plan({ kept: ["kw"] })).groups.map((group) => group.kind)).toEqual(["kept"]);
}

// Catches: inherited defaults hidden, or shown without the fields.
export function inheritedDefaultsAreAPlainNotice(): void {
  expect(adoptionPlanSections(plan({ inheritsDefaults: [{ pointKey: "kw", fields: ["minValue", "maxValue"] }] })).notices).toEqual([
    "kw reads minValue, maxValue from the template version until the asset sets them.",
  ]);
}

// Catches: a refusal sentence that drops the asset code.
export function theRefusalSentenceNamesTheAssetCode(): void {
  expect(adoptionRefusalSentence(REFUSAL).startsWith("FDR-01")).toBe(true);
}

// Catches: a refusal sentence that drops the point key.
export function theRefusalSentenceNamesThePointKey(): void {
  expect(adoptionRefusalSentence(REFUSAL)).toBe(
    'FDR-01 · kvar: The standalone calculated point "kvar" is not declared by FEEDER v1.',
  );
}

// Catches: a whole-asset refusal rendered with an empty key slot.
export function aWholeAssetRefusalHasNoKeySlot(): void {
  expect(adoptionRefusalSentence({ ...REFUSAL, pointKey: null, message: "Already pinned." })).toBe(
    "FDR-01: Already pinned.",
  );
}

// Catches: Confirm enabled before a preview has run.
export function confirmIsDisabledWithNoPreview(): void {
  expect(adoptActionState(null).enabled).toBe(false);
}

// Catches: Confirm enabled while the server says it cannot apply.
export function confirmIsDisabledWhenTheServerRefuses(): void {
  expect(adoptActionState(preview({ canApply: false, refusals: [REFUSAL], refusalCount: 1 })).enabled).toBe(false);
}

// Catches: the verdict recomputed from `refusals` (an empty capped list with `canApply` false).
export function confirmFollowsCanApplyNotTheRefusalList(): void {
  expect(adoptActionState(preview({ canApply: false, refusals: [], refusalCount: 60 })).enabled).toBe(false);
}

// Catches: Confirm disabled on a clean preview.
export function confirmIsEnabledWhenTheServerCanApply(): void {
  expect(adoptActionState(preview({})).enabled).toBe(true);
}

const REFUSED_409 = new ApiError(
  JSON.stringify({ message: "This adoption is refused. Nothing was written.", refusals: [REFUSAL], refusalCount: 1 }),
  409,
);

// Catches: the 409 body's refusals lost.
export function the409BodyYieldsItsRefusals(): void {
  expect(adoptionRefusedBody(REFUSED_409)?.refusals).toEqual([REFUSAL]);
}

// Catches: a 409 with another body (for example the stale-plan sentence) read as a refusal list.
export function a409WithAPlainMessageIsNotARefusalBody(): void {
  expect(adoptionRefusedBody(new ApiError(JSON.stringify({ statusCode: 409, message: "Adoption matched 1 of 2." }), 409))).toBeNull();
}

// Catches: a non-409 error with the same shape read as an adoption refusal.
export function aNon409IsNotARefusalBody(): void {
  expect(adoptionRefusedBody(new ApiError(REFUSED_409.message, 400))).toBeNull();
}

// Catches: a non-JSON message throwing instead of answering null.
export function aNonJsonErrorIsNotARefusalBody(): void {
  expect(adoptionRefusedBody(new Error("network down"))).toBeNull();
}
