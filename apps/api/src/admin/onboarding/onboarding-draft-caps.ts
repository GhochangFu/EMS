/**
 * `F4.103` — the sentences that refuse an onboarding upload or draft holding
 * more items than one session may commit, and the domain list that stops the
 * pre-commit vocabulary check from scaling with the sheet.
 *
 * **Why one module rather than the sentences at their call sites.** The caps are
 * enforced at four points — `onboardingDraftSchema`'s `.max()` (both copies),
 * `OnboardingExcelService.parseUpload`, `OnboardingService.chat` and
 * `OnboardingCommitService.commit` — and the last three answer with a sentence a
 * human reads. (The fourth was added by this row's review: the rule-based chat
 * branch parses no schema and appends, so nothing else reached it. See
 * `draftCountProblem` below.) Written where they fire, the workbook refusal and
 * the draft refusal would sit in different files and could drift into different
 * accounts of the same limit. `spreadsheet-guard.ts` is the precedent: a guard
 * shared by two upload paths gets its own module.
 *
 * Pure and database-free, in the shape `onboarding-point-key-conflict.ts`
 * records the reason for: `apps/api/vitest.config.ts` includes `src/**\/*.test.ts`
 * only and every `*.integration.test.ts` here self-skips without `DATABASE_URL`,
 * so a rule proved only in the integration suite gates nothing on the machine
 * where the next edit to it will be made.
 *
 * **Nothing read from a workbook or a draft reaches these messages** (AGENTS.md
 * §4.3). Every interpolation is a section name from a two-member union, a label
 * from a list of four literals in this file, or a number — so, unlike every
 * other sheet-supplied string this family echoes, none of them needs
 * `quoteCell`. That is the same argument `columnBoundedRange` records for its
 * own interpolation in `telemetry-import-rows.ts`.
 *
 * The four numbers themselves, and where each comes from, are declared once in
 * `packages/shared/src/contracts/onboarding.ts` and are deliberately not
 * restated here.
 */
import {
  MAX_ONBOARDING_ASSET_POINTS,
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_POINT_KEYS,
  MAX_ONBOARDING_RTUS,
} from "@bms/shared";
import type { OnboardingDraft } from "@bms/shared";

/**
 * The two marker-delimited sections of an onboarding workbook that become draft
 * arrays. `LOCATION` is not one of them: it is a single row by construction, and
 * `parseLocation` reads `rows[1]` and nothing else.
 */
export type OnboardingWorkbookSection = "RTUS" | "ASSETS";

/** Each section's cap, so the caller cannot pass the wrong one to the wrong section. */
const SECTION_CAPS: Record<OnboardingWorkbookSection, number> = {
  RTUS: MAX_ONBOARDING_RTUS,
  ASSETS: MAX_ONBOARDING_ASSETS,
};

/**
 * The sentence that refuses a workbook section holding more data rows than the
 * cap, or `null` when the parser may walk it.
 *
 * `dataRows` is the section's row count **less its header row**, and it is exact
 * rather than an over-approximation: `parseRtus` and `parseAssets` are both
 * `rows.slice(1).map(...)` with no filtering, and `sectionRows` already stops at
 * the first blank row or the next marker. So this is precisely how many draft
 * entries the section will produce, and the count in the message is the number
 * the operator can go and count down the sheet.
 *
 * **Refused, not truncated**, like both siblings — `parseWorkbook` on
 * `MAX_IMPORT_ROWS` and `onboardingSheetRangeProblem` on the sheet range. A
 * silently shortened estate commits half a plant and says nothing, and the
 * operator finds out from the assets that are missing.
 */
export function workbookSectionCountProblem(
  section: OnboardingWorkbookSection,
  dataRows: number,
): string | null {
  const cap = SECTION_CAPS[section];
  if (dataRows <= cap) {
    return null;
  }
  return (
    `The ${section} section has ${dataRows} data rows, more than the ${cap} an onboarding ` +
    `workbook may carry; split the workbook into smaller ones and upload them one at a time`
  );
}

/** One draft array, its cap, and the words a human uses for it. */
type CappedDraftArray = {
  readonly field: "rtus" | "pointKeys" | "assets" | "assetPoints";
  readonly label: string;
  readonly cap: number;
};

/**
 * In `onboardingDraftSchema`'s own key order, which is what decides the sentence
 * a draft over more than one cap is given: Zod reports an object's issues in
 * key-declaration order, so the field named here is the field
 * `onboardingDraftSchema.safeParse` would have named for the same draft.
 */
const CAPPED_DRAFT_ARRAYS: readonly CappedDraftArray[] = [
  { field: "rtus", label: "RTUs", cap: MAX_ONBOARDING_RTUS },
  { field: "pointKeys", label: "point keys", cap: MAX_ONBOARDING_POINT_KEYS },
  { field: "assets", label: "assets", cap: MAX_ONBOARDING_ASSETS },
  { field: "assetPoints", label: "asset points", cap: MAX_ONBOARDING_ASSET_POINTS },
];

/**
 * The sentence that refuses a stored draft holding more items than one session
 * may commit, or `null` when it may.
 *
 * This is the check that answers for the producers no workbook can reach. **A
 * workbook produces neither `pointKeys` nor `assetPoints`** — `toDraftPatch`
 * writes `location`, `rtus`, `assets` and `onboardingMeta`, and nothing else —
 * and **three** other producers do:
 *
 * 1. `PATCH :id/draft`, whose body is parsed by `patchDraftBodySchema`, so the
 *    schema `.max()` refuses it at the controller.
 * 2. The model's `draftPatch`, parsed by `onboardingDraftSchema.safeParse` in
 *    `handleOpenAiTurn`. Over-cap, the patch fails the parse and `.data ?? {}`
 *    discards it — see the ruling recorded on that schema.
 * 3. **`handleRuleBasedTurn`, which the schema `.max()` does not reach at all.**
 *    It assembles its patch in code and never parses the schema — the
 *    `safeParse` above it guards the model branch alone — and two of its
 *    branches concatenate onto the stored draft rather than replace it
 *    (`patch.rtus`, `patch.pointKeys`), so the draft grows by one item per turn.
 *    Nothing bounded that until `OnboardingService.chat` was made to call this
 *    function on the merged draft before its write. It is the default branch,
 *    not a fallback: `.env.example` ships `OPENAI_API_KEY=` empty.
 *
 * An earlier version of this docblock named only the first two, and that
 * sentence is why the third shipped unguarded. It is corrected here rather than
 * deleted, so the next reader inherits the correction and not just the list.
 *
 * A missing array is not an empty one being refused — an onboarding draft is
 * legitimately partial until it commits, so `undefined` counts as zero.
 */
export function draftCountProblem(draft: OnboardingDraft): string | null {
  for (const { field, label, cap } of CAPPED_DRAFT_ARRAYS) {
    const found = draft[field]?.length ?? 0;
    if (found > cap) {
      return (
        `The draft holds ${found} ${label}, more than the ${cap} one onboarding session may ` +
        `commit; remove some and commit the rest in a second session`
      );
    }
  }
  return null;
}

/**
 * The distinct plant-domain codes a draft's assets name, in first-appearance
 * order.
 *
 * `OnboardingCommitService` checks each of these against `bms.asset_domains`
 * before its transaction opens, and that check is an uncached `SELECT` with no
 * batching. Per asset it cost one round trip each, nearly all of them repeating
 * an identical query; per distinct code the count is bounded by the vocabulary
 * rather than by the operator's sheet.
 *
 * **The order is the contract.** The loop this replaces reported the first asset
 * whose domain was unknown, so the code the operator is told to fix must still
 * be that one — `new Set` preserves insertion order, and the spec pins it rather
 * than assuming it. Nothing is folded or trimmed here either: whether a spelling
 * is a live vocabulary member is `assertAssetDomain`'s decision, and normalising
 * on the way in would answer it in the wrong place.
 */
export function distinctAssetDomains(assets: readonly { domain: string }[]): string[] {
  return [...new Set(assets.map((asset) => asset.domain))];
}
