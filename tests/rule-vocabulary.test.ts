import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const require_ = createRequire(import.meta.url);

/**
 * `F4.43` — a rule's `category` has two vocabularies, and they must stay
 * related in one direction only.
 *
 * - **authorable** — `authorableRuleCategorySchema`, four values. What an
 *   operator may create, and what ADR 0019 §3 binds template `content.alarms`
 *   to.
 * - **readable** — `automationRuleCategorySchema`, five. What the API may
 *   *return*, including `electrical`, which
 *   `packages/db/drizzle/0022_phe_alarm_threshold_rules.sql` writes directly
 *   for the PHE pilot's 48 rules, bypassing the API as a migration may.
 *
 * ## What is NOT tested here, and why
 *
 * **That readable ⊇ authorable.** It holds *by construction* — the read enum is
 * built from `authorableRuleCategorySchema.options` plus `electrical` — so an
 * assertion would be a tautology, and a tautology that once had meaning is the
 * hardest kind of dead guard to notice later (AGENTS.md §4.4). Making it
 * impossible beat testing that it had not happened.
 *
 * What remains testable is everything that is *not* structural: that nobody
 * restates a vocabulary instead of importing it, and that the two values which
 * started this item are still described.
 *
 * ## The history worth keeping
 *
 * `electrical` sat in the database and outside the read union for as long as
 * migration 0022 had been deployed. 48 of 89 rules rendered with an empty,
 * unstyled badge and could not be filtered to, because `categoryStyle`'s
 * exhaustive `switch` returned `undefined` for a value the type system said
 * could not occur. Nothing noticed until `F4.23` put a response validator on
 * the boundary. Neither column has a `CHECK` constraint — that was scoped out
 * as its own ADR — so the validator and these rules are the whole of the
 * enforcement today.
 */
describe("F4.43 rule vocabularies", () => {
  const contracts = require_("@bms/shared/contracts") as {
    authorableRuleCategorySchema: { options: readonly string[] };
    automationRuleCategorySchema: { options: readonly string[] };
    ruleListItemSchema: { shape: { source: { options: readonly string[] } } };
  };

  it("declares each vocabulary once, and never restates one", () => {
    // `rules.schema.ts` used to declare its own copy of the four values while
    // `packages/shared` needed the same list to type a template alarm — two
    // copies of one vocabulary, in a file whose own comment says "a copied
    // enum is a copy that drifts". It now re-exports the shared schema.
    //
    // A source scan rather than a value comparison, deliberately: comparing
    // the values would pass just as happily if someone re-inlined the literal
    // and kept it in sync *today*, which is the state that drifts tomorrow.
    const source = readFileSync(
      join(repoRoot, "apps", "api", "src", "rules", "rules.schema.ts"),
      "utf8",
    );

    const declaresOwnCategoryEnum =
      /export const categorySchema\s*=\s*z\.enum\(/.test(source);

    expect(
      declaresOwnCategoryEnum,
      "apps/api/src/rules/rules.schema.ts declares its own category enum again.\n\n" +
        "It must re-export `authorableRuleCategorySchema` from `@bms/shared` instead. " +
        "Two declarations of one vocabulary is what F4.43 removed, and the file's own " +
        "comment gives the reason: a copied enum is a copy that drifts.",
    ).toBe(false);

    // …and the re-export must actually be the shared one.
    expect(source).toMatch(/categorySchema\s*=\s*authorableRuleCategorySchema/);
  });

  it("still describes what migration 0022 actually writes", () => {
    // Pinned by name rather than by count: a count stays green while
    // `electrical` is swapped for something else.
    expect([...contracts.automationRuleCategorySchema.options]).toContain("electrical");

    const sources = [...contracts.ruleListItemSchema.shape.source.options];
    expect(sources).toContain("phe_alarm_seed");

    // `phe_alarm_seed` is load-bearing, not decorative: migration 0022 uses it
    // as its own idempotency key (`WHERE r.source = 'phe_alarm_seed'`), so a
    // rename would make the migration re-insert on the next run.
    const migration = readFileSync(
      join(repoRoot, "packages", "db", "drizzle", "0022_phe_alarm_threshold_rules.sql"),
      "utf8",
    );
    expect(migration).toContain("phe_alarm_seed");
  });

  it("keeps `electrical` out of what an operator can author", () => {
    // The asymmetry is the point of the item. If this ever fails, someone has
    // widened the WRITE vocabulary — which is a real decision with ADR 0019 §3
    // in its blast radius, not a tidy-up.
    expect([...contracts.authorableRuleCategorySchema.options]).not.toContain("electrical");
    expect([...contracts.authorableRuleCategorySchema.options]).toHaveLength(4);
  });
});
