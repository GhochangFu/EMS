import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// The source scan the reading rules share. It lived in this file until a second
// reading rule needed it; it is a module now so both use one scanner rather than
// two that can drift apart, and so this file stays under the AGENTS.md §4.5
// length limit. `tests/support/` holds no `.test.ts`, so Vitest does not collect
// it, and it is typechecked as an import of this file.
import {
  READS_ASSETS_TABLE,
  repoRoot,
  specsReadingAssets,
  stringLiterals,
  walk,
  withoutComments,
} from "./support/source-scan";

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

/**
 * The 2026-08-24 `asset-templates.lifecycle.integration.test.ts` flake, stated
 * as the class rather than the instance — the *committed*-fixture counterpart
 * of the rule above.
 *
 * A committed-fixture suite writes rows outside any transaction and sweeps them
 * with `DELETE … WHERE code LIKE 'PREFIX%'` in `beforeAll`/`afterAll`. That is
 * correct against every *other* suite, because the prefixes are distinct. It is
 * not correct against **itself**: two instances of one file on one database
 * delete each other's committed rows, and neither is doing anything wrong.
 *
 * Two instances is not an exotic state. This repository works in git worktrees
 * that share one compose Postgres; `pnpm test:watch` in one terminal overlaps
 * `pnpm test` in another; a worker that hangs past its run outlives it and then
 * runs its `afterAll`. Reproduced deterministically for `F2.1` by running the
 * one file twice at once: `ConflictException: … already has an open draft`,
 * `expected 2 points, got 0`, `expected a rejection, but the call succeeded`,
 * and downstream `TypeError: Cannot read properties of undefined (reading
 * 'id')` — none of which name the collision.
 *
 * The rule is the same one `integration-fixtures.ts` states for the rollback
 * suites: **do not share the row.** A per-run suffix on the prefix is what makes
 * a concurrent instance invisible instead of hostile, and it is the only remedy
 * that closes the race rather than narrowing it — ordering cannot help, and a
 * retry re-runs the same collision.
 *
 * **The rule reads the `DELETE` itself, not the file.** An earlier draft keyed
 * on `randomUUID(` appearing anywhere in the source. Three of four mutations
 * survived that — including widening `cleanup()` back to the family prefix while
 * leaving the per-run constant in place, which is the defect itself. §4.6
 * (`F4.38`) forbids exactly that shape: never "does this token appear anywhere in
 * the file". So each statement is examined on its own terms below, and
 * `the analysis kills the mutation it exists to catch` restores all four.
 *
 * **What this still does not catch**, said here rather than discovered later:
 * the identifier in the `LIKE` argument is traced to a `const` in the same file
 * by regex. An alias (`const P = TEST_CODE;`), a prefix imported from another
 * module, or a `LIKE` argument built at run time reads as non-unique and is
 * flagged — fail-closed, which is the right direction, but it means the fix for
 * a flagged file is sometimes to inline rather than to change behaviour.
 */
describe("committed fixture prefixes are per-run", () => {
  /**
   * The coarse "this file cleans up by code prefix" test. Both tables the
   * pattern is used on today (`bms.assets`, `bms.asset_templates`) are covered —
   * the defect is the shared prefix, not the table.
   */
  const deletesByCodePrefix = /DELETE FROM bms\.[a-z_]+\s+WHERE code LIKE/i;

  /**
   * One whole `DELETE … WHERE code LIKE` call, from the statement to the close
   * of its parameter array. Bounded so a malformed match cannot swallow the rest
   * of the file; a call that does not close its array within the window produces
   * no statement, which `prefixDeletes` reports as unanalysable rather than
   * clean.
   */
  const PREFIX_DELETE = /DELETE FROM bms\.[a-z_]+\s+WHERE code LIKE[\s\S]{0,400}?\]/g;
  /** The interpolated prefix in a parameter, e.g. `` `${TEST_CODE}%` ``. */
  const LIKE_ARGUMENT = /`\$\{(\w+)\}%`/g;
  /** A statement that bounds itself by row age cannot reach a live instance. */
  const AGE_BOUNDED = /created_at\s*</;

  type PrefixDelete = { readonly statement: string; readonly prefixNames: string[] };

  function prefixDeletes(source: string): PrefixDelete[] {
    return [...source.matchAll(PREFIX_DELETE)].map((match) => ({
      statement: match[0],
      prefixNames: [...match[0].matchAll(LIKE_ARGUMENT)].map((arg) => arg[1]),
    }));
  }

  /**
   * Whether `name` is declared in this file from a per-run value.
   *
   * Deliberately reads the declaration rather than the file: a suite that calls
   * `randomUUID()` for an unrelated fixture must not thereby exempt a constant
   * prefix. The lazy `;` terminator ends the initialiser, which is why a
   * multi-line template literal still resolves.
   */
  function isRunUnique(source: string, name: string): boolean {
    const declaration = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=[\\s\\S]{0,400}?;`);
    const match = declaration.exec(source);
    return match !== null && /randomUUID\(/.test(match[0]);
  }

  /** Why this file is an offender, or `null` when every statement is safe. */
  function unsafeSweep(source: string): string | null {
    const statements = prefixDeletes(source);
    if (statements.length === 0) {
      return "has a prefix DELETE this rule could not parse";
    }
    for (const { statement, prefixNames } of statements) {
      if (AGE_BOUNDED.test(statement)) {
        continue;
      }
      const shared = prefixNames.filter((name) => !isRunUnique(source, name));
      if (prefixNames.length === 0) {
        return "sweeps a prefix that is not an interpolated constant";
      }
      if (shared.length > 0) {
        return `sweeps the shared prefix(es) ${shared.join(", ")}`;
      }
    }
    return null;
  }

  /**
   * Suites that still sweep a shared constant, listed so the rule can be stated
   * now rather than after all of them are converted. **This list may only get
   * shorter**, and the two assertions below enforce that in both directions.
   *
   * Each entry is the same latent defect `F2.1` had. **No backlog row tracks
   * them yet** — `F4.53` is a different mechanism (an unordered `LIMIT` on the
   * *reading* side, whose four files do not appear here), and landing it in full
   * would leave every entry below in place. Converting one is a one-line change
   * to its fixture constant plus its cleanup's prefix.
   */
  const NOT_YET_PER_RUN = [
    "apps/api/src/admin/asset-templates/asset-templates.instantiate.integration.spec.ts",
    "apps/api/src/admin/asset-templates/asset-templates.migrate.integration.spec.ts",
    "apps/api/src/admin/asset-points/asset-point-calc-override.integration.spec.ts",
    "apps/api/src/admin/telemetry-entry/telemetry-write.spec.ts",
    "apps/api/src/admin/telemetry-import/telemetry-import.spec.ts",
    "apps/api/src/calc/calc-definitions.integration.spec.ts",
    "apps/api/src/calc/calc-definitions.merge.integration.spec.ts",
    "apps/api/src/calc/calc-write.integration.spec.ts",
  ];

  /**
   * `.spec` *and* the `.integration.test` wrapper: ADR 0014 puts the database
   * lifecycle in the wrapper, so a suite that issues its cleanup there is the
   * same defect. No such file exists today; the pattern is here so the first one
   * is not invisible. The walk covers `apps` and `packages` only, which is also
   * why this file cannot match itself.
   */
  function specsWithPrefixCleanup(): string[] {
    return ["apps", "packages"]
      .flatMap((root) => {
        try {
          return walk(join(repoRoot, root));
        } catch {
          return [];
        }
      })
      .filter((f) => /(\.spec|\.integration\.test)\.tsx?$/.test(f))
      .filter((f) => deletesByCodePrefix.test(readFileSync(f, "utf8")))
      .map((f) => relative(repoRoot, f).replace(/\\/g, "/"))
      .sort();
  }

  it("no committed-fixture spec sweeps a prefix it shares with a concurrent instance", () => {
    const specs = specsWithPrefixCleanup();

    // An empty offender list must mean "scanned and clean", not "scanned
    // nothing" — the same floor the rule above uses. Nine such specs exist as
    // of this commit.
    expect(
      specs.length,
      "no spec with a prefix DELETE was found. Either the walk or the DELETE pattern is " +
        "broken, and the offender list below would mean nothing.",
    ).toBeGreaterThanOrEqual(9);

    const offenders = specs
      .filter((rel) => !NOT_YET_PER_RUN.includes(rel))
      .map((rel) => ({ rel, why: unsafeSweep(readFileSync(join(repoRoot, rel), "utf8")) }))
      .filter((row) => row.why !== null)
      .map((row) => `${row.rel} — ${row.why}`);

    expect(
      offenders,
      `a committed-fixture spec sweeps a shared prefix:\n${offenders.join("\n")}\n\n` +
        "Give the fixture code a per-run suffix (randomUUID) and delete only that code — " +
        "see TEST_CODE in apps/api/src/admin/asset-templates/" +
        "asset-templates.lifecycle.integration.spec.ts. A constant prefix means two " +
        "instances of this one file delete each other's committed rows. A family-wide " +
        "sweep is permitted only when the statement bounds itself by created_at.",
    ).toEqual([]);
  });

  it("the exemption list only gets shorter", () => {
    const specs = specsWithPrefixCleanup();

    // A path that no longer matches is an exemption nobody needs, and a typo in
    // a path would silently exempt nothing while looking like it exempts
    // something.
    const stale = NOT_YET_PER_RUN.filter((rel) => !specs.includes(rel));
    expect(
      stale,
      `these exemptions no longer name a spec with a prefix DELETE:\n${stale.join("\n")}`,
    ).toEqual([]);

    // The direction that actually matters. Without it, converting a suite
    // leaves its exemption in place forever, and the exemption then hides a
    // later revert — the rule would gate one file in perpetuity.
    const converted = NOT_YET_PER_RUN.filter(
      (rel) => unsafeSweep(readFileSync(join(repoRoot, rel), "utf8")) === null,
    );
    expect(
      converted,
      `these are already per-run and must lose their exemption:\n${converted.join("\n")}`,
    ).toEqual([]);

    // A ratchet, not a limit: eight is what this commit found, and nothing may
    // add a ninth.
    expect(
      NOT_YET_PER_RUN.length,
      "the exemption list grew. A new committed-fixture suite must be per-run from the start.",
    ).toBeLessThanOrEqual(8);
  });

  it("the analysis kills the mutation it exists to catch", () => {
    // The four mutations a review ran against the first draft of this rule,
    // which killed only the second. `F4.39`: the original defect, restored
    // verbatim, must be one of them.
    const perRun = "const TEST_CODE = `${FAMILY}-${randomUUID().slice(0, 10)}`;";
    const constant = 'const TEST_CODE = "F21-LIFECYCLE-TEST";';
    const family = 'const FAMILY = "F21-LIFECYCLE-TEST";';
    const cleanup = (arg: string) =>
      "await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${" + arg + "}%`]);";
    const sweep = (tail: string) =>
      "await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1" +
      tail +
      "`, [`${FAMILY}%`]);";

    // The fix itself must pass, or every mutation below proves nothing.
    expect(unsafeSweep([family, perRun, cleanup("TEST_CODE")].join("\n"))).toBeNull();
    expect(
      unsafeSweep(
        [family, perRun, cleanup("TEST_CODE"), sweep(" AND created_at < now() - interval '1 hour'")].join("\n"),
      ),
    ).toBeNull();

    // M1 — cleanup widened back to the family, per-run constant untouched.
    expect(unsafeSweep([family, perRun, cleanup("FAMILY")].join("\n"))).not.toBeNull();
    // M2 — the original defect, verbatim.
    expect(unsafeSweep([constant, cleanup("TEST_CODE")].join("\n"))).not.toBeNull();
    // M3 — constant prefix, with an unrelated randomUUID() call as a decoy.
    expect(
      unsafeSweep([constant, "const other = randomUUID();", cleanup("TEST_CODE")].join("\n")),
    ).not.toBeNull();
    // M4 — the age-bounded sweep loses only its bound, and stays valid SQL.
    expect(unsafeSweep([family, perRun, cleanup("TEST_CODE"), sweep("")].join("\n"))).not.toBeNull();
  });

  it("the cleanup pattern still matches the shapes it is about", () => {
    expect(
      deletesByCodePrefix.test(
        "await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);",
      ),
    ).toBe(true);
    expect(
      deletesByCodePrefix.test(
        "await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);",
      ),
    ).toBe(true);
    // A delete by id is not this defect and must not be flagged.
    expect(
      deletesByCodePrefix.test("await pool.query(`DELETE FROM bms.point_keys WHERE id = $1`, [id]);"),
    ).toBe(false);
  });
});

/**
 * The 2026-08-27 `reports.service.rls.integration.test.ts` /
 * `rollup-conversion.integration.test.ts` flake — the **reading** counterpart of
 * the two rules above, and the one the first rule's own docstring predicted:
 * "that is a convention holding, not a constraint."
 *
 * `reports.service.rls` resolved its solar fixture with
 * `SELECT id, organization_id FROM bms.assets WHERE code ILIKE 'PV%' ORDER BY
 * code LIMIT 1`. `rollup-conversion` commits a probe asset coded
 * `PV-F428-PROBE`, which sorts **before** `PV-INV-01` — the only seeded `PV%`
 * asset. So whenever the two files landed in one Vitest invocation, the reports
 * suite adopted the rollup suite's fixture: it wrote 1890 `kw` rows onto a
 * foreign probe and refreshed the production aggregates over them, while
 * `cleanupProbes` deleted that asset and every telemetry row on it. Both suites
 * then failed on the other's damage and neither message named the collision.
 * Reproduced 2026-08-27; the 1890 in
 * `this check requires the raw fixture to be deleted first; 1890 rows remain`
 * is the reports fixture's own per-asset insert count, which is what identified
 * the writer.
 *
 * The convention the two rules above rely on is that every fixture prefix sorts
 * *after* the lowest seeded code. `PV-F428-PROBE` is the first one in the tree
 * that does not, and nothing forced it to — the `PV` prefix is load-bearing for
 * that suite, because the dashboard and report split solar with
 * `code ILIKE 'PV%'`. So the fix cannot be "rename the probe": the next suite
 * needing a solar fixture has the same constraint. It has to be on the reading
 * side, and it is the same rule as before — **do not share the row**. An exact
 * `code = $1` / `code = ANY($1)` cannot resolve to another suite's fixture,
 * because every committed fixture code carries its own prefix.
 *
 * **Distinct from `F4.53`, and it does not close that row.** `F4.53` is the
 * *unordered* `LIMIT` on the reading side, in four named files —
 * `alarm-enrichment`, `alarm-raise`, `assets.service` and
 * `evaluate-enabled-rules` — none of which is this one, and landing it in full
 * would leave this defect in place. Also distinct from `F4.65` (a suite sweeping
 * a prefix it shares with a concurrent copy of itself), `F4.54` (the seed sweep)
 * and `F4.55` (the aggregate teardown deadlock). All five present as "a parallel
 * suite made my fixture disappear", which is why they are easy to conflate and
 * worth keeping apart. Tracked as `F4.67`, which this rule and the suite it names
 * are the fix for.
 *
 * **The rule reads the statement, not the file**, for the reason `F4.38` gives:
 * "does this token appear anywhere in the file" survives the mutation that
 * matters. Each `bms.assets` query is examined on its own terms below, and
 * `the analysis kills the mutation it exists to catch` holds that.
 *
 * **What this does not catch**, said here rather than discovered later. The scan
 * scans string literals, so a query built by **concatenation** or held in a
 * `.sql` file never appears as one literal and is invisible, as is Drizzle's
 * builder form (`db.select().from(assets).where(ilike(assets.code, "PV%"))`) —
 * neither shape appears in the tree today and both would be the same defect. A
 * `${...}` interpolation containing a nested backtick literal ends the outer
 * window early. A pattern bound **as a parameter** (`code ILIKE $1`) reads as
 * safe, because that is how every own-prefix cleanup in this repo is written; a
 * suite that bound `'PV%'` to it would slip through. The walk covers `apps` and
 * `packages` — `tests/` is excluded on purpose (this file quotes the forbidden
 * query in its own mutation strings, so scanning it would need a
 * self-exemption), which leaves `tests/f1.7-seed-ownership.integration.test.ts`
 * unscanned; it holds no pattern read today. And the rule says nothing about
 * `ORDER BY id` or an unordered `LIMIT`, which is a different mechanism with its
 * own rule above.
 *
 * **Three gaps this list used to have, closed rather than documented**, all
 * measured by the `F4.67` code review against a real mutation: the scan read
 * *backtick* literals only while six live sites write the same read
 * double-quoted; it capped each window at 600 characters and reported anything
 * longer as **clean**; and its window could run from one literal's close to the
 * next one's open, computing both the offender text and the id-scoped exemption
 * over arbitrary source. All three are gated by
 * `the analysis kills the mutation it exists to catch` and
 * `the literal scan bounds each window at its own delimiter` below.
 */
describe("fixture assets are resolved by exact code, not by pattern", () => {
  /**
   * A **literal** code pattern — `code LIKE 'X%'`, not `code LIKE $1`.
   *
   * The optional backslash is not decoration: SQL written inside a
   * single-quoted JavaScript string has to escape its own quotes, so the defect
   * arrives spelled `code ILIKE \'PV%\'`. Without it that spelling scored zero
   * offenders while the same query in backticks scored one.
   */
  const LITERAL_CODE_PATTERN = /\bcode\s+(?:NOT\s+)?I?LIKE\s+\\?'/i;
  /**
   * An id-scoped read cannot adopt a foreign row whatever its code predicate
   * says, so it is not this defect. `rollup-conversion.integration.spec.ts`
   * mirrors the shipped `code ILIKE 'PV%'` split this way on purpose, and
   * `reports.service.rls`'s own collation guard does the same.
   */
  const ID_SCOPED = /\bid\s*(?:=|IN)\s*(?:ANY\s*\(|\(|\$)/i;

  /** Every `bms.assets` query in `source` that resolves a row by code pattern. */
  function patternReads(source: string): string[] {
    return stringLiterals(withoutComments(source)).filter(
      (statement) =>
        READS_ASSETS_TABLE.test(statement) &&
        LITERAL_CODE_PATTERN.test(statement) &&
        !ID_SCOPED.test(statement),
    );
  }

  it("no spec resolves a bms.assets row by a literal code pattern", () => {
    const specs = specsReadingAssets();

    // The same floor the two rules above use: an empty offender list must mean
    // "scanned and clean", not "the walk or the query pattern broke".
    //
    // **25 files as of this commit** — 15 `.spec.ts`, 10 `.integration.test.ts`,
    // and none yet under `src/testing/`. Measured by running this function, not
    // estimated: the first draft of this comment said 22, which was the count of
    // files with an *extractable backtick* statement rather than the count this
    // assertion actually makes, and the review that caught it proposed 28. A
    // comment asserting a measurement the tree does not have is a defect this
    // repo has recorded before (`vitest.config.ts`, the E8.3 note).
    expect(
      specs.length,
      "no spec with a FROM bms.assets query was found. Either the walk or READS_ASSETS_TABLE " +
        "is broken, and the offender list below would mean nothing.",
    ).toBeGreaterThanOrEqual(20);

    const offenders = specs.flatMap((rel) =>
      patternReads(readFileSync(join(repoRoot, rel), "utf8")).map(
        (statement) => `${rel} — ${statement.replace(/\s+/g, " ")}`,
      ),
    );

    expect(
      offenders,
      `a spec resolves a bms.assets row by code pattern:\n${offenders.join("\n")}\n\n` +
        "Name the seeded row by exact code instead — SOLAR_ASSET_CODE / GRID_ASSET_CODE in " +
        "apps/api/src/reports/reports.service.rls.integration.spec.ts. A pattern read returns " +
        "whichever row currently sorts first, which is another suite's committed fixture as " +
        "often as it is the seed. Scoping the read by id is the other way out, and is what the " +
        "suites mirroring the shipped `code ILIKE 'PV%'` split already do.",
    ).toEqual([]);
  });

  it("the analysis kills the mutation it exists to catch", () => {
    // The defect, verbatim, as it stood before 2026-08-27.
    const defect =
      "await fleetPool.query(`SELECT id, organization_id FROM bms.assets " +
      "WHERE code ILIKE 'PV%' ORDER BY code LIMIT 1`);";
    expect(patternReads(defect)).toHaveLength(1);

    // Its other half, which spans lines in the original.
    const sibling =
      "await fleetPool.query(`SELECT id FROM bms.assets\n" +
      "  WHERE organization_id = $1 AND code NOT ILIKE 'PV%'\n" +
      "  ORDER BY code LIMIT 1`, [organizationId]);";
    expect(patternReads(sibling)).toHaveLength(1);

    // The fix must pass, or the mutations above prove nothing.
    const fixed =
      "await fleet.query(`SELECT code, id, organization_id FROM bms.assets " +
      "WHERE code = ANY($1::text[])`, [[SOLAR_ASSET_CODE, GRID_ASSET_CODE]]);";
    expect(patternReads(fixed)).toEqual([]);

    // **The same defect in the other two delimiters.** Both scored ZERO against
    // the first draft, which read backtick literals only — a mutation that
    // survived the rule outright, and the shape six live sites in this tree
    // already write (`assets.service.rls.integration.*`, `locations.rls`,
    // `multi-org-scope.rls`). The single-quoted case additionally has to escape
    // its own quotes, which is what {@link LITERAL_CODE_PATTERN}'s optional
    // backslash is for.
    const doubleQuoted =
      'await fleetPool.query("SELECT id, organization_id FROM bms.assets ' +
      "WHERE code NOT ILIKE 'PV%' ORDER BY code LIMIT 1\");";
    expect(patternReads(doubleQuoted)).toHaveLength(1);
    const singleQuoted =
      "await fleetPool.query('SELECT id FROM bms.assets WHERE code ILIKE \\'PV%\\' " +
      "ORDER BY code LIMIT 1');";
    expect(patternReads(singleQuoted)).toHaveLength(1);

    // **An over-long literal must not read as clean.** The first draft capped its
    // window at 600 characters either side and silently produced no match beyond
    // it; `rollup-conversion`'s own CTE already sits at ~70% of that cap, so this
    // was one refactor away from going quiet.
    const overLong =
      "`SELECT id FROM bms.assets WHERE code ILIKE 'PV%' ORDER BY code LIMIT 1 -- " +
      "x".repeat(1500) +
      "`";
    expect(patternReads(overLong)).toHaveLength(1);

    // An id-scoped read mirroring the shipped solar split is not this defect.
    // A fragment of `rollup-conversion.integration.spec.ts:572`, not the whole
    // statement — the real one is a multi-line CTE of ~850 characters, and the
    // exemption is verified against that file directly by the population scan
    // above rather than by this line.
    const idScoped = "`SELECT id FROM bms.assets WHERE code ILIKE 'PV%' AND id = ANY($3::uuid[])`";
    expect(patternReads(idScoped)).toEqual([]);

    // An own-prefix sweep binds its pattern as a parameter; that is the cleanup
    // rule's business, not this one's.
    const ownPrefix = "await pool.query(`SELECT id FROM bms.assets WHERE code LIKE $1`, [prefix]);";
    expect(patternReads(ownPrefix)).toEqual([]);

    // Quoting the defect in a docstring is not committing it.
    const prose =
      " * They used to be resolved by pattern: `SELECT id FROM bms.assets WHERE\n" +
      " *   code ILIKE 'PV%' ORDER BY code LIMIT 1`.";
    expect(patternReads(prose)).toEqual([]);
  });

  it("the literal scan bounds each window at its own delimiter", () => {
    // The third defect the review measured: `/`[^`]*…`/` spans from one
    // literal's CLOSING delimiter, through raw source, to the next literal's
    // OPENING one — so both the offender text and the ID_SCOPED exemption could
    // be computed over arbitrary code between two unrelated literals. Proven on
    // `locations.rls.integration.spec.ts`, whose backtick literals contain no
    // `bms.assets` read at all yet which yielded a match.
    const between = "await q(`SELECT 1`);\nconst sql = \"SELECT id FROM bms.assets\";\nq(`SELECT 2`);";
    const windows = stringLiterals(between);
    expect(windows).toEqual(["`SELECT 1`", '"SELECT id FROM bms.assets"', "`SELECT 2`"]);

    // An escaped delimiter does not end the literal.
    expect(stringLiterals("const a = 'it\\'s one string';")).toEqual(["'it\\'s one string'"]);

    // A template literal may span lines; a bare `'`/`"` may not, so an
    // apostrophe in surviving prose cannot swallow the rest of the file.
    expect(stringLiterals("`line one\nline two`")).toEqual(["`line one\nline two`"]);
    expect(stringLiterals("it's fine\nconst x = 1;")).toEqual([]);
  });
});

/**
 * The 2026-08-27 `point-aggregates.integration.test.ts` failure — the **third**
 * reading defect, and the one that proves the rule above is narrower than the
 * sentence people quote about it.
 *
 * `point-aggregates.integration.spec.ts` resolved its fixture asset twice with
 * `SELECT id FROM bms.assets ORDER BY code LIMIT 1`. That is `F4.67`'s mechanism
 * with the `WHERE` clause **removed**, so it is strictly wider — `F4.67` could
 * only adopt a foreign `PV%` row, this could adopt whatever sorted first in the
 * whole table — and it was invisible to both rules already here:
 *
 * - the rollback rule filters its candidates to specs containing `tx.rollback()`,
 *   and this file contains none;
 * - the `F4.67` rule looks for a literal code *pattern* (`code ILIKE 'PV%'`), and
 *   this query has no code predicate at all.
 *
 * **It did not need a foreign fixture to fail.** Measured on a seeded developer
 * database: the first organization by `id` is `ESKOM` and its lowest code is
 * `CH-CRAC-101` — `1d4c1fd0-0ede-4ede-a74a-ed5dd9998b69` — which is the row
 * `reports.service.rls.integration.spec.ts` names as `GRID_ASSET_CODE`. Both
 * suites write `point_key = 'kw'` onto it in an overlapping recent window, so the
 * two contended on one *seeded* row with no transient fixture in play. Running
 * the pair in one Vitest invocation failed on the first attempt with
 * `energySummary("7d").totalKwh is 267.28, the equivalent raw query says 264.9`,
 * a message that blames the `level`/`kwhFactor` pairing instead. That half is
 * `no two suites claim the same asset code`, in
 * `tests/integration-fixture-sharing.test.ts`; this rule is the resolution shape,
 * and neither one alone would have caught the failure.
 *
 * **No `tx.rollback()` filter here, deliberately.** The rollback rule gates
 * *eligibility to read*: a suite that never commits may not take a row off the
 * seed at all, because that row belongs to no transaction of its own. That is a
 * property of the isolation style, so keying on the marker is right there. This
 * rule gates *resolution shape*, which is isolation-independent — a
 * committed-fixture suite resolving positionally adopts a neighbour's row exactly
 * as a rollback one does, and `point-aggregates` (zero `tx.rollback()`) is the
 * proof. Applying the filter here would have reproduced the gap this rule exists
 * to close. The population is {@link specsReadingAssets}, unfiltered.
 *
 * **What this does not catch.** Everything the `F4.67` rule cannot see, for the
 * same reasons and with the same scanner: a query built by concatenation or held
 * in a `.sql` file is never one literal, and Drizzle's builder form
 * (`db.select().from(assets).limit(1)`) is not SQL text at all — that last one is
 * `F4.53`'s spelling, so this rule does **not** close `F4.53`. {@link EXACT_CODE}
 * is unqualified, so a **joined** table's `code` satisfies it: `FROM bms.assets a
 * JOIN bms.locations l ON l.code = $1 … ORDER BY a.code LIMIT 1` reads as named
 * although the asset is still picked by position. No read of that shape exists
 * today — the six exempted below join on `organization_id` or `active` — and
 * qualifying the predicate would have to survive `a.code`, `assets.code` and the
 * unaliased form. The exemption list is keyed by file, so a *new* positional read
 * inside an already-listed file passes; that is the same trade `NOT_YET_PER_RUN`
 * makes.
 */
describe("fixture assets are resolved by name, not by position", () => {
  /** `LIMIT` is the positional tell. `ORDER BY` narrows the race, it does not close it. */
  const POSITIONAL = /\bLIMIT\b/i;
  /** A named row. `code = $1`, `code = ANY($1)` and `code IN (...)` all resolve one thing. */
  const EXACT_CODE = /\bcode\s*(?:=|IN\s*\()/i;
  /** An id-scoped read cannot adopt a foreign row whatever else it says. */
  const ID_SCOPED = /\bid\s*(?:=|IN)\s*(?:ANY\s*\(|\(|\$)/i;

  /**
   * Specs holding a positional `bms.assets` read that this change does not fix.
   *
   * Six statements across four files, measured by running {@link positionalReads}
   * over the tree. They are the same class and each is a live hazard, but they
   * are not this fix, and converting one means choosing a named row for that
   * suite — a judgement per file, not a sweep. Listing them keeps the rule
   * enforcing today instead of waiting for that work, and `the exemption list
   * only gets shorter` stops the list growing.
   *
   * **They are the positional class in files `F4.53` never named, and that row is
   * not the place to look them up.** `F4.53` enumerates eight unordered
   * selections in four files; checked 2026-08-27, all eight are resolved —
   * `alarm-enrichment`, `alarm-raise` and `evaluate-enabled-rules` build their
   * assets with `createFixtureAssets()`, `alarm-enrichment`'s `bms.users` read is
   * now `ORDER BY id` with the reason recorded next to it (no spec in `apps/api`
   * writes that table, so nothing can delete the row), and the file holding the
   * `bms.organizations` read is gone, replaced by
   * `assets.service.rls.integration.spec.ts`, which reads id-scoped. None of the
   * six below is one of them, and most carry `ORDER BY`, which `F4.53` explicitly
   * is not about.
   *
   * - `resolve-catalog-point-key.spec.ts` — `WHERE l.active = true ORDER BY
   *   a.code LIMIT 1`.
   * - `telemetry-write.spec.ts`, `telemetry-import.spec.ts` — "an asset in some
   *   other organization", `ORDER BY a.code LIMIT 1`.
   * - `access-control.integration.spec.ts` — three reads (`rtu_id IS NULL
   *   LIMIT 5`, and two access-scoped `LIMIT 1`s). This is also `F4.66`'s file,
   *   and for the same underlying reason: it asserts against whatever the table
   *   happens to hold rather than against rows it named.
   */
  const POSITIONAL_NOT_YET_NAMED: readonly string[] = [
    "apps/api/src/admin/asset-points/resolve-catalog-point-key.spec.ts",
    "apps/api/src/admin/telemetry-entry/telemetry-write.spec.ts",
    "apps/api/src/admin/telemetry-import/telemetry-import.spec.ts",
    "apps/api/src/auth/access-control.integration.spec.ts",
  ];

  /** Every `bms.assets` query in `source` that resolves a row by position. */
  function positionalReads(source: string): string[] {
    return stringLiterals(withoutComments(source)).filter(
      (statement) =>
        READS_ASSETS_TABLE.test(statement) &&
        POSITIONAL.test(statement) &&
        !EXACT_CODE.test(statement) &&
        !ID_SCOPED.test(statement),
    );
  }

  function specsWithPositionalReads(): string[] {
    return specsReadingAssets().filter(
      (rel) => positionalReads(readFileSync(join(repoRoot, rel), "utf8")).length > 0,
    );
  }

  it("no spec resolves a bms.assets row by position", () => {
    const specs = specsReadingAssets();

    // The floor every rule in this file carries: an empty offender list must mean
    // "scanned and clean", not "the walk broke". 26 files as of this commit,
    // measured by running the function.
    expect(
      specs.length,
      "no spec with a FROM bms.assets query was found. Either the walk or READS_ASSETS_TABLE " +
        "is broken, and the offender list below would mean nothing.",
    ).toBeGreaterThanOrEqual(20);

    const offenders = specs
      .filter((rel) => !POSITIONAL_NOT_YET_NAMED.includes(rel))
      .flatMap((rel) =>
        positionalReads(readFileSync(join(repoRoot, rel), "utf8")).map(
          (statement) => `${rel} — ${statement.replace(/\s+/g, " ")}`,
        ),
      );

    expect(
      offenders,
      `a spec resolves a bms.assets row by position:\n${offenders.join("\n")}\n\n` +
        "Name the row instead — FIXTURE_ASSET_CODE in " +
        "apps/api/src/telemetry/point-aggregates.integration.spec.ts, resolved by " +
        "resolveSeededAssetByCode() in apps/api/src/testing/integration-fixtures.ts. A " +
        "positional read returns whatever currently sorts first, which is another suite's " +
        "committed fixture as often as it is the seed, and `ORDER BY` only narrows that.",
    ).toEqual([]);
  });

  it("the exemption list only gets shorter", () => {
    const specs = specsWithPositionalReads();

    // A path that no longer holds a positional read is an exemption nobody needs,
    // and a typo would silently exempt nothing while looking like it exempts
    // something. Both directions, the same ratchet `NOT_YET_PER_RUN` uses.
    const stale = POSITIONAL_NOT_YET_NAMED.filter((rel) => !specs.includes(rel));
    expect(
      stale,
      `these exemptions no longer name a spec with a positional bms.assets read:\n${stale.join("\n")}`,
    ).toEqual([]);

    expect(
      POSITIONAL_NOT_YET_NAMED.length,
      "the exemption list grew. A new fixture read must name its row from the start.",
    ).toBeLessThanOrEqual(4);
  });

  it("the analysis kills the mutation it exists to catch", () => {
    // The defect, verbatim, as it stood at both call sites before 2026-08-27.
    const defect = "await client.query(`SELECT id FROM bms.assets ORDER BY code LIMIT 1`);";
    expect(positionalReads(defect)).toHaveLength(1);

    // Unordered — `F4.53`'s raw-SQL spelling. The same rule, and the reason it is
    // stated as "by position" rather than "ordered".
    expect(positionalReads("await pool.query(`SELECT id FROM bms.assets LIMIT 2`);")).toHaveLength(
      1,
    );

    // The fix must pass, or the mutations above prove nothing. Both the exact-code
    // read itself and the constant handed to the shared resolver.
    const fixed = "await client.query(`SELECT id FROM bms.assets WHERE code = $1`, [code]);";
    expect(positionalReads(fixed)).toEqual([]);
    expect(
      positionalReads("const fx = await resolveSeededAssetByCode(pool, FIXTURE_ASSET_CODE);"),
    ).toEqual([]);

    // An exact-code read that still carries `LIMIT 1` is named, not positional —
    // there the `LIMIT` is belt-and-braces, not the resolution.
    expect(
      positionalReads("`SELECT id FROM bms.assets WHERE code = $1 ORDER BY code LIMIT 1`"),
    ).toEqual([]);

    // `F4.67`'s pattern read is the other rule's business. It has no exact code,
    // so this one flags it too, and that overlap is intended: the two rules fail
    // independently and neither relies on the other still existing.
    expect(
      positionalReads("`SELECT id FROM bms.assets WHERE code ILIKE 'PV%' ORDER BY code LIMIT 1`"),
    ).toHaveLength(1);

    // Id-scoped: cannot adopt a foreign row whatever it sorts by.
    expect(
      positionalReads("`SELECT id FROM bms.assets WHERE id = ANY($1::uuid[]) LIMIT 1`"),
    ).toEqual([]);

    // **A parameter-bound pattern PLUS a `LIMIT` is an offender here, and that
    // diverges from the `F4.67` rule on purpose.** There a `code LIKE $1` is
    // exempt because it is how every own-prefix *cleanup* is written, and a
    // cleanup acts on the whole matching set — which row sorts first is
    // irrelevant to it. A `LIMIT` turns the same predicate into a pick of one,
    // and a pattern cannot name which. No read of this shape exists in the tree
    // today; flagging it is fail-closed, and the fix is to name the row.
    expect(
      positionalReads("`SELECT id FROM bms.assets WHERE code LIKE $1 LIMIT 1`"),
    ).toHaveLength(1);
    // The cleanup itself, with no `LIMIT`, stays clean.
    expect(positionalReads("`DELETE FROM bms.assets WHERE code LIKE $1`")).toEqual([]);

    // Quoting the defect in a docstring is not committing it.
    expect(
      positionalReads(" * it used to read `SELECT id FROM bms.assets ORDER BY code LIMIT 1`."),
    ).toEqual([]);
  });
});
