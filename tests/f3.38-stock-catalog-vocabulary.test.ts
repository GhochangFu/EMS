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
 * in migration `0051`; the point side has one in the `*_POINT_KEYS` arrays that
 * `packages/db/src/point-keys-seed.ts` builds `bms.point_keys` from. Checking
 * one and not the other leaves half the binding free to drift.
 */
const STOCK_REL = "apps/api/src/admin/dashboard-templates/stock-catalog.ts";
const CONSTANTS_REL = "packages/shared/src/constants.ts";
const ROLES_MIGRATION_REL = "packages/db/drizzle/0051_asset_role_vocabulary.sql";

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
 * builds `ESKOM_CATALOG` and `PHE_CATALOG` from exactly these arrays, so a key
 * in this set is a key an organization's catalog can hold, and a key outside it
 * is one no organization can ever hold.
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

/** The 26 role codes migration `0051` seeds into `bms.asset_roles`. */
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
  const stock = read(STOCK_REL);
  const vocabulary = pointKeyVocabulary(read(CONSTANTS_REL));
  const roles = roleVocabulary(sqlOnly(read(ROLES_MIGRATION_REL)));
  const { pointKeys, roleCodes } = scanCatalog(stock);

  /**
   * Anti-vacuity, and it is not decoration.
   *
   * Every assertion below is "no member of a scanned set is bad". A regex that
   * silently stops matching turns all of them green, which is exactly the shape
   * of failure this file was written to end. These four numbers are lower
   * bounds read off the catalog as it stands, so they survive an author adding
   * a template and fail loudly if the scan goes blind.
   */
  it("the scan actually found the catalog", () => {
    expect(pointKeys.length, `no pointKey found in ${STOCK_REL} — the scan is blind`).toBeGreaterThanOrEqual(12);
    expect(roleCodes.length, `no assetRoleCode found in ${STOCK_REL} — the scan is blind`).toBeGreaterThanOrEqual(12);
    expect(
      new Set(pointKeys.map((entry) => entry.section)).size,
      "every pointKey was attributed to one section — the section tracker is broken",
    ).toBeGreaterThanOrEqual(4);
    expect(vocabulary.size, `no *_POINT_KEYS array parsed out of ${CONSTANTS_REL}`).toBeGreaterThanOrEqual(30);
    // 26 is migration `0051`'s seeded count, and that migration is frozen, so
    // this number is stable by construction. If a LATER migration adds a role
    // code and the check below starts rejecting a legitimate `assetRoleCode`,
    // the fix is to read that migration here too — never to loosen this
    // assertion, which is the anti-vacuity control for the whole role scan.
    expect(roles.size, `no role codes parsed out of ${ROLES_MIGRATION_REL}`).toBe(26);
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
      `${STOCK_REL} binds a pointKey that exists in no *_POINT_KEYS array, so ` +
        "bms.point_keys can never hold it and no asset can ever register it. The " +
        "resolver matches `${assetId}::${pointKey}` exactly: a camelCase key never " +
        "finds its snake_case row, and the widget reports `unresolved` with nothing " +
        "naming the cause. Spell the key the way packages/shared/src/constants.ts " +
        "spells it.",
    ).toEqual([]);
  });

  it("every stock assetRoleCode is a code migration 0051 seeds", () => {
    const unknown = roleCodes
      .filter((entry) => !roles.has(entry.value))
      .map((entry) => `${entry.section} → ${entry.value}`);

    expect(
      [...new Set(unknown)].sort(),
      `${STOCK_REL} binds an assetRoleCode that is not one of the 26 rows in ` +
        `${ROLES_MIGRATION_REL}. bms.asset_group_members.role carries a foreign key to ` +
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
      `${STOCK_REL} still labels a widget "TR" (tons of refrigeration). The chiller ` +
        "widgets now bind cooling_kw, whose unit is kW.",
    ).toBe(false);

    const percentUnitOnKw = /pointKey:\s*"kw"[\s\S]{0,400}?unit:\s*"%"/.test(stock);
    expect(
      percentUnitOnKw,
      `${STOCK_REL} binds kw under a "%" unit. loadPercent was rebound to kw because ` +
        "no seeded electrical asset registers load_pct; the transformer tile therefore " +
        "reads kW, not a percentage.",
    ).toBe(false);
  });
});
