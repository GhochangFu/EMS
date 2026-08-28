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
 * file is that rule, and it covers all four tables the mechanism has been seen
 * on: `bms.assets`, `bms.locations`, `bms.point_keys` and `bms.users`.
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
 */
describe("F4.53 — positional fixture reads resolve the oldest row", () => {
  /** The four tables suites resolve parents and actors from. */
  const FIXTURE_TABLE = /\bFROM\s+bms\.(assets|locations|point_keys|users)\b/i;
  /**
   * The same four tables in Drizzle's builder spelling.
   *
   * A string-literal scan cannot see `.from(users).orderBy(asc(users.id)).limit(1)`
   * at all, and `F4.53` quotes exactly that form. The `7543253` review refused to
   * close the row over it for that reason: without this half, a suite written in
   * builder form passes every rule in the tree.
   */
  const BUILDER_READ = /\.from\(\s*(assets|locations|pointKeys|users)\s*\)/g;
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

  /** Every positional fixture read in `source` that does not prefer the oldest row. */
  function offendingReads(source: string): string[] {
    const src = withoutComments(source);
    const literals = stringLiterals(src).filter(
      (literal) =>
        FIXTURE_TABLE.test(literal) &&
        POSITIONAL.test(literal) &&
        !NAMED_READ.test(literal) &&
        !PROJECTS_A_CONSTANT.test(literal) &&
        !PREFERS_OLDEST.test(literal),
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
    for (const root of ["apps", "packages"]) {
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
