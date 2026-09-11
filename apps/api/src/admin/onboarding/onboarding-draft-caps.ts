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
 * §4.3). Every interpolation is a section name from a closed union, a label from
 * a list of four literals in this file, a column header literal the call site
 * passes from its own `*_HEADERS` array, or a number — so, unlike every other
 * sheet-supplied string this family echoes, none of them needs `quoteCell`. That
 * is the same argument `columnBoundedRange` records for its own interpolation in
 * `telemetry-import-rows.ts`.
 *
 * `F4.104` adds `cellLengthProblem` on the same terms and on a third axis: how
 * long one value may be, as against how many items a section or a draft may
 * carry. Its own docblock records why that bound is applied where the cell is
 * read rather than by parsing the draft schema at the upload boundary.
 *
 * `F4.104`'s review adds `cutToBound` and `cutToBoundWithHashSuffix`, which are
 * the *other* treatment of the same axis — the one the rule-based chat branch
 * takes, where a refusal would be a dead end mid-conversation. They live beside
 * the refusals rather than in the chat service because a cut and a refusal must
 * be read against each other: one module, one account of why a given producer
 * gets one and not the other. Both are pure; `node:crypto` is Node's own.
 *
 * The four numbers themselves, and where each comes from, are declared once in
 * `packages/shared/src/contracts/onboarding.ts` and are deliberately not
 * restated here.
 */
import { createHash } from "node:crypto";

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

/**
 * The three marker-delimited sections a cell may be read from. `LOCATION` joins
 * the two above here and only here: it produces no draft *array*, so it has no
 * count cap, but it does produce four draft *strings*.
 */
export type OnboardingWorkbookCellSection = OnboardingWorkbookSection | "LOCATION";

/**
 * `F4.104` — the sentence that refuses a workbook cell longer than the draft
 * field it becomes, or `null` when the parser may keep it.
 *
 * **Why the parse site and not a schema parse at the upload boundary** (owner
 * ruling 1). `onboardingDraftSchema` bounds every one of these fields, and
 * `uploadExcel` parses it nowhere: `parseUpload` → `toDraftPatch` → `mergeDraft`
 * → the `UPDATE` runs with no parse between them, so every bound on the schema
 * is inert on this producer. Measured on `9d384295`: all eleven of these cells
 * reached `onboarding_sessions.draft` at 32,767 characters from a ~50 KB upload.
 * The obvious repair — `onboardingDraftSchema.safeParse(patch)` in `uploadExcel`
 * — would import `.min(2)` and two regexes with the lengths, so a workbook with
 * one blank `code` cell would be refused **wholesale at upload**, where today it
 * uploads and `OnboardingValidateService.validate` reports it as the per-field
 * error the operator fixes inside the wizard (ADR 0011's partial-draft shape).
 * Length is the denial-of-service axis; completeness is not, and the two must
 * not be merged. So this guard refuses on length **only**.
 *
 * **This is a different axis from `F4.103`'s caps, and neither implies the
 * other.** Those bound how many items a workbook may carry; this bounds how long
 * one of them may be. Measured on the same commit: a workbook sitting exactly
 * *at* both caps — 100 RTUs and 500 assets, so nothing `F4.103` refuses — is
 * 166 KB on disk and yields a **72.04 MB** draft in 201 ms, re-served on every
 * later read of the session. The product of the two is what the store holds.
 *
 * **Refused, never truncated**, like both siblings above and `parseWorkbook` on
 * `MAX_IMPORT_ROWS`. A silently shortened asset code commits plant under a name
 * nobody chose. (The rule-based chat branch *slices* against the same bounds,
 * and that is deliberately not this decision: there the operator sees the result
 * in the wizard preview and edits it, and a mid-conversation 400 would replace a
 * graceful per-field validation error with a dead end. Do not generalise either
 * ruling to the other.)
 *
 * **Nothing read from the sheet reaches the sentence** (AGENTS.md §4.3).
 * `column` is a header literal supplied by the *call site* from
 * `LOCATION_HEADERS`, `RTU_HEADERS` or `ASSET_HEADERS` — never the header text
 * the workbook carried — and `value` is read for its `.length` alone.
 *
 * `dataRow` is the cell's position in the section's data rows, which is what an
 * operator counts down the sheet, and `null` for `LOCATION`, which is a single
 * row by construction (`parseLocation` reads `rows[1]` and nothing else).
 */
export function cellLengthProblem(
  section: OnboardingWorkbookCellSection,
  dataRow: number | null,
  column: string,
  value: string,
  max: number,
): string | null {
  if (value.length <= max) {
    return null;
  }
  const where =
    dataRow === null
      ? `The ${section} section's data row`
      : `The ${section} section's data row ${dataRow}`;
  return (
    `${where} has ${value.length} characters in the ${column} column, more than the ${max} ` +
    "this importer accepts; shorten that cell and upload the workbook again"
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

/** The UTF-16 range a **high** surrogate occupies; a code unit here is half of a pair. */
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;

/**
 * `value` cut to at most `max` characters, **never through the middle of a
 * character** — the only cut the rule-based chat branch is allowed to make.
 *
 * **Why a bare `.slice(0, max)` is wrong, and how it fails.**
 * `String.prototype.slice` counts UTF-16 code units, and every character outside
 * the Basic Multilingual Plane — an emoji, most CJK extension B ideographs, a
 * mathematical alphanumeric — occupies two of them. A cut that lands between the
 * two leaves a **lone high surrogate**, which is not a character at all, and the
 * draft is written to a `jsonb` column: `JSON.stringify` escapes the orphan as
 * `\ud83d` (ES2019 well-formed stringify), and Postgres refuses that input with
 * `invalid input syntax for type json — Unicode low surrogate must follow a high
 * surrogate`. A chat message of 200 emoji is 400 code units, so `.slice(0, 255)`
 * splits the 128th pair and the turn answers **500**, repeatably, from a body no
 * schema refuses.
 *
 * **Why this cuts on code units and then strips, rather than on code points.**
 * `[...value].slice(0, max).join("")` is the form that first suggests itself and
 * it is *not* interchangeable with this one: it keeps `max` code **points**,
 * which is up to `2 × max` code units, and `z.string().max()` measures
 * `String.length` — code units. The 200-emoji message above comes back at 400
 * characters, `onboardingDraftSchema` refuses `location.name`, and
 * `OnboardingValidateService.validate` hands the operator the permanent
 * per-field error this whole slice exists to prevent. Cutting to `max` code
 * units satisfies the schema, and satisfies the `varchar` column a fortiori,
 * because a string of `max` code units is at most `max` characters.
 *
 * **What this does not promise.** It makes the cut no worse than its input; it
 * does not make an arbitrary string safe for `jsonb`. A lone *low* surrogate
 * that arrived in the request body — `JSON.parse` accepts the `\udc00` escape
 * and `chatBodySchema` has no well-formedness check — passes through untouched
 * and still fails the write. That is older than this function and is recorded as
 * a residual on `packages/shared/src/contracts/onboarding.ts`; do not read this
 * docblock as saying it is closed.
 */
export function cutToBound(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST ? cut.slice(0, -1) : cut;
}

/** Hexadecimal characters of SHA-256 appended to a value this function had to cut. */
const HASH_SUFFIX_CHARS = 8;

/** What separates a cut prefix from its hash, and what is stripped off the prefix first. */
const HASH_SEPARATOR = "-";

/**
 * `value` cut to at most `max` characters **and made distinct**, by appending a
 * short deterministic hash of the whole value whenever — and only whenever — the
 * cut actually removed something.
 *
 * **The identifier this is for is globally unique, and the commit has no
 * `onConflict`** (owner ruling 6, `F4.104`). `bms.locations.slug` carries
 * `locations_slug_unique` from `0010_phase5_location_access.sql:16`, which
 * nothing has ever dropped — unlike `locations_code_unique`, which `0016`
 * replaced with the org-scoped `locations_org_code_idx` — and `bms.assets.code`
 * carries `assets_code_unique` from `0000_sprint1_foundation.sql:18`. Both are
 * unique across every tenant.
 *
 * Before the cut, an over-long derived `slug` failed
 * `OnboardingValidateService.validate`, `readyToCommit` stayed false and the
 * operator saw a per-field error. With a plain cut it is silently valid, so the
 * commit proceeds — and two tenants whose names share the first 64 slugified
 * characters give the second an uncaught unique violation: a 500, and an oracle
 * telling one organisation that some other one holds that slug. The hash
 * restores the parity the cut removed. It is not a defence against a caller who
 * already knows the victim's full name — such a caller can collide by simply
 * repeating it, exactly as they could before any of this — it is what stops two
 * unrelated long names from colliding because their first 64 characters agree.
 *
 * **A value inside the bound is returned byte-identical**, so nothing an
 * operator types at an ordinary length grows a suffix. The hash is taken over
 * the **whole** pre-cut value, so two values agreeing on their prefix and
 * differing after it produce different results — which is the entire point, and
 * hashing the prefix would defeat it.
 *
 * `hexCase` picks the alphabet, because the suffix must survive the field's own
 * character class: `location.slug` is `/^[a-z0-9-]+$/` and `location.code` is
 * `/^[A-Z0-9_-]+$/`, so `-` plus hex is legal in either at the right case.
 * (`assets[].code` now carries `CATALOG_CODE_PATTERN` in `draftAssetSchema`
 * and `assets_code_charset_check` on `bms.assets.code` (ADR 0065). The chat
 * producer runs `catalogCodeSlug` — this file, decision 4 — then
 * `toUpperCase()`, so this function's upper-case hex suffix stays inside the
 * class. The Excel producer (`onboarding-excel.service.ts`, `parseAssets`,
 * the `asset_code` cell) copies the cell verbatim instead of deriving it, and
 * `OnboardingValidateService.validate` refuses an illegal one at
 * `assets.<i>.code`; it takes the upper alphabet to match what a slugified
 * code would surround it with.)
 *
 * The suffix is budgeted **inside** `max`, never appended past it: the prefix is
 * cut to `max - HASH_SUFFIX_CHARS - 1`, any trailing separator is stripped so
 * the result does not read `--`, and the result is therefore at most `max` and
 * may be one or two characters short of it. Do not "fix" that by padding the
 * hash to land exactly on the bound — that couples the suffix length to the
 * bound and breaks the next time either one moves.
 */
export function cutToBoundWithHashSuffix(
  value: string,
  max: number,
  hexCase: "lower" | "upper",
): string {
  if (value.length <= max) {
    return value;
  }
  const digest = createHash("sha256").update(value, "utf8").digest("hex").slice(0, HASH_SUFFIX_CHARS);
  const suffix = hexCase === "upper" ? digest.toUpperCase() : digest;
  const prefixBound = max - suffix.length - HASH_SEPARATOR.length;
  // A bound too small to carry a prefix at all is a caller error, not a value
  // this can shorten: return the hash alone rather than a negative slice.
  if (prefixBound <= 0) {
    return cutToBound(suffix, max);
  }
  const prefix = cutToBound(value, prefixBound).replace(/-+$/, "");
  return `${prefix}${HASH_SEPARATOR}${suffix}`;
}

/**
 * A run of one or more characters outside the catalog code class. The class is
 * `CATALOG_CODE_PATTERN`'s (`@bms/shared`), restated here in its negated form
 * because a full-match regex cannot drive a replacement; the spec's per-row
 * `CATALOG_CODE_PATTERN.test(result)` is what keeps the two in step.
 */
const OUTSIDE_CATALOG_CODE_CLASS = /[^A-Za-z0-9_-]+/g;

/**
 * `value` reduced to the catalog code class `[A-Za-z0-9_-]` (ADR 0065
 * decision 4): every run of characters outside the class becomes one `-`, runs
 * of `-` collapse to one, and a `-` at either end is trimmed. A value already
 * inside the class comes back byte-identical; a value with nothing inside it
 * comes back empty, and the caller's own marker (`-ASSET-1`) is then the whole
 * code — legal, and the operator's to rename.
 *
 * **Why this and not `.replace(/\s+/g, "-")`.** The chat producer builds
 * `assets[].code` from the stored location name, and `F4.104` bounded its
 * length without bounding its alphabet: `St. Mary's Works` gave
 * `ST.-MARY'S-WORKS-ASSET-1`, which decision 1's class refuses at
 * `assets.0.code` when `validate` re-parses the draft — a permanent per-field
 * error no chat instruction can clear, the shape `F4.104` closed for length.
 * The name is free text on purpose; the code is an identifier both calc
 * dialects read inside `{CODE.key}`, so the producer, not the operator, pays
 * for the difference.
 *
 * **Slug before `toUpperCase()`, never after.** `"ß".toUpperCase()` is `"SS"`
 * and `"ſ".toUpperCase()` is `"S"`: upper-casing first folds letters outside
 * the class into letters inside it, so the same name would yield a different
 * code depending on the order. The class is safe either way; which code a name
 * yields is not, and `Straße Works` → `STRA-E-WORKS-ASSET-1` is the pinned one.
 *
 * Beside `cutToBoundWithHashSuffix` because they are two halves of one
 * derivation: this makes the value legal, that makes it fit, and its suffix
 * (`-` plus upper-case hex) is inside the class, so the composition is closed.
 */
export function catalogCodeSlug(value: string): string {
  return value
    .replace(OUTSIDE_CATALOG_CODE_CLASS, HASH_SEPARATOR)
    .replace(/-{2,}/g, HASH_SEPARATOR)
    .replace(/^-+|-+$/g, "");
}
