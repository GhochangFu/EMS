import {
  MAX_ONBOARDING_ASSET_POINTS,
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_POINT_KEYS,
  MAX_ONBOARDING_RTUS,
  ONBOARDING_DRAFT_STRING_MAX,
} from "@bms/shared";
import type { OnboardingDraft } from "@bms/shared";

import {
  cellLengthProblem,
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
