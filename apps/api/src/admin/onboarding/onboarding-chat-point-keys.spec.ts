import type { OnboardingDraft } from "@bms/shared";

import { chatService, ruleBasedTurn } from "./onboarding-chat.service.spec";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F4.195` — the guided chat and `excelImportFollowUp` ask `draftNeedsPointKeys`,
 * the question `inferPhase` asks, so neither adds or asks for a point key that
 * the phase skipped. Kept out of `onboarding-chat.service.spec.ts`, which is at
 * AGENTS.md §4.5's line ceiling.
 *
 * The draft is at review in every branch above the point-key one: an active
 * location type, one RTU with ingest off, and two templated assets. No
 * template context is needed, because the branch reads only the assets'
 * `template` field.
 */
function allTemplatedDraft(): OnboardingDraft {
  return {
    location: { name: "Lotapata", slug: "lotapata", code: "LOTAPATA", type: "smoc_campus", latitude: 20.1, longitude: 85.1 },
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU 1",
        protocol: "mqtt",
        config: { host: "broker", port: 8883, tls: true, topic: "plant/rtu-1" },
        credentialsSet: false,
        ingestEnabled: false,
      },
    ],
    assets: [
      { rtuIndex: 0, code: "SOFT-1", name: "Softener 1", siteName: "Lotapata", domain: "water", template: { code: "water-softener", version: 1 } },
      { rtuIndex: 0, code: "SOFT-2", name: "Softener 2", siteName: "Lotapata", domain: "water", template: { code: "water-softener", version: 1 } },
    ],
    pointKeys: [],
  };
}

const IN_REVIEW = "We're in review. Say **create it** to commit, or tell me what to change.";

/** F4.195 — a turn on an all-templated review draft with no point key adds no `kw` and answers from review. */
export async function assertAnAllTemplatedReviewDraftIsNotGivenAPointKey(): Promise<void> {
  const result = await ruleBasedTurn("hello", allTemplatedDraft(), "review");
  assert(result.assistantMessage === IN_REVIEW, `the review branch answers, got ${result.assistantMessage}`);
  assert(result.draftPatch.pointKeys === undefined, `no point key is added, got ${JSON.stringify(result.draftPatch.pointKeys)}`);
}

/** F4.195 — a `point_keys` phase stored before F4.192 does not give an all-templated draft `kw` either. */
export async function assertAStoredPointKeysPhaseDoesNotGiveAnAllTemplatedDraftAPointKey(): Promise<void> {
  const result = await ruleBasedTurn("hello", allTemplatedDraft(), "point_keys");
  assert(result.assistantMessage === IN_REVIEW, `the review branch answers, got ${result.assistantMessage}`);
  assert(result.draftPatch.pointKeys === undefined, `no point key is added, got ${JSON.stringify(result.draftPatch.pointKeys)}`);
}

/** F4.195 — a draft that uses the existing catalog is not given `kw` either; it goes on to its first asset. */
export async function assertADraftThatUsesTheExistingCatalogIsNotGivenAPointKey(): Promise<void> {
  const draft: OnboardingDraft = { ...allTemplatedDraft(), assets: [], onboardingMeta: { useExistingPointKeys: true } };
  const result = await ruleBasedTurn("hello", draft, "assets");
  assert(result.draftPatch.assets?.length === 1, `the assets branch answers, got ${result.assistantMessage}`);
  assert(result.draftPatch.pointKeys === undefined, `no point key is added, got ${JSON.stringify(result.draftPatch.pointKeys)}`);
}

/** F4.195, the positive control — a draft with a plain asset and no point key is still given `kw`. */
export async function assertADraftWithAPlainAssetIsStillGivenAPointKey(): Promise<void> {
  const draft = allTemplatedDraft();
  draft.assets!.push({ rtuIndex: 0, code: "PLAIN-1", name: "Plain 1", siteName: "Lotapata", domain: "electrical" });
  const result = await ruleBasedTurn("hello", draft, "review");
  assert(result.draftPatch.pointKeys?.[0]?.code === "kw", `kw is added, got ${JSON.stringify(result.draftPatch.pointKeys)}`);
}

const IMPORTED = { locationName: "Lotapata", rtuCount: 1, assetCount: 2 };

/**
 * F4.195 — after an import, an all-templated draft with no point key and no
 * mapping is asked for neither; the follow-up goes on to commit.
 */
export function assertTheImportFollowUpSendsAnAllTemplatedDraftToCommit(): void {
  const result = chatService().excelImportFollowUp(allTemplatedDraft(), IMPORTED, ["kw"]);
  assert(
    JSON.stringify(result.suggestedReplies) === JSON.stringify(["View draft", "Commit"]),
    `the commit step answers, got ${JSON.stringify(result.suggestedReplies)}`,
  );
}

/** F4.195, the positive control — a plain asset with no mapping is still asked to map. */
export function assertTheImportFollowUpStillAsksAPlainAssetToMap(): void {
  const draft: OnboardingDraft = { ...allTemplatedDraft(), pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }] };
  draft.assets!.push({ rtuIndex: 0, code: "PLAIN-1", name: "Plain 1", siteName: "Lotapata", domain: "electrical" });
  const result = chatService().excelImportFollowUp(draft, IMPORTED, ["kw"]);
  assert(result.suggestedReplies[0] === "auto map", `the mapping step answers, got ${JSON.stringify(result.suggestedReplies)}`);
}
