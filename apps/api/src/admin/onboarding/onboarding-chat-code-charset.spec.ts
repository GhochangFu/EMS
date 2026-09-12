import {
  CATALOG_CODE_MESSAGE,
  CATALOG_CODE_PATTERN,
  ONBOARDING_DRAFT_STRING_MAX,
} from "@bms/shared";

import { COMMIT_UNIQUE_CONFLICTS } from "./onboarding-commit-conflict";
import { draftBeforeAssets, ruleBasedTurn } from "./onboarding-chat.service.spec";
import { onboardingDraftSchema } from "./onboarding.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F2.23` / ADR 0065 decision 4 — the rule-based `assets` branch builds the
 * asset code from the **stored** location name, and before this row it only
 * replaced whitespace with `-` before upper-casing. `St. Mary's Works` gave
 * `ST.-MARY'S-WORKS-ASSET-1`, which decision 1's class now refuses at
 * `assets.0.code` when `validate` re-parses the draft — the same permanent,
 * chat-unclearable validation error `F4.104` closed for length, reopened for
 * charset by the row that added the class.
 *
 * Its own file rather than a block in `onboarding-chat.service.spec.ts`: that
 * file is at §4.5's line ceiling. `ruleBasedTurn` and `draftBeforeAssets` are
 * imported from it so this file drives the same real `handleTurn`.
 */

/** The formula the producer used before decision 4, kept here as the oracle's input. */
function preRowAssetCode(site: string): string {
  return `${site.replace(/\s+/g, "-").toUpperCase()}-ASSET-1`;
}

/** The asset the rule-based `assets` branch yields for a stored location name. */
async function assetCodeFromLocation(name: string): Promise<{
  code: string;
  patch: Awaited<ReturnType<typeof ruleBasedTurn>>["draftPatch"];
}> {
  const turn = await ruleBasedTurn("One asset", draftBeforeAssets(name), "assets");
  const asset = turn.draftPatch.assets?.[0];
  if (asset === undefined) {
    throw new Error("this case must reach the rule-based assets branch, or it measures the OpenAI one");
  }
  assert(
    asset.name === "Primary Device",
    "only the rule-based branch names the asset — this patch came from elsewhere",
  );
  return { code: asset.code, patch: turn.draftPatch };
}

/** A name with `.`, `'` and spaces yields a code inside the class, and nothing else changes. */
export async function assertAssetsTurnSlugifiesTheLocationName(): Promise<void> {
  const { code } = await assetCodeFromLocation("St. Mary's Works");
  assert(
    code === "ST-MARY-S-WORKS-ASSET-1",
    `each illegal run becomes one "-" before the upper-case and the marker, got "${code}"`,
  );
}

/**
 * The patch the branch produces satisfies the draft schema, and the oracle is
 * live: the pre-row formula's output for the same name is refused by the same
 * parse, at the same path, with decision 1's sentence. The positive claim comes
 * first so that reverting the producer reddens this case at its first line.
 */
export async function assertAssetsTurnPatchSatisfiesTheSchema(): Promise<void> {
  const { code, patch } = await assetCodeFromLocation("St. Mary's Works");
  const parsed = onboardingDraftSchema.safeParse(patch);
  assert(
    parsed.success,
    `the patch this branch produces must satisfy the draft schema: ${JSON.stringify(
      parsed.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    )}`,
  );

  const oldCode = preRowAssetCode("St. Mary's Works");
  assert(
    oldCode === "ST.-MARY'S-WORKS-ASSET-1",
    `this case needs the pre-row formula's exact output, got "${oldCode}"`,
  );
  assert(oldCode !== code, "the two formulas must differ on this name, or the oracle proves nothing");
  const refused = onboardingDraftSchema.safeParse({
    assets: [{ ...(patch.assets?.[0] ?? {}), code: oldCode }],
  });
  const codeIssue = (refused.success ? [] : refused.error.issues).find(
    (issue) => issue.path.join(".") === "assets.0.code",
  );
  assert(
    !refused.success && codeIssue !== undefined,
    "the schema must refuse the pre-row code at assets.0.code, or this parse proves nothing",
  );
  assert(
    codeIssue?.message === CATALOG_CODE_MESSAGE,
    `the refusal carries decision 1's sentence, got ${JSON.stringify(codeIssue?.message)}`,
  );
}

/**
 * Slug before upper-case. `"ß".toUpperCase()` is `"SS"`, so upper-casing first
 * would fold a letter outside the class into two inside it and the name would
 * yield `STRASSE-WORKS-ASSET-1`; the class is safe either way, but the code an
 * operator sees for a name differs, and this pins the order the ADR states.
 */
export async function assertAssetsTurnSlugifiesBeforeUpperCasing(): Promise<void> {
  const { code } = await assetCodeFromLocation("Straße Works");
  assert(
    code === "STRA-E-WORKS-ASSET-1",
    `"ß" is outside the class and becomes "-" before the upper-case, got "${code}"`,
  );
  assert(
    code !== "STRASSE-WORKS-ASSET-1",
    "upper-casing first folds ß into SS and yields the wrong code for this name",
  );
}

/**
 * A name with nothing inside the class collapses to the empty slug, and the
 * code the producer yields is the marker alone — legal under `.min(2)` and the
 * class. Stated executably rather than inherited from the plan's arithmetic.
 */
export async function assertAssetsTurnFromAnAllIllegalName(): Promise<void> {
  const { code, patch } = await assetCodeFromLocation("\u{1F600}\u{1F600}");
  assert(code === "-ASSET-1", `an all-illegal name yields the marker alone, got "${code}"`);
  const parsed = onboardingDraftSchema.safeParse(patch);
  assert(
    parsed.success,
    `the marker alone must satisfy the draft schema: ${JSON.stringify(
      parsed.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    )}`,
  );
}

/**
 * The cut still composes with the slug (plan fact 2, executed): a long name of
 * letters and spaces is legal at `location.name`, overflows `assets.code`, and
 * the hash-suffixed result stays inside the bound and inside the class.
 */
export async function assertAssetsTurnKeepsACutCodeInsideTheClass(): Promise<void> {
  const longName = "Berhampur Water Treatment Plant ".repeat(3).trim();
  assert(
    longName.length === 95 && /^[A-Za-z ]+$/.test(longName),
    `this case needs a 95-character letters-and-spaces name, got ${longName.length}`,
  );
  assert(
    longName.length <= ONBOARDING_DRAFT_STRING_MAX["location.name"] &&
      preRowAssetCode(longName).length > ONBOARDING_DRAFT_STRING_MAX["assets.code"],
    "this case needs a name that is legal and still overflows the asset code",
  );
  const { code } = await assetCodeFromLocation(longName);
  assert(
    code.length <= ONBOARDING_DRAFT_STRING_MAX["assets.code"],
    `assets[].code is cut to its bound, got ${code.length} characters`,
  );
  assert(/-[0-9A-F]{8}$/.test(code), `a cut code ends in the upper-case hex suffix, got "${code}"`);
  assert(CATALOG_CODE_PATTERN.test(code), `a cut code stays inside the class, got "${code}"`);
}

/**
 * Security review of `F2.23` (M1). The slug widens which location names share
 * an asset code — `Plant 1`, `Plant.1`, `Plant (1)` and `Plant-1` all yield
 * `PLANT-1-ASSET-1`, and every name with nothing inside the class yields
 * `-ASSET-1` — on a column unique across tenants (`assets_code_unique`).
 *
 * **The first version of this gate asserted the wrong mechanism**, and the
 * code review refuted it by execution. It claimed an equal asset code implies
 * an equal location slug, so the location insert always refuses the second
 * tenant first. The two derivations fold case in opposite orders — the
 * location branch lower-cases then strips (`onboarding-chat.service.ts`
 * `[^a-z0-9]+`), the asset branch strips then upper-cases — so a character
 * whose lower-case is ASCII breaks it: `İ` (U+0130) gives slug `i` and code
 * `-ASSET-1`, while `U+1F600` gives slug `location` and the same code. Two tenants
 * can therefore share an asset code and not share a slug. The original pool
 * held no such name, so the claim stayed green.
 *
 * **What is true, and what this gate now asserts:** a shared derived asset
 * code is always refused with a *translated 400* — on `locations_slug_unique`
 * when the slugs also collide, otherwise on `assets_code_unique`, which
 * `COMMIT_UNIQUE_CONFLICTS` maps (`onboarding-commit-conflict.ts`). Never an
 * untranslated 500, which is what M1 asked about. The residual it leaves is
 * usability, not security: the operator is refused on a code they never typed.
 * That is filed as its own row rather than fixed here, because deriving the
 * code from `location.slug` instead of the name would change ADR 0065
 * decision 4 and needs the owner.
 */
export async function assertASharedAssetCodeIsAlwaysATranslatedRefusal(): Promise<void> {
  const names = [
    "Plant 1",
    "Plant.1",
    "Plant (1)",
    "Plant-1",
    "Plant_1",
    "कारखाना",
    "工厂",
    "İ", // the counterexample: slug `i`, code `-ASSET-1`
    "İstanbul Works",
    "a_b",
    "a-b",
    "a b",
    "St. Mary's Works",
    "Straße Works",
  ];
  const derived: Array<{ name: string; code: string; slug: string }> = [];
  for (const name of names) {
    const location = await ruleBasedTurn(name, {}, "location");
    const slug = location.draftPatch.location?.slug;
    if (slug === undefined) {
      throw new Error(`the location branch must yield a slug for ${JSON.stringify(name)}`);
    }
    const { code } = await assetCodeFromLocation(name);
    derived.push({ name, code, slug });
  }

  let codePairs = 0;
  let pairsTheSlugDoesNotCatch = 0;
  for (const a of derived) {
    for (const b of derived) {
      if (a === b || a.code !== b.code) continue;
      codePairs += 1;
      if (a.slug !== b.slug) pairsTheSlugDoesNotCatch += 1;
    }
  }
  assert(
    codePairs >= 2,
    `the pool must contain a colliding pair or this proves nothing, got ${codePairs}`,
  );
  // The counterexample must be IN the pool, or the sentence above is untested
  // prose again. This is the positive control for the correction itself.
  assert(
    pairsTheSlugDoesNotCatch >= 2,
    "the pool must contain a pair that shares a code and not a slug — without one " +
      "this gate re-asserts the implication the code review refuted",
  );

  // Whichever constraint fires, the commit answers a translated 400.
  for (const constraint of ["assets_code_unique", "locations_slug_unique"]) {
    const mapped = COMMIT_UNIQUE_CONFLICTS.get(constraint);
    if (mapped === undefined) {
      throw new Error(`${constraint} must be translated, or a derived-code collision is a 500`);
    }
    assert(
      mapped.message.length > 0,
      `${constraint} must carry an operator sentence, got ${JSON.stringify(mapped.message)}`,
    );
  }
}
