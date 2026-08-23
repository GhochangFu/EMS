import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skipDirs = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The 2026-08-23 `alarm-enrichment.integration.test.ts` flake, stated as the
 * class rather than the instance.
 *
 * A suite that isolates with `tx.rollback()` never commits, so every row it
 * needs it must build inside its own transaction. Reading one off the seed
 * instead breaks that isolation in one direction: the row belongs to no
 * transaction of this suite's, and another suite may delete it mid-test.
 *
 * `bms.assets` is where this bites. Seven suites commit prefixed fixture assets
 * in `beforeAll` and delete them in `afterAll`, which leaves free line pointers
 * at the head of page 0 — measured on a developer database, the first *seeded*
 * row sat at `ctid (0,42)`, so an inserted row can land at `(0,1)` and win an
 * unordered `LIMIT 1` ahead of all 148 seeded rows. Whether it does depends on
 * the free-space map, which is what makes the failure intermittent. Three
 * suites resolved their fixture that way and were flaky under a full parallel
 * run. The
 * mechanism, the measurement and the deterministic two-connection reproduction
 * are recorded in `apps/api/src/testing/integration-fixtures.ts`.
 *
 * **CI cannot catch this and never will** — AGENTS.md §4.6's asymmetry, in the
 * direction that trains people to re-run rather than read. The failure needs
 * two suites overlapping on one database, and it is a race even then: the
 * observed rate was two tests in one run of 628, with the next identical run
 * green. A suite cannot gate a race it usually wins. A source scan can, so this
 * is a static invariant rather than a test.
 *
 * Stated as "must not read the table", not "must order the read", because
 * `ORDER BY` narrows the window and does not close it. Nothing stops a foreign
 * fixture from sorting first. Today every fixture prefix in the tree (`F18-`,
 * `F19-`, `F22-`, `F24-`, `F26-`) happens to sort after the lowest seeded code
 * (`CH-CRAC-101`), which is what makes the ordered reads in the committed-
 * fixture suites safe — but that is a convention holding, not a constraint.
 *
 * **What this does not catch**, said here rather than discovered later: the scan
 * is line-by-line, so a raw query whose `FROM` and `bms.assets` fall on
 * different lines slips through, as does Drizzle's relational API
 * (`db.query.assets.findFirst()`). Neither form appears in the tree today, and
 * both would be the same defect. The keying on `tx.rollback()` is likewise a
 * proxy for the isolation style, not a proof of it.
 */
describe("integration fixture isolation", () => {
  it("no rollback-isolated spec resolves a fixture from bms.assets", () => {
    // Both spellings of the read: the Drizzle builder and raw SQL. Writes are
    // not the defect — `.insert(assets)` inside the transaction is the fix.
    const readsAssets = /\.from\(\s*assets\s*\)|FROM\s+bms\.assets\b/i;

    const specs = ["apps", "packages"]
      .flatMap((root) => {
        try {
          return walk(join(repoRoot, root));
        } catch {
          return [];
        }
      })
      .filter((f) => /\.spec\.tsx?$/.test(f));

    // `tx.rollback()` is the marker for the isolation style this rule is about.
    // A committed-fixture suite (its own prefix, `beforeAll`/`afterAll` cleanup)
    // reads `bms.assets` legitimately and is out of scope here.
    const rollbackSpecs = specs.filter((f) => readFileSync(f, "utf8").includes("tx.rollback()"));

    // An empty offender list is the passing state, so on its own it does not
    // distinguish "scanned everything, found nothing" from "scanned nothing".
    // Four such suites exist as of this commit; the floor is far below any
    // plausible count and far above zero.
    expect(
      rollbackSpecs.length,
      "no rollback-isolated spec was found. Either the walk or the `tx.rollback()` marker " +
        "is broken, and the empty offender list below would mean nothing.",
    ).toBeGreaterThanOrEqual(4);

    const offenders: string[] = [];
    for (const file of rollbackSpecs) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      for (const [index, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
        // Prose about the rule is not the rule being broken — all three fixed
        // suites quote the old query in their header comment.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (readsAssets.test(line)) {
          offenders.push(`${rel}:${index + 1} — ${line.trim()}`);
        }
      }
    }

    expect(
      offenders,
      `a rollback-isolated spec reads bms.assets:\n${offenders.join("\n")}\n\n` +
        "A suite that ends every assertion with tx.rollback() must build its own assets " +
        "inside that transaction — createFixtureAssets() in " +
        "apps/api/src/testing/integration-fixtures.ts. A row read off the seed belongs to no " +
        "transaction of yours, and the suites that commit prefixed fixture assets delete them " +
        "again while this one is still running.",
    ).toEqual([]);
  });

  it("the read patterns still match the query shapes they forbid", () => {
    // A regex that silently stops matching turns this whole file into a green
    // no-op. These are the two forms the three suites actually used.
    const readsAssets = /\.from\(\s*assets\s*\)|FROM\s+bms\.assets\b/i;
    expect(readsAssets.test("await db.select({ id: assets.id }).from(assets).limit(1)")).toBe(true);
    expect(readsAssets.test("pool.query(`SELECT id FROM bms.assets ORDER BY code LIMIT 1`)")).toBe(
      true,
    );
    // The fix must not be flagged as the defect.
    expect(readsAssets.test("await db.insert(assets).values(rows).returning({ id: assets.id })")).toBe(
      false,
    );
  });
});
