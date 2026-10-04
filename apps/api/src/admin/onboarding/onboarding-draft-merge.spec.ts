/**
 * `F3.22` (ADR 0091 decisions 2 and 11) — `templates[]` survives every write
 * that does not name it.
 *
 * `mergeDraftPatch` is the one statement of how a patch lands, and it had no
 * covering test before this file. W1–W3 hold the new line; W12 and W13 hold the
 * two producers that never write `templates` (the workbook upload and the guided
 * turn) through the real producer and the real merge. W12 and W13 live here and
 * not beside their producers because `onboarding-excel.service.spec.ts` (981)
 * and `onboarding-chat.service.spec.ts` (997) sit at AGENTS.md §4.5's line cap.
 */
import type { OnboardingDraft } from "@bms/shared";

import { draftBeforeAssets, ruleBasedTurn } from "./onboarding-chat.service.spec";
import { OnboardingChatService } from "./onboarding-chat.service";
import { mergeDraftPatch } from "./onboarding-draft-merge";
import { OnboardingExcelService, type ParsedExcel } from "./onboarding-excel.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const AUTHORED: NonNullable<OnboardingDraft["templates"]>[number] = {
  code: "PUMP",
  name: "Pump",
  domain: "water",
  points: [{ pointKey: "flow", sourceDataKeyPattern: "{site}_{asset_code}_FLOW" }],
};

const STOCK: NonNullable<OnboardingDraft["templates"]>[number] = { stockCode: "WTP", patterns: { ph: "{asset_code}_PH" } };

const TEMPLATED_ASSET: NonNullable<OnboardingDraft["assets"]>[number] = {
  code: "PUMP-1",
  name: "Pump 1",
  siteName: "Site",
  rtuIndex: 0,
  domain: "water",
  template: { code: "PUMP", sourceDataKeyVars: { site: "S1" } },
};

const base = (): OnboardingDraft => ({ templates: [AUTHORED], assets: [TEMPLATED_ASSET] });

/** W1 — a patch that does not carry `templates` keeps the base's. */
export function assertW1APatchWithoutTemplatesKeepsTheBase(): void {
  const merged = mergeDraftPatch(base(), { rtus: [] });
  assert(
    JSON.stringify(merged.templates) === JSON.stringify([AUTHORED]),
    `the base's templates survive, got ${JSON.stringify(merged.templates)}`,
  );
}

/** W2 — a patch that carries `templates` replaces the array wholesale. */
export function assertW2APatchWithTemplatesReplacesThem(): void {
  const merged = mergeDraftPatch(base(), { templates: [STOCK] });
  assert(
    JSON.stringify(merged.templates) === JSON.stringify([STOCK]),
    `the patch's templates replace the base's, got ${JSON.stringify(merged.templates)}`,
  );
}

/**
 * W3 — `{ templates: undefined }` keeps the base's. This is the gate for the
 * `templates: patch.templates ?? base.templates` line: without it the
 * `...patch` spread writes the explicit `undefined` over the base, while W1 and
 * W2 stay green through the spread alone.
 */
export function assertW3AnExplicitUndefinedKeepsTheBase(): void {
  const merged = mergeDraftPatch(base(), { templates: undefined });
  assert(
    JSON.stringify(merged.templates) === JSON.stringify([AUTHORED]),
    `an explicit undefined keeps the base's templates, got ${JSON.stringify(merged.templates)}`,
  );
}

/** One plain asset, as a workbook row parses to. */
const UPLOADED_ASSET: NonNullable<OnboardingDraft["assets"]>[number] = {
  code: "SITE-ASSET-1",
  name: "Primary Device",
  siteName: "Site",
  rtuIndex: 0,
  domain: "electrical",
};

/**
 * W12 (decision 11) — an upload replaces `assets[]` and keeps `templates[]`.
 * The templated asset goes with the replaced array; the kept template is still
 * published at commit with no asset built from it. That is the stated
 * behaviour, not a defect: the PR body says so.
 */
export function assertW12AnUploadKeepsTemplatesAndReplacesAssets(): void {
  const stored: OnboardingDraft = { ...draftBeforeAssets("Site"), templates: [AUTHORED], assets: [TEMPLATED_ASSET] };
  const parsed: ParsedExcel = {
    location: stored.location!,
    rtus: [],
    assets: [UPLOADED_ASSET],
    rtuCredentials: [],
    displayNameFixes: [],
  };
  const patch = new OnboardingExcelService().toDraftPatch(parsed, stored);
  const merged = mergeDraftPatch(stored, patch);
  assert(
    JSON.stringify(merged.templates) === JSON.stringify([AUTHORED]),
    `the upload keeps the draft's templates, got ${JSON.stringify(merged.templates)}`,
  );
  assert(
    merged.assets?.length === 1 && merged.assets[0].code === UPLOADED_ASSET.code,
    `the upload's assets replace the draft's, got ${JSON.stringify(merged.assets)}`,
  );
  assert(
    (merged.assets ?? []).every((asset) => asset.template === undefined),
    `no templated asset survives the replace, got ${JSON.stringify(merged.assets)}`,
  );
}

/**
 * W13 — a guided turn that writes a section (the `mappings` branch writes
 * `assetPoints`) stores a draft whose `templates` and `assets[].template` are
 * byte-equal to the stored ones, through the real `handleTurn` and the real
 * `mergeDraft`.
 */
export async function assertW13AGuidedTurnLeavesTemplatesIntact(): Promise<void> {
  const stored: OnboardingDraft = {
    ...draftBeforeAssets("Site"),
    templates: [AUTHORED, STOCK],
    assets: [UPLOADED_ASSET, TEMPLATED_ASSET],
  };
  const turn = await ruleBasedTurn("map it", stored, "mappings");
  assert(turn.draftPatch.assetPoints !== undefined, "the mappings branch ran and wrote assetPoints");
  const service = new OnboardingChatService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const merged = service.mergeDraft(stored, turn.draftPatch) as OnboardingDraft;
  assert(
    JSON.stringify(merged.templates) === JSON.stringify(stored.templates),
    `the turn keeps templates byte-equal, got ${JSON.stringify(merged.templates)}`,
  );
  assert(
    JSON.stringify(merged.assets?.map((asset) => asset.template)) ===
      JSON.stringify([undefined, TEMPLATED_ASSET.template]),
    `the turn keeps assets[].template byte-equal, got ${JSON.stringify(merged.assets)}`,
  );
}
