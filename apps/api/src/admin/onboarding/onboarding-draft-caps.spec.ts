import { createHash } from "node:crypto";

import {
  CATALOG_CODE_PATTERN,
  MAX_ONBOARDING_ASSET_POINTS,
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_POINT_KEYS,
  MAX_ONBOARDING_RTUS,
  ONBOARDING_DRAFT_STRING_MAX,
} from "@bms/shared";
import type { OnboardingDraft } from "@bms/shared";

import {
  catalogCodeSlug,
  cellLengthProblem,
  cutToBound,
  cutToBoundWithHashSuffix,
  distinctAssetDomains,
  draftCountProblem,
  workbookSectionCountProblem,
} from "./onboarding-draft-caps";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function times<T>(count: number, build: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => build(index));
}

/**
 * The four item builders. Only `.length` is read by the function under test, but
 * the fixtures are the real draft shapes so that the same arrays could be fed to
 * `onboardingDraftSchema` without editing — which is what keeps this spec and
 * `onboarding.schema.spec.ts` describing one draft rather than two.
 */
function rtuAt(index: number): NonNullable<OnboardingDraft["rtus"]>[number] {
  return { code: `RTU-${index}`, displayName: `RTU ${index}`, protocol: "mqtt", config: {} };
}

function pointKeyAt(index: number): NonNullable<OnboardingDraft["pointKeys"]>[number] {
  return { code: `pk_${index}`, name: `Point ${index}` };
}

function assetAt(index: number): NonNullable<OnboardingDraft["assets"]>[number] {
  return {
    rtuIndex: 0,
    code: `ASSET-${index}`,
    name: `Asset ${index}`,
    siteName: "Site",
    domain: "electrical",
  };
}

function assetPointAt(index: number): NonNullable<OnboardingDraft["assetPoints"]>[number] {
  return { assetIndex: 0, pointKey: `pk_${index}`, sourceDataKey: `src_${index}` };
}

/** The cell text of the shipped template, which no refusal may repeat (§4.3). */
const TEMPLATE_CELLS = ["Berhampur", "BERHAMPUR-RTU-1"] as const;

/**
 * `F4.103` — the workbook half of the cap: a `RTUS` or `ASSETS` section with more
 * data rows than the section's cap is refused, and the sentence says which
 * section, how many rows it found and what the cap is.
 *
 * **The two sections do not share one number, and that is asserted rather than
 * read off the constants.** A count over the RTU cap but under the asset cap is
 * a refusal for `RTUS` and no refusal at all for `ASSETS`; without that case a
 * single shared cap would satisfy every other assertion here.
 */
export function assertWorkbookSectionCountProblem(): void {
  for (const [section, cap] of [
    ["RTUS", MAX_ONBOARDING_RTUS],
    ["ASSETS", MAX_ONBOARDING_ASSETS],
  ] as const) {
    assert(
      workbookSectionCountProblem(section, 0) === null,
      `a missing ${section} section has no rows and is not this guard's business`,
    );
    assert(
      workbookSectionCountProblem(section, cap) === null,
      `exactly ${cap} ${section} data rows is inside the cap`,
    );

    const over = workbookSectionCountProblem(section, cap + 1);
    assert(over !== null, `${cap + 1} ${section} data rows must be refused`);
    const message = String(over);
    assert(message.includes(section), `the refusal names the section to repair, got "${message}"`);
    assert(
      message.includes(String(cap + 1)),
      `the refusal names the count it found, got "${message}"`,
    );
    assert(message.includes(String(cap)), `the refusal names the cap it applied, got "${message}"`);
    assert(
      message.includes("split the workbook into smaller ones"),
      `the refusal tells the operator what to do, got "${message}"`,
    );
    // AGENTS.md §4.3, the rule every other refusal in this family follows: a
    // refusal describes what it refused and never repeats a cell. Nothing but a
    // section name, a count and a cap may reach this sentence.
    for (const cell of TEMPLATE_CELLS) {
      assert(!message.includes(cell), `the refusal must not echo cell text, got "${message}"`);
    }
    assert(message.length < 400, `the refusal is a sentence, got ${message.length} characters`);
  }

  // Each section carries its own cap. `MAX_ONBOARDING_RTUS + 1` is over the RTU
  // cap and far under the asset one, so one shared number cannot satisfy both.
  assert(
    workbookSectionCountProblem("RTUS", MAX_ONBOARDING_RTUS + 1) !== null &&
      workbookSectionCountProblem("ASSETS", MAX_ONBOARDING_RTUS + 1) === null,
    `${MAX_ONBOARDING_RTUS + 1} rows is over the RTU cap and under the asset one`,
  );
}

/**
 * `F4.104` — the cell half of the workbook guard: a value longer than the
 * column it commits to is refused, and the sentence says which section, which
 * data row, which column, how long the cell was and what the bound is.
 *
 * **Refused, never truncated**, like every sibling in this module. A silently
 * shortened asset code commits plant under a name nobody chose, and the
 * operator finds out from the equipment that answers to the wrong label.
 *
 * **Nothing read from the sheet reaches the sentence** (AGENTS.md §4.3, and the
 * same argument this module's head docblock makes for the count refusals).
 * `column` is a header literal the *call site* passes — one of the members of
 * `LOCATION_HEADERS`, `RTU_HEADERS` or `ASSET_HEADERS`, never the header text
 * the workbook actually carried — and `value` is read for its `.length` alone.
 * The last assertion below is what pins that: a cell of one repeated character
 * may not appear in the message in any run.
 *
 * `dataRow` is `null` for `LOCATION` and a number elsewhere, because
 * `parseLocation` reads `rows[1]` and nothing else while the two other sections
 * are `rows.slice(1).map(...)`. Both shapes are asserted; a single sentence
 * carrying `data row null` would be the drift this distinction exists to avoid.
 */
export function assertCellLengthProblem(): void {
  const nameMax = ONBOARDING_DRAFT_STRING_MAX["assets.name"];

  assert(
    cellLengthProblem("ASSETS", 3, "asset_name", "", nameMax) === null,
    "a blank cell is short, not long — completeness is a different axis and a different check",
  );
  assert(
    cellLengthProblem("ASSETS", 3, "asset_name", "A".repeat(nameMax), nameMax) === null,
    `a cell of exactly ${nameMax} characters is inside the bound`,
  );

  const over = cellLengthProblem("ASSETS", 3, "asset_name", "Z".repeat(nameMax + 1), nameMax);
  assert(over !== null, `a cell of ${nameMax + 1} characters must be refused`);
  const message = String(over);
  assert(message.includes("ASSETS"), `the refusal names the section to repair, got "${message}"`);
  assert(
    message.includes("data row 3"),
    `the refusal names the data row as the operator counts it, got "${message}"`,
  );
  assert(
    message.includes("asset_name"),
    `the refusal names the column header to repair, got "${message}"`,
  );
  assert(
    message.includes(String(nameMax + 1)),
    `the refusal names the length it read, got "${message}"`,
  );
  assert(message.includes(String(nameMax)), `the refusal names the bound it applied, got "${message}"`);
  assert(
    message.includes("upload the workbook again"),
    `the refusal tells the operator what to do, got "${message}"`,
  );

  // The `LOCATION` shape: one data row, so there is no number to count to and
  // the sentence must not invent one.
  const location = String(
    cellLengthProblem(
      "LOCATION",
      null,
      "name",
      "Z".repeat(ONBOARDING_DRAFT_STRING_MAX["location.name"] + 1),
      ONBOARDING_DRAFT_STRING_MAX["location.name"],
    ),
  );
  assert(
    location.includes("The LOCATION section's data row has"),
    `the LOCATION refusal names no row number — there is only one, got "${location}"`,
  );
  assert(
    !location.includes("null") && !location.includes("undefined"),
    `a missing row number is not printed, got "${location}"`,
  );

  // §4.3, the assertion the whole shape exists for: a 32,767-character cell
  // quoted back is the amplification `F4.102` closed on the neighbouring cells
  // of this same sheet, through a 400 instead of a 200.
  const hostile = String(
    cellLengthProblem("RTUS", 1, "rtu_code", "Z".repeat(32_767), ONBOARDING_DRAFT_STRING_MAX["rtus.code"]),
  );
  assert(
    !hostile.includes("ZZZZZZZZZZ"),
    `the refusal must not echo the cell it refused, got "${hostile.slice(0, 200)}"`,
  );
  for (const cell of TEMPLATE_CELLS) {
    assert(!hostile.includes(cell), `the refusal must not echo cell text, got "${hostile}"`);
  }
  assert(hostile.length < 400, `the refusal is a sentence, got ${hostile.length} characters`);
}

/**
 * `F4.103` — the draft half of the cap, which is the one that answers for a
 * draft assembled through `PATCH :id/draft` or the chat patch. No workbook
 * produces `pointKeys` or `assetPoints` at all, so those two arrays have no
 * spreadsheet guard and this is the only place they are counted.
 *
 * **The reported array is the first one over its cap in the schema's own
 * declaration order**, which is what makes the sentence an operator gets the
 * same one Zod would have reported for the same draft.
 */
export function assertDraftCountProblem(): void {
  assert(draftCountProblem({}) === null, "an empty draft holds nothing to refuse");

  const atEveryCap: OnboardingDraft = {
    rtus: times(MAX_ONBOARDING_RTUS, rtuAt),
    pointKeys: times(MAX_ONBOARDING_POINT_KEYS, pointKeyAt),
    assets: times(MAX_ONBOARDING_ASSETS, assetAt),
    assetPoints: times(MAX_ONBOARDING_ASSET_POINTS, assetPointAt),
  };
  assert(
    draftCountProblem(atEveryCap) === null,
    `a draft at all four caps commits — the caps are a ceiling, not a target, got "${String(draftCountProblem(atEveryCap))}"`,
  );

  // The builder is widened to `unknown` for the same reason
  // `onboarding.schema.spec.ts` widens its own: a heterogeneous `as const` table
  // gives `build` a union type that no single call can satisfy. Only `.length`
  // is read, and the four `atEveryCap` arrays above are typed exactly.
  const cases: readonly (readonly [string, string, number, (index: number) => unknown])[] = [
    ["rtus", "RTUs", MAX_ONBOARDING_RTUS, rtuAt],
    ["pointKeys", "point keys", MAX_ONBOARDING_POINT_KEYS, pointKeyAt],
    ["assets", "assets", MAX_ONBOARDING_ASSETS, assetAt],
    ["assetPoints", "asset points", MAX_ONBOARDING_ASSET_POINTS, assetPointAt],
  ];

  for (const [field, label, cap, build] of cases) {
    const overCap = { [field]: times(cap + 1, build) } as OnboardingDraft;
    const problem = draftCountProblem(overCap);
    assert(problem !== null, `a draft holding ${cap + 1} ${field} must be refused`);
    const message = String(problem);
    assert(message.includes(label), `the refusal names the array, got "${message}"`);
    assert(
      message.includes(String(cap + 1)),
      `the refusal names the count it found, got "${message}"`,
    );
    assert(message.includes(String(cap)), `the refusal names the cap it applied, got "${message}"`);
    assert(
      message.includes("commit the rest in a second session"),
      `the refusal tells the operator what to do, got "${message}"`,
    );
    // §4.3 again: the label is one of four literals in the module, never a value
    // read out of the draft, so no item's own text can reach the sentence.
    assert(
      !message.includes("RTU-0") && !message.includes("ASSET-0") && !message.includes("pk_0"),
      `the refusal must not echo a draft item, got "${message}"`,
    );
    assert(message.length < 400, `the refusal is a sentence, got ${message.length} characters`);
  }

  // Over two caps at once: the sentence names `rtus`, the first of the four in
  // the schema's declaration order. Nothing else holds that order, and the
  // ordering is what decides which single sentence an operator is given.
  const overBoth: OnboardingDraft = {
    rtus: times(MAX_ONBOARDING_RTUS + 1, rtuAt),
    assetPoints: times(MAX_ONBOARDING_ASSET_POINTS + 1, assetPointAt),
  };
  const first = String(draftCountProblem(overBoth));
  assert(
    first.includes("RTUs") && !first.includes("asset points"),
    `a draft over both caps is told about its RTUs first, got "${first}"`,
  );
}

/**
 * `F4.103` — the domain list `OnboardingCommitService` checks against
 * `bms.asset_domains`, one entry per *distinct* code instead of one per asset.
 *
 * **First-appearance order is the contract, not an implementation detail.** The
 * loop it replaces reported the first asset whose domain was unknown, so a
 * de-duplication that sorted or reversed would change which code the operator is
 * told to fix while every other assertion stayed green.
 */
export function assertDistinctAssetDomains(): void {
  assert(
    JSON.stringify(distinctAssetDomains([])) === "[]",
    "a draft with no assets names no domains",
  );
  assert(
    JSON.stringify(
      distinctAssetDomains([
        { domain: "electrical" },
        { domain: "electrical" },
        { domain: "hvac" },
        { domain: "electrical" },
      ]),
    ) === JSON.stringify(["electrical", "hvac"]),
    "repeats collapse and the first appearance keeps its place",
  );
  assert(
    JSON.stringify(distinctAssetDomains([{ domain: "hvac" }, { domain: "electrical" }])) ===
      JSON.stringify(["hvac", "electrical"]),
    "the order is the assets' own, not alphabetical",
  );
  // The code is passed through exactly as the draft holds it: `assertAssetDomain`
  // is what decides whether it is a live vocabulary member, and folding here
  // would refuse a code the database would have accepted, or accept one it
  // would not.
  assert(
    JSON.stringify(distinctAssetDomains([{ domain: "hvac" }, { domain: "HVAC" }])) ===
      JSON.stringify(["hvac", "HVAC"]),
    "two spellings are two codes here — the vocabulary check owns that decision",
  );
}

/** One astral-plane character: one code point, two UTF-16 code units. */
const ASTRAL = "\u{1F600}";

/** True when `value` holds a surrogate that is not part of a pair. */
function hasLoneSurrogate(value: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

/**
 * `cutToBound` cuts on whole characters, and it counts the same units
 * `z.string().max()` counts.
 *
 * Both halves matter and they pull in opposite directions, which is why the
 * obvious one-liner is wrong. Counting **code units** is what the schema does,
 * so the result has to be `.length <= max`. Cutting **between** code units is
 * what produces a lone surrogate, which `JSON.stringify` escapes as `\ud83d` and
 * Postgres refuses in `jsonb` with `Unicode low surrogate must follow a high
 * surrogate` — a 500 out of the rule-based chat branch, which parses no schema.
 *
 * The `[...value].slice(0, max).join("")` form satisfies the second and breaks
 * the first: it returns up to `2 × max` code units, the schema then refuses the
 * field, and `OnboardingValidateService.validate` hands the operator a permanent
 * per-field error. The case below states that difference in numbers so the two
 * forms cannot be swapped by a later reader who thinks them equivalent.
 */
export function assertCutToBound(): void {
  assert(cutToBound("Berhampur", 255) === "Berhampur", "a value inside the bound is untouched");
  assert(cutToBound("abcdef", 6) === "abcdef", "a value exactly at the bound is untouched");
  assert(cutToBound("abcdef", 5) === "abcde", "a plain value is cut to the bound");
  assert(cutToBound("", 0) === "", "an empty value survives a zero bound");

  // The cut lands between the halves of a pair: 5 code units into a string of
  // three astral characters.
  const three = ASTRAL.repeat(3);
  assert(three.length === 6, `the fixture must be six code units, got ${three.length}`);
  assert(
    "\u{1F600}".repeat(3).slice(0, 5).length === 5 &&
      hasLoneSurrogate("\u{1F600}".repeat(3).slice(0, 5)),
    "the oracle must be live: a bare .slice() at this bound leaves a lone surrogate",
  );
  const cut = cutToBound(three, 5);
  assert(!hasLoneSurrogate(cut), `the cut leaves no half character, got ${JSON.stringify(cut)}`);
  assert(cut === ASTRAL.repeat(2), `the whole characters that fit are kept, got ${JSON.stringify(cut)}`);
  assert(
    !/\\u[dD][89abAB][0-9a-fA-F]{2}/.test(JSON.stringify(cut)),
    "the cut value must serialise without a lone-surrogate escape — that escape is what Postgres refuses",
  );

  // Code units, not code points. 200 astral characters are 400 code units, and
  // the schema measures the 400.
  const long = ASTRAL.repeat(200);
  assert(
    cutToBound(long, 255).length <= 255,
    `the result is bounded in the units z.string().max() counts, got ${cutToBound(long, 255).length}`,
  );
  assert(
    [...long].slice(0, 255).join("").length === 400,
    "the code-point form returns 400 characters for this input — it is not interchangeable with " +
      "this function, and the schema is what tells them apart",
  );
}

/**
 * `cutToBoundWithHashSuffix` makes a cut identifier distinct, and leaves an
 * uncut one exactly as it found it.
 *
 * Owner ruling 6 (`F4.104` review). `bms.locations.slug` and `bms.assets.code`
 * are unique across every tenant and the onboarding commit inserts with no
 * `onConflict`, so a plain cut turns two organisations whose names agree on
 * their first 64 characters into an uncaught unique violation for the second —
 * a 500 that also says some other organisation holds that value.
 */
export function assertCutToBoundWithHashSuffix(): void {
  // --- untouched below the bound, byte for byte ------------------------------
  for (const value of ["berhampur-water-works", "a", "", "x".repeat(64)]) {
    assert(
      cutToBoundWithHashSuffix(value, 64, "lower") === value,
      `a value at or inside the bound must not grow a suffix, got ${JSON.stringify(
        cutToBoundWithHashSuffix(value, 64, "lower"),
      )}`,
    );
  }

  // --- cut, and inside the bound --------------------------------------------
  const long = "berhampur-water-treatment-plant-".repeat(4);
  const cut = cutToBoundWithHashSuffix(long, 64, "lower");
  assert(cut.length <= 64, `the suffix is budgeted inside the bound, got ${cut.length}`);
  assert(/-[0-9a-f]{8}$/.test(cut), `a cut value carries a hash of the whole value, got "${cut}"`);
  assert(long.startsWith(cut.slice(0, cut.length - 9)), `the prefix is the value's own, got "${cut}"`);
  assert(
    /^[a-z0-9-]+$/.test(cut),
    `the result must survive draftLocationSchema.slug's own regex, got "${cut}"`,
  );
  assert(!cut.includes("--"), `a trailing separator is stripped before the hash, got "${cut}"`);

  // --- two long values agreeing on their prefix differ ----------------------
  const twin = `${long}-second-tenant`;
  assert(
    twin.startsWith(long.slice(0, 64)) && long.slice(0, 64) === twin.slice(0, 64),
    "this case needs two values that agree past the bound, or it asserts nothing",
  );
  assert(
    cutToBoundWithHashSuffix(twin, 64, "lower") !== cut,
    "two values sharing their first 64 characters must not produce one globally unique identifier",
  );

  // Deterministic: the same value gives the same answer on every request, so a
  // re-uploaded workbook or a repeated turn does not manufacture a second row.
  assert(
    cutToBoundWithHashSuffix(long, 64, "lower") === cut,
    "the suffix is a hash of the value, not a random or time-derived string",
  );

  // --- the alphabet follows the field's own character class -----------------
  const upper = cutToBoundWithHashSuffix(long.toUpperCase(), 64, "upper");
  assert(/-[0-9A-F]{8}$/.test(upper), `the upper alphabet is uppercase hex, got "${upper}"`);
  assert(
    /^[A-Z0-9_-]+$/.test(upper),
    `the result must survive draftLocationSchema.code's own regex, got "${upper}"`,
  );

  // --- the hash is taken over the WHOLE value, never over the kept prefix ----
  // Hashing the prefix would make the suffix equal for every value sharing it,
  // which is the collision the suffix exists to prevent. Stated as a comparison
  // against the digest of the prefix so it cannot silently regress.
  const prefixOnly = cut.slice(0, cut.length - 9);
  assert(
    createHash("sha256").update(prefixOnly, "utf8").digest("hex").slice(0, 8) !==
      cut.slice(cut.length - 8),
    "the hash must be of the whole value — a hash of the kept prefix collides for every value " +
      "sharing that prefix, which is the failure this suffix exists to prevent",
  );
  assert(
    createHash("sha256").update(long, "utf8").digest("hex").slice(0, 8) === cut.slice(cut.length - 8),
    "and it is the whole value's own digest, so two systems reading this code agree on it",
  );

  // --- a bound too small to hold a prefix is not a negative slice ------------
  assert(
    cutToBoundWithHashSuffix("x".repeat(20), 4, "lower").length === 4,
    "a bound smaller than the suffix budget returns something inside the bound rather than throwing",
  );
}

/**
 * `catalogCodeSlug` reduces a free-text name to the catalog code class
 * `[A-Za-z0-9_-]` (ADR 0065 decision 4), so what the chat producer builds the
 * asset code from is legal before it is upper-cased and cut.
 *
 * A literal table rather than a property: each row pins one step of the
 * derivation — the illegal-run replacement, the `-` collapse, the trim at each
 * end, a non-ASCII letter, the all-illegal case, and the identity inside the
 * class — so the mutation that drops a step reddens the row that names it.
 */
export function assertCatalogCodeSlug(): void {
  const rows: readonly [input: string, output: string, pins: string][] = [
    ["St. Mary's Works", "St-Mary-s-Works", "every illegal run becomes one `-`"],
    ["Plant #1 (East)", "Plant-1-East", "a trailing `-` is trimmed"],
    ["a - b", "a-b", "a run of `-` collapses to one"],
    ["-x-", "x", "a `-` at either end is trimmed"],
    ["Straße", "Stra-e", "`ß` is outside the class"],
    ["\u{1F600}\u{1F600}", "", "an all-illegal name collapses to nothing"],
    ["TX_01", "TX_01", "a name inside the class is byte-identical"],
    // All four kinds the class admits, in one row: upper, lower, digit, `_`
    // and `-`. Narrowing `CATALOG_CODE_PATTERN` in any one of them reddens
    // this row, which is the direction the negated copy beside
    // `cutToBoundWithHashSuffix` cannot catch on its own.
    ["aZ0_9-x", "aZ0_9-x", "every kind the class admits survives untouched"],
  ];
  for (const [input, output, pins] of rows) {
    const result = catalogCodeSlug(input);
    assert(
      result === output,
      `${pins}: catalogCodeSlug(${JSON.stringify(input)}) must be ${JSON.stringify(output)}, ` +
        `got ${JSON.stringify(result)}`,
    );
    assert(
      result === "" || CATALOG_CODE_PATTERN.test(result),
      `every non-empty result is inside CATALOG_CODE_PATTERN, got ${JSON.stringify(result)}`,
    );
  }
}
