import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.38` — the stock dashboard template catalog must bind names that **exist**.
 *
 * **This file exists because F3.36 shipped a catalog that could never resolve.**
 * All eight `pointKey` values in `STOCK_DASHBOARD_TEMPLATE_CATALOG` were
 * camelCase invented at authoring time — `kW`, `loadPercent`, `flowRate`, `pH`,
 * `cod`, `dissolvedOxygen`, `supplyAirTemp`, `tons` — and **not one of them
 * matched a row in `bms.point_keys`**, whose codes are snake_case (`kw`,
 * `load_pct`, `supply_air_temp_c`). The resolver looks up
 * `` `${assetId}::${pointKey}` `` in a `Map`, so `kW` never finds `kw`; every
 * bound widget of every one of the six stock templates reported `unresolved`,
 * for every organization, from the day the catalog landed.
 *
 * **Why the F3.36 suite did not catch it.** Its instantiate integration spec
 * builds its own assets, its own points and its own template, so it asserts
 * that the resolver resolves what the *fixture* declares. Nothing compared the
 * shipped catalog against the shipped vocabulary. That comparison is static —
 * both sides are repository source — so it belongs here, in the `tests/`
 * carve-out §4.6 keeps for repo-wide invariants, next to
 * `tests/f3.37-asset-role-vocabulary.test.ts` which guards the other half of
 * the same binding.
 *
 * **What this file does NOT prove, and the limit matters.** It proves a key
 * *exists in the vocabulary*, not that any asset *registers* it. Those are
 * different questions and the second one is where the remaining gaps live:
 * `cooling_kw` is a real HVAC code that no seeded asset carries, so the chiller
 * widgets still resolve nothing. A rename of a seeded key, or a change to
 * `demoRoleForAsset`, would return the feature to zero bound widgets and pass
 * every assertion here. Only instantiating against real data answers that, and
 * a source scan cannot — do not read a green run as "the templates bind".
 *
 * **The two halves of a binding, and both are checked.** A binding names an
 * `assetRoleCode` and a `pointKey`. The role side has a closed source of truth
 * in the migrations `ROLE_MIGRATION_RELS` names — `0051` and, since `F3.40`,
 * `0060`; the point side has one in the `*_POINT_KEYS` arrays that
 * `packages/db/src/point-keys-seed.ts` builds `bms.point_keys` from. Checking
 * one and not the other leaves half the binding free to drift.
 */
/**
 * **EVERY file the stock catalog is spread across, not just the first.**
 *
 * The catalog was one file until it reached AGENTS.md §4.5's 1000-line cap and
 * split; `stock-catalog.ts` now spreads `ELECTRICAL_STOCK_TEMPLATES` from
 * `stock-catalog-electrical.ts`. This scan reads the files as TEXT, so it
 * cannot follow that spread — a half left out of this list has its `pointKey`
 * and `assetRoleCode` values checked against no vocabulary at all, and every
 * assertion below stays green while checking less.
 *
 * **A THIRD FILE BELONGS HERE THE DAY THE CATALOG GAINS ONE**, and the
 * anti-vacuity lower bounds move with it. This is the same instruction
 * `ROLE_MIGRATION_RELS` below carries for its own second file, and for the same
 * reason.
 */
const STOCK_RELS = [
  "apps/api/src/admin/dashboard-templates/stock-catalog.ts",
  "apps/api/src/admin/dashboard-templates/stock-catalog-electrical.ts",
] as const;

/** The files as one list, for an assertion message. */
const STOCK_LABEL = STOCK_RELS.join(" + ");
const CONSTANTS_REL = "packages/shared/src/constants.ts";
/**
 * EVERY migration that seeds `bms.asset_roles`, in application order, not just
 * the first.
 *
 * `F3.40` added the second. The comment on the count assertion below already
 * named this as the correct fix — *"If a LATER migration adds a role code and
 * the check below starts rejecting a legitimate `assetRoleCode`, the fix is to
 * read that migration here too — never to loosen this assertion"* — and this is
 * that fix, made when the second migration landed rather than when a binding
 * first failed.
 *
 * A THIRD ENTRY BELONGS HERE THE DAY A THIRD MIGRATION SEEDS A ROLE, and the
 * total below moves with it. That total is exact on purpose: it is the
 * anti-vacuity control for the whole role scan, and `toBeGreaterThanOrEqual`
 * would let the parser go blind on one file while the other kept it green.
 *
 * `0060` onward may also be *edited* by `POST /api/v1/admin/vocabularies/asset-roles`
 * at runtime, which no source scan can see. That is stated rather than guarded:
 * this file checks that the catalog binds codes the REPOSITORY seeds, which is
 * what a fresh database holds, and a code added through the API is by
 * construction a code someone chose deliberately.
 */
const ROLE_MIGRATION_RELS = [
  "packages/db/drizzle/0051_asset_role_vocabulary.sql",
  "packages/db/drizzle/0060_asset_role_estate_shapes.sql",
] as const;

/** The seeded role codes, spelled as one list for an assertion message. */
const ROLE_MIGRATIONS_LABEL = ROLE_MIGRATION_RELS.join(" + ");

/**
 * Comments stripped before any assertion reads the SQL — the `f3.1a` lesson
 * that `tests/f3.37-asset-role-vocabulary.test.ts` records: a header comment
 * quoting an `INSERT` kept a `toContain` green after the statement itself was
 * deleted.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/**
 * Every code the point-key catalog can seed.
 *
 * Read from the `*_POINT_KEYS` arrays rather than listed here, because listing
 * them would be the copy this file exists to prevent. `point-keys-seed.ts`
 * builds `GLOBAL_CATALOG` from exactly these arrays, so a key in this set is a
 * key the catalog can hold, and a key outside it is one nothing can seed.
 *
 * **`F3.39` replaced the two per-organization lists this paragraph used to
 * name.** The set of codes did not move — `GLOBAL_CATALOG` is the union, and the
 * union was already exactly what the larger of the two held — but there is no
 * per-organization catalog any more, so "a key an organization's catalog can
 * hold" named a distinction that no longer exists. A code is held once, for the
 * whole fleet, or not at all.
 */
const pointKeyVocabulary = (source: string): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const block of source.matchAll(/export const [A-Z_]*POINT_KEYS = \[([^\]]*)\]/g)) {
    for (const literal of block[1]!.matchAll(/"([a-z0-9_]+)"/g)) {
      keys.add(literal[1]!);
    }
  }
  return keys;
};

/**
 * The role codes the repository seeds into `bms.asset_roles` — 26 from `0051`
 * and 2 from `0060`.
 *
 * Takes the migrations already concatenated, so one regex serves however many
 * files `ROLE_MIGRATION_RELS` names. Both share the shape the regex matches:
 * `code` is the first quoted string of each parenthesised row.
 */
const roleVocabulary = (sql: string): ReadonlySet<string> => {
  const codes = new Set<string>();
  for (const row of sql.matchAll(/\('([a-z][a-z-]*)',\s*'/g)) {
    codes.add(row[1]!);
  }
  return codes;
};

type StockReference = { readonly section: string; readonly value: string };

/**
 * Every `pointKey` and every `assetRoleCode` in the catalog, each tagged with
 * the section whose template holds it.
 *
 * The two are collected independently rather than paired, because membership is
 * what is asserted and a binding's two halves are checked against two different
 * vocabularies. Tagging by section is what makes a failure message name the
 * template an author has to open.
 */
const scanCatalog = (
  source: string,
): { readonly pointKeys: StockReference[]; readonly roleCodes: StockReference[] } => {
  const pointKeys: StockReference[] = [];
  const roleCodes: StockReference[] = [];
  let section = "<before the first section>";
  for (const line of source.split("\n")) {
    const sectionMatch = /^\s*section:\s*"([a-z-]+)"/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!;
      continue;
    }
    for (const match of line.matchAll(/\bpointKey:\s*"([^"]+)"/g)) {
      pointKeys.push({ section, value: match[1]! });
    }
    for (const match of line.matchAll(/\bassetRoleCode:\s*"([^"]+)"/g)) {
      roleCodes.push({ section, value: match[1]! });
    }
  }
  return { pointKeys, roleCodes };
};

/**
 * ---------------------------------------------------------------------------
 * THE ONE EXCEPTION, AND IT IS WRITTEN TO CLEAR ITSELF.
 * ---------------------------------------------------------------------------
 *
 * Four process-chemistry keys have **no vocabulary to be in**, and that is a
 * different fault from the camelCase one. `point-keys-seed.ts` builds its
 * catalogs from the electrical, HVAC, UPS, IT and environment key sets only;
 * there is no water or process key set at all, `bms.asset_domains` carries no
 * `stp` or `etp` code, and no seeded asset carries a `water` domain. So the
 * water, STP and ETP templates cannot be made to resolve by renaming anything —
 * they are waiting on a vocabulary decision that is the owner's §10 gate, not a
 * defect fix.
 *
 * They are still renamed to snake_case here, so that the day that vocabulary
 * lands the catalog already spells its keys the way every real code is spelled.
 *
 * **`stillOutside` below is what makes this list temporary.** The moment one of
 * these four appears in the vocabulary, its test fails and tells the author to
 * delete the entry. An allowlist without that check is a permanent one that
 * nobody revisits.
 */
const KEYS_AWAITING_A_VOCABULARY: readonly string[] = [
  "flow_rate",
  "ph",
  "cod",
  "dissolved_oxygen",
];

describe("F3.38 the stock template catalog binds names that exist", () => {
  const stockSources = STOCK_RELS.map((rel) => read(rel));
  /** The catalog as one blob, for the two whole-text unit checks at the end. */
  const stock = stockSources.join("\n");
  const vocabulary = pointKeyVocabulary(read(CONSTANTS_REL));
  const roles = roleVocabulary(
    ROLE_MIGRATION_RELS.map((rel) => sqlOnly(read(rel))).join("\n"),
  );
  // **Scanned per file, not over the joined blob.** `scanCatalog` tracks the
  // current `section:` line by line and carries it forward, so concatenating
  // would attribute the second file's opening lines to whatever section the
  // first file happened to end on. That would not fail anything — it would
  // just name the wrong template in a failure message, which is the one thing
  // this section tagging exists to get right.
  const scans = stockSources.map((source) => scanCatalog(source));
  const pointKeys = scans.flatMap((scan) => scan.pointKeys);
  const roleCodes = scans.flatMap((scan) => scan.roleCodes);

  /**
   * Anti-vacuity, and it is not decoration.
   *
   * Every assertion below is "no member of a scanned set is bad". A regex that
   * silently stops matching turns all of them green, which is exactly the shape
   * of failure this file was written to end. These four numbers are lower
   * bounds read off the catalog as it stands, so they survive an author adding
   * a template and fail loudly if the scan goes blind.
   *
   * **`F3.41` moved all four to the new actuals rather than leaving the slack.**
   * The catalog gained `electrical-metered-pumping` (8 bindings) and split
   * across two files, and `constants.ts` gained
   * `METERED_PUMPING_POINT_KEYS`'s 12 codes. Left at 12/12/4/30 every one of
   * them would have stayed green with the SECOND catalog file parsed as
   * nothing and the new array parsed as nothing — which is precisely the
   * "scan goes blind" failure they exist to catch, arriving in the same commit
   * that made it possible.
   */
  it("the scan actually found the catalog", () => {
    // 23 = 15 before + 8 in the new entry, over both files in `STOCK_RELS`.
    expect(pointKeys.length, `no pointKey found in ${STOCK_LABEL} — the scan is blind`).toBeGreaterThanOrEqual(23);
    expect(roleCodes.length, `no assetRoleCode found in ${STOCK_LABEL} — the scan is blind`).toBeGreaterThanOrEqual(23);
    // Five: electrical, water, stp, etp, hvac. `sustainability` holds no point
    // binding at all and must not — the assertion at the end of this file's
    // sibling spec is what keeps it that way.
    expect(
      new Set(pointKeys.map((entry) => entry.section)).size,
      "every pointKey was attributed to one section — the section tracker is broken",
    ).toBeGreaterThanOrEqual(5);
    // 289 = 191 before + `E5.1`'s 98-code `WATER_CLASS_POINT_KEYS`
    // (`docs/plans/e5.1-water-domain-pack.md` §4.4/§4.6). Moved to the actual
    // rather than left at 191, for the same reason `F3.41` moved this bound
    // from 30 — slack here would have stayed green with the 98 new codes
    // parsed as nothing at all.
    expect(vocabulary.size, `no *_POINT_KEYS array parsed out of ${CONSTANTS_REL}`).toBeGreaterThanOrEqual(289);
    // 28 is 26 from `0051` plus 2 from `0060`, and both migrations are frozen,
    // so this number is stable by construction. If a LATER migration adds a
    // role code and the check below starts rejecting a legitimate
    // `assetRoleCode`, the fix is to add that migration to
    // `ROLE_MIGRATION_RELS` and move this number with it — never to loosen
    // this assertion, which is the anti-vacuity control for the whole role
    // scan. `F3.40` is the first time that instruction was followed.
    expect(roles.size, `no role codes parsed out of ${ROLE_MIGRATIONS_LABEL}`).toBe(28);
  });

  /**
   * The defect itself. `kW` is not `kw`, and the resolver's `Map.get` is
   * case-sensitive, so the difference is invisible everywhere except in the
   * resolution report — which says `unresolved` and does not say why.
   */
  it("every stock pointKey is a code the point-key catalog can seed", () => {
    const awaiting = new Set(KEYS_AWAITING_A_VOCABULARY);
    const unknown = pointKeys
      .filter((entry) => !vocabulary.has(entry.value) && !awaiting.has(entry.value))
      .map((entry) => `${entry.section} → ${entry.value}`);

    expect(
      [...new Set(unknown)].sort(),
      `${STOCK_LABEL} binds a pointKey that exists in no *_POINT_KEYS array, so ` +
        "bms.point_keys can never hold it and no asset can ever register it. The " +
        "resolver matches `${assetId}::${pointKey}` exactly: a camelCase key never " +
        "finds its snake_case row, and the widget reports `unresolved` with nothing " +
        "naming the cause. Spell the key the way packages/shared/src/constants.ts " +
        "spells it.",
    ).toEqual([]);
  });

  it("every stock assetRoleCode is a code the role migrations seed", () => {
    const unknown = roleCodes
      .filter((entry) => !roles.has(entry.value))
      .map((entry) => `${entry.section} → ${entry.value}`);

    expect(
      [...new Set(unknown)].sort(),
      `${STOCK_LABEL} binds an assetRoleCode that is not one of the ${roles.size} rows in ` +
        `${ROLE_MIGRATIONS_LABEL}. bms.asset_group_members.role carries a foreign key to ` +
        "bms.asset_roles, so no membership can ever hold this code and the widget " +
        "resolves nothing.",
    ).toEqual([]);
  });

  /**
   * The exception list is temporary, and this is the clock on it.
   *
   * A key listed as "awaiting a vocabulary" that has since *joined* the
   * vocabulary is no longer an exception — it is an entry that now hides a real
   * check. Fail, and say so.
   */
  it("no key still on the awaiting-a-vocabulary list has since joined the vocabulary", () => {
    const stillOutside = KEYS_AWAITING_A_VOCABULARY.filter((key) => !vocabulary.has(key));

    expect(
      stillOutside,
      "a key on KEYS_AWAITING_A_VOCABULARY now exists in a *_POINT_KEYS array. The " +
        "water/process vocabulary it was waiting for has landed, so delete it from " +
        "that list — leaving it there exempts a key that the check above should now " +
        "be enforcing.",
    ).toEqual([...KEYS_AWAITING_A_VOCABULARY]);
  });

  /**
   * The renames are only half a fix if the label keeps the old unit.
   *
   * `tons` became `cooling_kw` and `loadPercent` became `kw`; both changed the
   * quantity being read, so both had to change their `config.unit`. A widget
   * showing a kW value under a `TR` label is the same class of silent-wrong as
   * `F4.43`'s `<select>` rendering its first option for an unknown value —
   * nothing errors, and the number is simply wrong.
   */
  it("no widget still advertises a unit its rebound key does not produce", () => {
    expect(
      stock.includes('unit: "TR"'),
      `${STOCK_LABEL} still labels a widget "TR" (tons of refrigeration). The chiller ` +
        "widgets now bind cooling_kw, whose unit is kW.",
    ).toBe(false);

    const percentUnitOnKw = /pointKey:\s*"kw"[\s\S]{0,400}?unit:\s*"%"/.test(stock);
    expect(
      percentUnitOnKw,
      `${STOCK_LABEL} binds kw under a "%" unit. loadPercent was rebound to kw because ` +
        "no seeded electrical asset registers load_pct; the transformer tile therefore " +
        "reads kW, not a percentage.",
    ).toBe(false);
  });
});
