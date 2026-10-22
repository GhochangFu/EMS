import {
  CATALOG_CODE_MESSAGE,
  CATALOG_CODE_PATTERN,
  ONBOARDING_DRAFT_STRING_MAX,
} from "@bms/shared";

import { COMMIT_UNIQUE_CONFLICTS } from "./onboarding-commit-conflict";
import { draftBeforeAssets, ruleBasedTurn } from "./onboarding-chat.service.spec";
import { catalogCodeFromLocationName } from "./onboarding-draft-caps";
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

/**
 * The asset the rule-based `assets` branch yields for a stored location name,
 * and the slug that location carries. Since `F4.136` (ADR 0065 Amendment 2)
 * the code derives from the slug, and `draftBeforeAssets` stores the slug the
 * location branch derives from the name.
 */
async function assetCodeFromLocation(
  name: string,
  storedSlug?: string,
): Promise<{
  code: string;
  slug: string;
  patch: Awaited<ReturnType<typeof ruleBasedTurn>>["draftPatch"];
}> {
  const built = draftBeforeAssets(name);
  const draft =
    storedSlug === undefined || built.location === undefined
      ? built
      : { ...built, location: { ...built.location, slug: storedSlug } };
  const slug = draft.location?.slug ?? "";
  const turn = await ruleBasedTurn("One asset", draft, "assets");
  const asset = turn.draftPatch.assets?.[0];
  if (asset === undefined) {
    throw new Error("this case must reach the rule-based assets branch, or it measures the OpenAI one");
  }
  assert(
    asset.name === "Primary Device",
    "only the rule-based branch names the asset — this patch came from elsewhere",
  );
  return { code: asset.code, slug, patch: turn.draftPatch };
}

/** A name with `.`, `'` and spaces yields a code inside the class, and nothing else changes. */
export async function assertAssetsTurnSlugifiesTheLocationName(): Promise<void> {
  const { code } = await assetCodeFromLocation("St. Mary's Works");
  assert(
    code === "ST-MARY-S-WORKS-ASSET-1",
    `the code is the derived slug, upper-cased and marked, with no hash (F4.136), got "${code}"`,
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
 * `F4.136` — the branch reads the **stored** slug, not one re-derived from the
 * name. `West Campus HQ` derives `west-campus-hq`; the stored `wc-hq` must
 * win. Mutation: re-derive the slug from the name in the branch and the code
 * is `WEST-CAMPUS-HQ-ASSET-1`.
 */
export async function assertAssetsTurnReadsTheStoredSlug(): Promise<void> {
  const { code } = await assetCodeFromLocation("West Campus HQ", "wc-hq");
  assert(code === "WC-HQ-ASSET-1", `the code derives from the stored slug "wc-hq", got "${code}"`);
}

/**
 * A location with an empty slug (only a blank workbook slug cell gives one)
 * derives the code from the location name. Mutation: drop the call-site
 * `slug !== ""` guard and the code is the hash of `""`, not the name's code.
 */
export async function assertAssetsTurnWithAnEmptySlugDerivesFromTheName(): Promise<void> {
  const { code } = await assetCodeFromLocation("West Campus HQ", "");
  const expected = catalogCodeFromLocationName("West Campus HQ");
  assert(code === expected, `an empty slug falls back to the name's code "${expected}", got "${code}"`);
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
 * A name with nothing in `[a-z0-9]` derives the slug `location`, so the code
 * is `LOCATION-ASSET-1` — legal under `.min(2)` and the class. Every such
 * name shares that slug, and so that code: ADR 0065 Amendment 2 records it as
 * a slug residual, refused at `locations_slug_unique` before the code. The
 * all-illegal *slug* (a hand-written one) is `onboarding-draft-caps.spec.ts`'s.
 */
export async function assertAssetsTurnFromAnAllIllegalName(): Promise<void> {
  const { code, slug, patch } = await assetCodeFromLocation("\u{1F600}\u{1F600}");
  assert(slug === "location", `this case needs the fallback slug, got "${slug}"`);
  assert(code === "LOCATION-ASSET-1", `an all-illegal name yields the fallback slug's code, got "${code}"`);
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
 * `F4.136` (ADR 0065 Amendment 2) — the property the `assets` branch holds on
 * `bms.assets.code`, unique across every tenant, is now stated over the
 * location **slug**: two names derive one code **if and only if** they derive
 * one slug. `bms.locations.slug` is unique too (`locations_slug_unique`) and
 * the commit inserts the location before the asset, so where two codes
 * coincide the slug has already refused the second tenant — one refusal, on a
 * value the operator can see and edit.
 *
 * Amendment 1 hashed the name instead, so `Plant 1` and `Plant.1` reached two
 * codes and were refused on the slug anyway. Driving the branch from the name
 * again reddens the "same slug, same code" half below.
 *
 * The translation check stays: whichever constraint a collision reaches, the
 * commit answers a translated 400 rather than an untranslated 500.
 */
export async function assertDerivedCodesCollideOnlyWhereSlugsDo(): Promise<void> {
  const names = [
    "Plant 1",
    "Plant.1",
    "Plant (1)",
    "Plant-1",
    "Plant_1",
    "कारखाना",
    "工厂",
    // F3.27: two characters, not one — `add_asset` now refuses a one-character
    // `siteName` (min 2), as the validator did.
    "İİ",
    "İstanbul Works",
    "St. Mary's Works",
    "Straße Works",
  ];
  const rows = [];
  for (const name of names) {
    rows.push({ name, ...(await assetCodeFromLocation(name)) });
  }
  let sharedSlugPairs = 0;
  for (const [i, a] of rows.entries()) {
    for (const b of rows.slice(i + 1)) {
      if (a.slug === b.slug) {
        sharedSlugPairs += 1;
      }
      assert(
        (a.code === b.code) === (a.slug === b.slug),
        `two names share a code exactly when they share a slug: ${JSON.stringify(a.name)} ` +
          `(slug "${a.slug}", code "${a.code}") and ${JSON.stringify(b.name)} (slug "${b.slug}", code "${b.code}")`,
      );
    }
  }
  // Positive controls: the pool must exercise both halves of the "if and only
  // if", or the loop above passes on a pool where every slug differs (the
  // name-hashing producer) or where every code is one value.
  const plant1 = rows.filter((row) => row.slug === "plant-1");
  assert(
    plant1.length === 5 && sharedSlugPairs >= 10,
    `the five "Plant 1" spellings must derive one slug, or the shared-code half is untested: ` +
      `${plant1.length} rows, ${sharedSlugPairs} shared-slug pairs`,
  );
  const distinctSlugs = new Set(rows.map((row) => row.slug)).size;
  assert(
    distinctSlugs >= 5 && new Set(rows.map((row) => row.code)).size === distinctSlugs,
    `the pool must carry several distinct slugs, each with its own code: ${distinctSlugs} slugs`,
  );

  for (const constraint of ["assets_code_unique", "locations_slug_unique"]) {
    const mapped = COMMIT_UNIQUE_CONFLICTS.get(constraint);
    if (mapped === undefined) {
      throw new Error(`${constraint} must be translated, or a shared code is a 500`);
    }
    assert(
      mapped.message.length > 0,
      `${constraint} must carry an operator sentence, got ${JSON.stringify(mapped.message)}`,
    );
  }
}
