import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const require_ = createRequire(import.meta.url);

/**
 * `F4.43` → `F4.45` — a rule's concern, the plant domain beside it, and the
 * rule that **neither is a hardcoded list any more** (ADR 0031 + Amendment 1).
 *
 * ## The history, which is the reason these tests exist
 *
 * `automation_rules.category` held two kinds of thing in one column.
 * `comfort`/`energy`/`safety`/`operations` are *concerns*. `electrical` is a
 * *plant domain*, written directly by
 * `packages/db/drizzle/0022_phe_alarm_threshold_rules.sql` on the PHE pilot's
 * 48 rules. Every defect here was a symptom of that overload:
 *
 * - 48 of 89 rules rendered with an **empty, unstyled** badge and could not be
 *   filtered to, because `categoryStyle`'s exhaustive `switch` returned
 *   `undefined` for a value the type system said could not occur. Nothing
 *   noticed until `F4.23` put a response validator on the boundary.
 * - `F4.43` widened the *read* union only, leaving a documented asymmetry.
 * - `F4.44` found the authoring surface still wrong: a `<select>` whose value
 *   matches no `<option>` renders its **first** option, so editing a PHE rule
 *   silently claimed `Operations`.
 * - `F4.45` split the axes and moved both vocabularies into tables, because the
 *   roadmap schedules three domain packs (`E5.1`, `E5.2`, `E5.3`) and a fixed
 *   list would have cost a migration and a deploy per sector.
 *
 * ## What is NOT tested here, and why
 *
 * **The vocabulary contents.** They are rows now — `bms.rule_categories` and
 * `bms.asset_domains` — so any list asserted here would be a copy of the seed,
 * i.e. exactly the duplication this item removed. `automation_rules_category_fk`
 * and `assets_domain_fk` are the enforcement.
 *
 * What remains checkable from the repo is the thing that actually regresses:
 * **that no surface reintroduces a hardcoded copy**, and that the migration
 * keys stay intact.
 */
describe("F4.45 rule vocabularies", () => {
  const contracts = require_("@bms/shared/contracts") as {
    badgeToneSchema: { options: readonly string[] };
    ruleListItemSchema: { shape: { source: { options: readonly string[] } } };
  };

  const migrationDir = join(repoRoot, "packages", "db", "drizzle");
  const migration0029 = readFileSync(
    join(migrationDir, "0029_rule_category_concern_asset_domain.sql"),
    "utf8",
  );

  it("keeps both vocabularies out of the code and in the database", () => {
    // The regression this guards is a *revert*: someone finding the fetch
    // inconvenient and pasting the four values back into a `z.enum`. That
    // compiles, passes every behavioural test, and quietly reintroduces the
    // deploy-per-sector cost ADR 0031 Amendment 1 removed.
    const operations = readFileSync(
      join(repoRoot, "packages", "shared", "src", "contracts", "operations.ts"),
      "utf8",
    );

    // Matched against the names that ACTUALLY exist, plus the ones a revert
    // would plausibly restore. The first version of this guard named
    // `assetDomainSchema` — a symbol that has never existed in this repo, and
    // not even a substring of the live `assetDomainCodeSchema` — so a real
    // revert would have walked straight through it. A guard that cannot match
    // its own subject is the §4.4 failure this file exists to prevent.
    const enumRevert =
      /\b(ruleCategoryCode|assetDomainCode|automationRuleCategory|assetDomain|authorableRuleCategory)Schema\s*=\s*z\.enum\(/;

    const offender = enumRevert.exec(operations);
    expect(
      offender?.[0],
      "packages/shared/src/contracts/operations.ts declares a vocabulary enum again.\n\n" +
        "Both vocabularies are rows (ADR 0031 Amendment 1) so that a domain pack " +
        "ships a sector with an INSERT rather than a migration and a deploy. " +
        "`E5.1`, `E5.2` and `E5.3` are all on the roadmap.",
    ).toBeUndefined();

    // Anti-vacuity: prove the pattern can fire, so a future rename of the
    // symbols cannot silently turn this assertion into a no-op.
    expect(
      enumRevert.test('export const assetDomainCodeSchema = z.enum(["electrical"]);'),
      "the revert pattern no longer matches a reverted declaration — update it",
    ).toBe(true);

    // The tables must actually exist, or the above passes vacuously.
    expect(migration0029).toMatch(/CREATE TABLE IF NOT EXISTS bms\.rule_categories/);
    expect(migration0029).toMatch(/CREATE TABLE IF NOT EXISTS bms\.asset_domains/);
  });

  it("closes both columns with a foreign key, not a CHECK", () => {
    // A CHECK would have been the tempting shape and is the one this migration
    // was first written with. The FK is what makes the vocabulary extensible
    // *without* making it unenforced — the distinction worth pinning, because
    // "make it dynamic" is very easily read as "drop the constraint".
    for (const constraint of [
      "automation_rules_category_fk",
      "assets_domain_fk",
      "asset_templates_domain_fk",
    ]) {
      expect(migration0029, `${constraint} is missing from migration 0029`).toContain(
        constraint,
      );
    }

    expect(
      /CHECK \(category IN/.test(migration0029) || /CHECK \(domain IN/.test(migration0029),
      "migration 0029 constrains a vocabulary with a CHECK. That freezes the value " +
        "set in DDL, which is what Amendment 1 replaced: adding a sector must be an " +
        "INSERT. The tone CHECK is the deliberate exception — tone is presentation, " +
        "owned by the frontend, and genuinely closed.",
    ).toBe(false);

    // The one CHECK that should be there.
    expect(migration0029).toContain("rule_categories_tone_check");
  });

  it("migrates the 48 PHE rows before constraining, keyed on a constant", () => {
    // Order is load-bearing and cannot be checked any other way from here:
    // drizzle wraps the run in one transaction, so the FK must come after both
    // the seed and the UPDATE or the whole migration aborts.
    const seedAt = migration0029.indexOf("INSERT INTO bms.rule_categories");
    const updateAt = migration0029.indexOf("UPDATE bms.automation_rules");
    const fkAt = migration0029.indexOf("automation_rules_category_fk");

    expect(seedAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(seedAt);
    expect(fkAt).toBeGreaterThan(updateAt);

    // AGENTS.md §4.4: the UPDATE filters on a constant, never a join or
    // subquery, so it touches exactly the rows migration 0022 wrote.
    expect(migration0029).toMatch(/WHERE source = 'phe_alarm_seed'/);
    expect(migration0029).toMatch(/AND category = 'electrical'/);
  });

  it("still describes what migration 0022 actually writes", () => {
    // `phe_alarm_seed` is load-bearing in two migrations now: 0022 uses it as
    // its own idempotency key, and 0029 uses it as the constant selecting the
    // 48 rows to reclassify. A rename breaks both — 0022 would re-insert on a
    // fresh database, and 0029 would migrate nothing and then fail its own FK.
    expect([...contracts.ruleListItemSchema.shape.source.options]).toContain(
      "phe_alarm_seed",
    );

    for (const file of [
      "0022_phe_alarm_threshold_rules.sql",
      "0029_rule_category_concern_asset_domain.sql",
    ]) {
      expect(
        readFileSync(join(migrationDir, file), "utf8"),
        `${file} no longer keys on phe_alarm_seed`,
      ).toContain("phe_alarm_seed");
    }
  });

  it("renders every control's options from the fetched vocabulary", () => {
    // `F4.44`, generalised. A `<select>` whose value matches no `<option>`
    // renders its FIRST option rather than a blank, so a hand-kept list falling
    // behind does not look like a bug — it looks like a different value.
    // Measured on the running stack before that fix: the DOM read `operations`
    // while React's state held `electrical`.
    //
    // Scoped to the construct rather than to a token appearing anywhere in the
    // file (AGENTS.md §4.4): a vocabulary code inside an `<option value="…">`
    // in these files has no legitimate form.
    const surfaces = [
      {
        path: join(repoRoot, "apps", "web", "src", "components", "rule-builder-panel.tsx"),
        source: "ruleCategories.map(",
      },
      {
        path: join(repoRoot, "apps", "web", "src", "pages", "admin", "assets-page.tsx"),
        source: "assetDomains.map(",
      },
    ];

    // Seeded codes, read from the migration rather than restated here, so this
    // covers whatever the seed actually contains.
    //
    // Scoped to the two vocabulary INSERT statements. A blanket scan of the
    // whole file also picks up the `tone` column — and `critical` is both a
    // tone and a rule *severity*, whose legitimate `<option value="critical">`
    // then reads as a hardcoded vocabulary. The first assertion this test ever
    // made was that false positive.
    const seededCodes = (table: string): string[] => {
      const from = migration0029.indexOf(`INSERT INTO bms.${table}`);
      expect(from, `no seed INSERT for bms.${table}`).toBeGreaterThan(-1);
      const statement = migration0029.slice(from, migration0029.indexOf(";", from));
      return [...statement.matchAll(/\(\s*'([a-z_]+)'/g)].map((match) => match[1]);
    };

    const seeded = [...seededCodes("rule_categories"), ...seededCodes("asset_domains")];

    expect(seeded).toContain("safety");
    expect(seeded).toContain("electrical");
    expect(seeded.length).toBeGreaterThanOrEqual(8);

    for (const surface of surfaces) {
      const source = readFileSync(surface.path, "utf8");

      for (const code of seeded) {
        expect(
          new RegExp(`<option[^>]*value=["']${code}["']`).test(source),
          `${surface.path} hardcodes <option value="${code}">. Render the options ` +
            "from the `vocabularies` query instead — a hand-kept copy that falls " +
            "behind does not render as broken, it renders as the wrong value (F4.44).",
        ).toBe(false);
      }

      expect(source, `${surface.path} no longer maps the fetched vocabulary`).toContain(
        surface.source,
      );
    }
  });

  it("styles badges by tone, which is the only closed vocabulary left", () => {
    // `categoryStyle` was an exhaustive `switch` over the category union, and
    // its own comment said to keep it exhaustive because F4.43 was exactly what
    // a non-exhaustive one did. With the vocabulary open it *cannot* be
    // exhaustive — so exhaustiveness moved to tone, which is closed and pinned
    // by `rule_categories_tone_check`.
    const panel = readFileSync(
      join(repoRoot, "apps", "web", "src", "components", "rules-panel.tsx"),
      "utf8",
    );

    expect(
      /function categoryStyle/.test(panel),
      "rules-panel.tsx declares `categoryStyle` again. A switch over an open " +
        "vocabulary cannot be exhaustive; style by `tone` via `toneClass` instead.",
    ).toBe(false);

    expect(panel).toMatch(/toneClass\(/);
    expect([...contracts.badgeToneSchema.options].length).toBeGreaterThanOrEqual(5);
  });
});

/**
 * `F4.46` — a rule may carry **no** severity, and the builder has to be able to
 * say so without handing out "none" as a fresh choice on rules that feed the
 * alarm engine.
 *
 * This lives in `tests/` rather than beside the component because the decision
 * it guards is in JSX, and `apps/web/vitest.config.ts` includes `src/lib/**`
 * only: the predicate's own cases run there, but nothing runs the *wiring*.
 * Reverting the panel to an unconditional `<option value="">` — the state this
 * branch shipped for most of its life — left every other test green.
 *
 * Scoped to the construct, not to the symbol (AGENTS.md §4.4 and the `F4.38`
 * decoy): `offersNoSeverityOption` and `severityFromRule` each appear more than
 * once in this file, so "does the name occur" would pass on a panel whose
 * option is no longer gated at all.
 */
describe("F4.46 no-severity affordance", () => {
  const panel = readFileSync(
    join(repoRoot, "apps", "web", "src", "components", "rule-builder-panel.tsx"),
    "utf8",
  );

  it("gates the None option on the predicate rather than rendering it always", () => {
    expect(
      /offersNoSeverityOption\(\s*form\.ruleType,\s*form\.severity\s*\)\s*&&\s*\(?\s*<option value="">/.test(
        panel,
      ),
      'rule-builder-panel.tsx renders <option value=""> without gating it on ' +
        "`offersNoSeverityOption(form.ruleType, form.severity)`. Offering `None` on " +
        "every rule makes clearing a threshold rule's severity newly authorable, " +
        "which is product scope (§10) and not what F4.46 fixed.",
    ).toBe(true);

    // ...and exactly once, so the gated form cannot sit beside an ungated one.
    // Scoped to the None option: the panel's other two `<option value="">` are
    // the "Select asset" / "Select point" placeholders, which are a different
    // construct and legitimately unconditional.
    expect([...panel.matchAll(/<option value="">None<\/option>/g)]).toHaveLength(1);
  });

  it("narrows the stored severity instead of substituting one", () => {
    // The defect itself: a local narrowing that answered `"warning"` for a row
    // that had no severity, so opening such a rule and pressing Save gave it
    // one. The replacement is imported, so the panel must not declare its own.
    expect(
      /function normalizeSeverity/.test(panel),
      "rule-builder-panel.tsx declares `normalizeSeverity` again. Narrowing a " +
        "stored severity belongs in `lib/rule-severity.ts`, where it is under test.",
    ).toBe(false);

    expect(panel).toMatch(/severityFromRule\(rule\.severity\)/);
  });
});
