import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, stringLiterals, walk, withoutComments } from "./support/source-scan";

/**
 * `F4.53` — a positional fixture read must resolve the **oldest** row.
 *
 * `tests/integration-fixture-isolation.test.ts` already carries `F4.67` and
 * `F4.68` for `bms.assets`, and says in its own text that `F4.53` — the
 * unordered `LIMIT` — is "a different mechanism" it does not yet enforce. This
 * file is that rule, and it covers all five tables the mechanism has been seen
 * on: `bms.assets`, `bms.locations`, `bms.organizations`, `bms.point_keys` and
 * `bms.users`.
 *
 * **Why a new file rather than a rule added to that one**: it is 836 lines
 * against the AGENTS.md §4.5 cap of 1000, and `tests/integration-fixture-sharing.test.ts`
 * is the precedent for splitting a scoped invariant out rather than crowding it.
 *
 * **What went wrong, twice, on `main` at `7543253`.** Both halves are recorded
 * because a rule whose defect is only described in prose is not a gate (§4.6):
 *
 *   - `asset-templates.lifecycle.integration.spec.ts` resolved its point keys as
 *     "any organization with at least two active keys, take the two lowest
 *     **codes**". `asset-points.service.rls.integration.test.ts` mints an active
 *     `E71B_AP_<uuid>_CAT` for its own run and deletes it when it finishes, and
 *     that code sorts early — so the templates suite adopted a foreign,
 *     transient key and then validated a template against it *after* its owner
 *     had cleaned up. Twelve tests failed with `Not in this organization's
 *     active point-key catalog`, on templates that were correct.
 *   - `work-orders.service.rls.integration.test.ts` creates a location and an
 *     asset under it, and deletes both by its own per-run prefix. Ten suites
 *     shared the read `SELECT id FROM bms.locations WHERE organization_id = $1
 *     AND active = true LIMIT 1` — unordered — so any of them could resolve that
 *     freshly-created location and plant an asset under it. The work-orders
 *     cleanup cannot see an asset it did not create, so the location `DELETE`
 *     hit `assets_location_id_locations_id_fk` and reddened the run.
 *
 * **The invariant is "oldest wins", not merely "ordered".** `ORDER BY code`
 * narrows the race and does not close it — `F4.67` is exactly that, an ordered
 * read that still adopted a foreign fixture, and it is why ordering alone is
 * not enough here. A seeded row predates every suite in the run, so ordering by
 * `created_at` can only ever resolve a row no suite deletes. A tiebreaker is
 * still required: the seed writes a catalog in one statement, so timestamps tie
 * within an organization and `created_at` alone is not deterministic.
 *
 * **The third instance, and why this file scans two spellings.** The `7543253`
 * review refused to close `F4.53` because its eighth enumerated selection was
 * still live and no gate could see it: `alarm-enrichment.integration.spec.ts`
 * resolved its actor with `.from(users).orderBy(asc(users.id)).limit(1)` — a
 * *builder* chain, not a string literal — under a comment claiming `bms.users`
 * was safe because nothing writes to it. `multi-org-scope.rls.integration.test.ts`
 * commits a user outside any transaction and deletes it in `afterAll`, and
 * `users.id` is `defaultRandom()` against four seeded rows, so that transient
 * user won `ORDER BY id LIMIT 1` about one run in five. A rule that only read
 * SQL literals would have let that stand, so this one reads both forms.
 *
 * **What this still does not catch.** A query assembled by concatenation or held
 * in a `.sql` file is neither one literal nor one chain — the same fail-open the
 * sibling rules carry. A read that resolves the row by name is out of scope by
 * design: naming a row is the *other* fix for this mechanism, and
 * `integration-fixture-sharing.test.ts` owns the collisions that naming creates.
 *
 * **The fifth table, `bms.organizations` (`F4.71`).** `energy-cost.integration.spec.ts`
 * took the first organization `ORDER BY code` that had no tariff row, and every
 * committed fixture organization in the tree (`E13HR-…`, `F330-FRESH-…`,
 * `F4161-EMPTY-…`) sorts before `PHEWB` — so the suite adopted a transient
 * organization with no active locations and failed its own precondition.
 * `rules.service.rls.integration.test.ts` read `WHERE id <> $1 LIMIT 1` with no
 * order at all and then planted an asset and a rule under whatever came back.
 * "Oldest wins" needs a seeded row to win, and here it has one only because of
 * the tiebreaker: the seed writes `ESKOM` and `PHEWB` in one statement, so their
 * `created_at` ties and `code` is what makes the read deterministic. A transient
 * organization is always younger than both, so `ORDER BY created_at, code` can
 * only resolve a seeded one.
 *
 * **Blind spots the `F4.71` sweep met, each fixed by hand where it hid a read:**
 *
 *   - `POSITIONAL` needs a `LIMIT`. A read that orders with no `LIMIT` and then
 *     takes `rows[0]` in JS is positional and invisible — that was the
 *     `energy-cost` read, the row's own defect, and the five `tests/` schema
 *     suites that took `rows[0]` and `rows[1]` of `bms.organizations ORDER BY
 *     code`, until each was rewritten to carry its `LIMIT` so this rule could
 *     see it. Reverting such a read to its old, `LIMIT`-less text still passes.
 *   - `NAMED_READ` tests one `SELECT` at a time (`selectSegments`), so an `id =`
 *     in one subquery no longer hides a positional read in its neighbour — the
 *     `INSERT … COALESCE(…)` in four notification suites was that shape. It
 *     still hides one inside the *same* `SELECT`: the `=` in
 *     `ORDER BY (code = 'ESKOM') DESC` (`alarms.service.rls.integration.test.ts`),
 *     or an outer read whose `LIMIT` falls after a named subquery, as in
 *     `WHERE organization_id = (SELECT … WHERE email = $1) LIMIT 1`.
 *   - `PREFERS_OLDEST` accepts any `created_at` within reach of the `ORDER BY`,
 *     including another alias's: an `ORDER BY o.code, l.created_at` join orders
 *     its organizations by code and still passes.
 *   - The scan walks `apps` and `packages` spec files and the top-level
 *     `tests/*.integration.test.ts` suites. Helpers are outside it:
 *     `apps/api/src/testing/*.ts` and `tests/support/`. `fixtureLocation` in
 *     `apps/api/src/testing/integration-fixtures.ts` is one — a builder read of
 *     `bms.locations` ordered by `id` under a docblock that says no test writes
 *     that table, which `F4.71` found untrue.
 */
describe("F4.53 — positional fixture reads resolve the oldest row", () => {
  /** The five tables suites resolve parents and actors from. */
  const FIXTURE_TABLE = /\bFROM\s+bms\.(assets|locations|organizations|point_keys|users)\b/i;
  /**
   * The same five tables in Drizzle's builder spelling.
   *
   * A string-literal scan cannot see `.from(users).orderBy(asc(users.id)).limit(1)`
   * at all, and `F4.53` quotes exactly that form. The `7543253` review refused to
   * close the row over it for that reason: without this half, a suite written in
   * builder form passes every rule in the tree.
   */
  const BUILDER_READ = /\.from\(\s*(assets|locations|organizations|pointKeys|users)\s*\)/g;
  /** `LIMIT` is the positional tell, exactly as the `F4.68` rule uses it. */
  const POSITIONAL = /\bLIMIT\b/i;
  /**
   * A read that names its row is not positional and is not this rule's business.
   * `code`, because that is how the seed identifies a fixture; `id`, because a
   * read bound to one id is already fully determined; and `email`, which is
   * `unique()` on `bms.users` and is therefore that table's seeded identity —
   * `WHERE email = 'admin@bms.local'` names a row exactly as `WHERE code = …`
   * does elsewhere.
   */
  const NAMED_READ = /\b(?:code|id|email)\s*(?:=|\bIN\s*\(|=\s*ANY)/i;
  /** The fix: the oldest row, which is always a seeded one. */
  const PREFERS_OLDEST = /\bORDER\s+BY\b[\s\S]{0,120}?\bcreated_at\b/i;
  /**
   * A probe that projects a constant resolves no row identity, so there is
   * nothing for a concurrent suite to pull away — `select 1 from bms.locations
   * limit 1` in `tenant-context.integration.spec.ts` asks whether the GUC lets
   * *anything* through, not which row. Narrowed here rather than exempted by
   * filename: the property that makes it safe is in the query, so the rule
   * should read it from the query.
   */
  const PROJECTS_A_CONSTANT = /\bSELECT\s+(?:1|COUNT\s*\()/i;

  /**
   * `access-control.integration.spec.ts` probes *ungranted* locations with
   * `WHERE id <> ALL($1) LIMIT 10` and asserts `canManageLocation` refuses each
   * one. The assertion holds for any id whatsoever — a transient row that is
   * adopted, or deleted mid-loop, cannot change the outcome — so ordering it
   * would add determinism the proof does not need. Listed rather than pattern-
   * matched away, so that the next unordered read has to be argued for too.
   */
  /**
   * **An exemption names a query, never a file.** The first version of this rule
   * keyed on the filename, and on 2026-08-28 that hid a real defect: exempting
   * `access-control.integration.spec.ts` for its ungranted-location probe also
   * silenced `SELECT id FROM bms.assets WHERE rtu_id IS NULL LIMIT 5` in the
   * same file, which then read a foreign suite's transient gateway-less asset
   * and reddened CI. A file-wide exemption is a blanket over every read the file
   * will ever contain, including the ones written after it.
   */
  const EXEMPT = new Map<string, ReadonlyArray<{ readonly match: string; readonly why: string }>>([
    [
      "apps/api/src/auth/access-control.integration.spec.ts",
      [
        {
          match: "id <> ALL($1)",
          why: "the ungranted-location probe: refusal is asserted for any id, so which row it draws cannot change the verdict",
        },
      ],
    ],
    [
      "apps/api/src/database/role-grants.integration.spec.ts",
      [
        {
          match: "from bms.users limit 1",
          why: "column-privilege probes: one read is a positive control and the other must throw, so the grant decides the outcome and the row is never inspected",
        },
      ],
    ],
  ]);

  /**
   * How far a builder chain may run past its `.from(...)`.
   *
   * The window ends at the statement's own `;`, whichever comes first — the same
   * bound `integration-fixture-sharing.test.ts` settled on after the `F4.67`
   * review measured an unbounded window twice. A chain that runs longer loses
   * its claim rather than borrowing the next statement's `createdAt`, which
   * would be fail-open in the one direction that matters here.
   */
  const CHAIN_WINDOW = 400;

  /** One SQL text that reads a fixture table positionally and not from the oldest row. */
  function offends(sql: string): boolean {
    return (
      FIXTURE_TABLE.test(sql) &&
      POSITIONAL.test(sql) &&
      !NAMED_READ.test(sql) &&
      !PROJECTS_A_CONSTANT.test(sql) &&
      !PREFERS_OLDEST.test(sql)
    );
  }

  /**
   * A literal cut at every `SELECT`, each piece running to the next one.
   *
   * `NAMED_READ` tests the whole literal, so an `id =` in one subquery hid a
   * positional read in its neighbour: the `INSERT … COALESCE((SELECT asset_id …
   * WHERE id = $2), (SELECT id FROM bms.assets … ORDER BY code LIMIT 1))` that
   * four notification suites carried (`F4.71`). Judged per piece as well, that
   * second subquery stands on its own. This only ever *adds* offenders — a
   * literal is still judged whole first — so it cannot hide a read the whole-
   * literal test would have reported.
   */
  function selectSegments(literal: string): string[] {
    return literal.split(/(?=\bSELECT\b)/i).filter((piece) => /^\s*SELECT\b/i.test(piece));
  }

  /** Every positional fixture read in `source` that does not prefer the oldest row. */
  function offendingReads(source: string): string[] {
    const src = withoutComments(source);
    const literals = stringLiterals(src).filter(
      (literal) => offends(literal) || selectSegments(literal).some(offends),
    );

    const chains: string[] = [];
    for (const match of src.matchAll(BUILDER_READ)) {
      const from = match.index ?? 0;
      const raw = src.slice(from, from + CHAIN_WINDOW);
      const end = raw.indexOf(";");
      const chain = end === -1 ? raw : raw.slice(0, end);
      // `.limit(` is the positional tell, exactly as `LIMIT` is in the SQL half.
      if (!/\.limit\s*\(/.test(chain)) continue;
      // A named read is out of scope here for the same reason it is there.
      if (/\bwhere\s*\(/.test(chain) && /\beq\s*\(/.test(chain)) continue;
      if (/\.orderBy\s*\(/.test(chain) && /\bcreatedAt\b/.test(chain)) continue;
      chains.push(chain.replace(/\s+/g, " ").trim());
    }
    return [...literals, ...chains];
  }

  function scan(): { scanned: number; offenders: string[] } {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ["apps", "packages", "tests"]) {
      for (const file of walk(join(repoRoot, root))) {
        if (!/(\.spec|\.integration\.test)\.tsx?$/.test(file)) continue;
        const rel = relative(repoRoot, file).replace(/\\/g, "/");
        // An exempt file is still scanned. Only the named queries are skipped,
        // so a new offending read in that same file still fails this rule.
        scanned += 1;
        const exemptions = EXEMPT.get(rel) ?? [];
        for (const literal of offendingReads(readFileSync(file, "utf8"))) {
          const flat = literal.replace(/\s+/g, " ").trim();
          if (exemptions.some((e) => flat.toLowerCase().includes(e.match.toLowerCase()))) continue;
          offenders.push(`${rel} — ${flat.slice(0, 140)}`);
        }
      }
    }
    return { scanned, offenders };
  }

  it("no integration suite resolves a fixture row positionally without ORDER BY created_at", () => {
    const { scanned, offenders } = scan();

    // The floor every sibling rule carries: an empty offender list has to mean
    // "scanned and clean", never "the walk found nothing".
    expect(
      scanned,
      "no spec files were scanned — the walk or the filename filter is broken, and the " +
        "empty offender list below would prove nothing.",
    ).toBeGreaterThan(20);

    expect(
      offenders,
      `these fixture reads take whatever sorts or scans first (F4.53):\n${offenders.join("\n")}\n\n` +
        "Add `ORDER BY created_at, <tiebreaker>` so the read resolves a seeded row. A seeded " +
        "row predates every suite in the run, so it is the only row no concurrent suite can " +
        "delete out from under you. Ordering by `code` or `name` alone is F4.67's defect, not " +
        "its fix. If the read genuinely cannot adopt a transient row, add it to EXEMPT with " +
        "the argument, not the excuse.",
    ).toEqual([]);
  });

  it("the analysis kills both mutations it exists to catch", () => {
    // The work-orders defect: the read ten suites shared.
    expect(
      offendingReads(
        'await pool.query("SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true LIMIT 1", [org]);',
      ),
    ).toHaveLength(1);

    // The asset-templates defect: ordered, and still adopting a foreign key.
    expect(
      offendingReads(
        "await pool.query(`SELECT organization_id, ARRAY_AGG(code ORDER BY code) AS codes\n" +
          "   FROM bms.point_keys WHERE active = true\n" +
          "  GROUP BY organization_id HAVING COUNT(*) >= 2\n" +
          "  ORDER BY organization_id LIMIT 1`);",
      ),
    ).toHaveLength(1);

    // Both fixes pass.
    expect(
      offendingReads(
        "await pool.query(`SELECT id FROM bms.locations\n" +
          "   WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`, [org]);",
      ),
    ).toEqual([]);
    expect(
      offendingReads(
        "await pool.query(`SELECT organization_id, (ARRAY_AGG(code ORDER BY created_at, code))[1:2] AS codes\n" +
          "   FROM bms.point_keys WHERE active = true\n" +
          "  GROUP BY organization_id HAVING COUNT(*) >= 2\n" +
          "  ORDER BY MIN(created_at), organization_id LIMIT 1`);",
      ),
    ).toEqual([]);

    // `F4.67`'s own fix — an exact-code read — is a named read and stays out of
    // scope here rather than being demanded to carry a `created_at` it has no
    // use for.
    expect(
      offendingReads("await pool.query(`SELECT id FROM bms.assets WHERE code = $1 LIMIT 1`, [c]);"),
    ).toEqual([]);

    // A read with no `LIMIT` is not positional: it returns the whole set, so
    // there is no "first row" to lose.
    expect(
      offendingReads("await pool.query(`SELECT id FROM bms.locations WHERE active = true`);"),
    ).toEqual([]);

    // Prose quoting the forbidden query is not the query. The scan strips
    // comments first, and this file's own docstring above is the reason that
    // matters.
    expect(
      offendingReads(
        "// SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true LIMIT 1\n" +
          "const x = 1;",
      ),
    ).toEqual([]);

    // `F4.71`: the `rules.service.rls` read — no order at all, and a rule and
    // an asset are then written under whatever organization it returns.
    expect(
      offendingReads(
        'await pool.query("SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1", [orgA]);',
      ),
    ).toHaveLength(1);
    // The `energy-cost` read once it carries a `LIMIT`: ordered, but by `code`,
    // which every committed fixture organization (`E…`, `F…`) wins.
    expect(
      offendingReads(
        "await pool.query(`SELECT id, currency FROM bms.organizations WHERE id <> ALL($1::uuid[]) ORDER BY code LIMIT 1`, [ids]);",
      ),
    ).toHaveLength(1);
    // The fix: `created_at` first, `code` to break the ESKOM/PHEWB tie.
    expect(
      offendingReads(
        'await pool.query("SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, code LIMIT 1", [orgA]);',
      ),
    ).toEqual([]);
    // A seeded organization named by code is out of scope, as it is for assets.
    expect(
      offendingReads("await pool.query(`SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`);"),
    ).toEqual([]);
    // The builder spelling of the same table.
    expect(
      offendingReads("const [o] = await db.select({ id: organizations.id }).from(organizations).limit(1);"),
    ).toHaveLength(1);
    expect(
      offendingReads(
        "const [o] = await db.select({ id: organizations.id }).from(organizations)" +
          ".orderBy(asc(organizations.createdAt), asc(organizations.code)).limit(1);",
      ),
    ).toEqual([]);

    // A different table is not this rule's business — `bms.work_orders` has no
    // seeded fixture row to prefer.
    expect(
      offendingReads("await pool.query(`SELECT id FROM bms.work_orders LIMIT 1`);"),
    ).toEqual([]);
  });

  it("the builder half kills the mutation the SQL half cannot see", () => {
    // `F4.53`'s eighth instance, in the exact spelling that made the `7543253`
    // review refuse the flip. No string literal in this source names a table.
    const defect =
      "const [user] = await db\n" +
      "  .select({ id: users.id, email: users.email })\n" +
      "  .from(users)\n" +
      "  .orderBy(asc(users.id))\n" +
      "  .limit(1);";
    expect(offendingReads(defect)).toHaveLength(1);

    // The fix.
    expect(
      offendingReads(
        "const [user] = await db\n" +
          "  .select({ id: users.id, email: users.email })\n" +
          "  .from(users)\n" +
          "  .orderBy(asc(users.createdAt), asc(users.id))\n" +
          "  .limit(1);",
      ),
    ).toEqual([]);

    // `F4.53`'s own quoted spelling — an unordered builder `limit`, which is
    // strictly worse than the defect above and must also fail.
    expect(
      offendingReads("const rows = await db.select({ id: assets.id }).from(assets).limit(2);"),
    ).toHaveLength(1);

    // A builder read with no `.limit()` returns the whole set: not positional.
    expect(
      offendingReads("const rows = await db.select({ id: assets.id }).from(assets);"),
    ).toEqual([]);

    // A builder read bound to one row by `eq()` names it, exactly as
    // `WHERE code = $1` does on the SQL side.
    expect(
      offendingReads(
        "const [a] = await db.select().from(assets).where(eq(assets.code, code)).limit(1);",
      ),
    ).toEqual([]);

    // An insert is not a read — `.from()` is what this rule keys on, and a
    // values/returning chain never carries one.
    expect(
      offendingReads("await db.insert(users).values(row).returning({ id: users.id });"),
    ).toEqual([]);

    // The window stops at the statement's own `;`, so a `createdAt` belonging to
    // the NEXT statement cannot launder the offending chain above it.
    expect(
      offendingReads(
        "const rows = await db.select({ id: assets.id }).from(assets).limit(2);\n" +
          "const other = await db.select().from(locations).orderBy(asc(locations.createdAt));",
      ),
    ).toHaveLength(1);
  });

  it("a named subquery does not hide a positional one beside it", () => {
    // `F4.71`: the notification suites' fixture alarm. The first subquery names
    // its row (`id = $2`), and judged as one literal that hid the second.
    const coalesce = (order: string): string =>
      "await pool.query(`INSERT INTO bms.alarms (organization_id, asset_id, severity, message)\n" +
      "  VALUES ($1, COALESCE(\n" +
      "    (SELECT asset_id FROM bms.automation_rules WHERE id = $2),\n" +
      `    (SELECT id FROM bms.assets WHERE organization_id = $1 ORDER BY ${order} LIMIT 1)\n` +
      "  ), 'warning', $3) RETURNING id`, [org, rule, msg]);";
    expect(offendingReads(coalesce("code"))).toHaveLength(1);
    // The fix.
    expect(offendingReads(coalesce("created_at, code"))).toEqual([]);

    // The same shape in an `UPDATE`, as `f2.23-catalog-code-charset` had it.
    expect(
      offendingReads(
        "await c.query(`UPDATE bms.assets SET code = $1 WHERE id = (SELECT id FROM bms.assets LIMIT 1)`, [x]);",
      ),
    ).toHaveLength(1);

    // A read bound to one id is still named, whole or cut.
    expect(
      offendingReads("await pool.query(`SELECT id FROM bms.assets WHERE id = $1 LIMIT 1`, [a]);"),
    ).toEqual([]);
    // A named read with an existence probe: the probe projects a constant, so
    // its piece is not a read of any row.
    expect(
      offendingReads(
        "await pool.query(`SELECT id FROM bms.assets a WHERE a.code = $1\n" +
          "  AND EXISTS (SELECT 1 FROM bms.locations l WHERE l.id = a.location_id LIMIT 1) LIMIT 1`, [c]);",
      ),
    ).toEqual([]);
  });

  it("the exemption list only gets shorter, and every exemption names a query", () => {
    // Same guard the committed-fixture rules carry: an exemption is a debt, and
    // a rule that lets its own exemption list grow silently stops being a rule.
    expect([...EXEMPT.keys()]).toEqual([
      "apps/api/src/auth/access-control.integration.spec.ts",
      "apps/api/src/database/role-grants.integration.spec.ts",
    ]);
    for (const [file, entries] of EXEMPT) {
      expect(entries.length, `${file} is listed with no exemption`).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(
          entry.why.length,
          `${file} exempts "${entry.match}" with no argument recorded`,
        ).toBeGreaterThan(40);
        // The 2026-08-28 defect: an exemption broad enough to be a filename
        // covers reads nobody has argued for, including ones not yet written.
        expect(
          entry.match.length,
          `${file}: an exemption must name a query fragment, not a whole file`,
        ).toBeGreaterThan(8);
      }
    }
  });

  it("an exemption covers its own query and nothing else in the file", () => {
    // The defect this rule shipped with. `access-control.integration.spec.ts`
    // was exempt for its ungranted-location probe, and that silenced an
    // unrelated unordered read in the same file — which then adopted a foreign
    // suite's gateway-less asset and reddened CI.
    const exemptRead = "`SELECT id FROM bms.locations WHERE id <> ALL($1) LIMIT 10`";
    const unrelatedRead = "`SELECT id FROM bms.assets WHERE rtu_id IS NULL LIMIT 5`";
    const entries = EXEMPT.get("apps/api/src/auth/access-control.integration.spec.ts") ?? [];
    const covered = (literal: string): boolean =>
      entries.some((e) => literal.toLowerCase().includes(e.match.toLowerCase()));

    // Both are offending reads on their own terms...
    expect(offendingReads(`await pool.query(${exemptRead});`)).toHaveLength(1);
    expect(offendingReads(`await pool.query(${unrelatedRead});`)).toHaveLength(1);
    // ...and only the argued one is exempt.
    expect(covered(exemptRead)).toBe(true);
    expect(covered(unrelatedRead)).toBe(false);
  });
});
