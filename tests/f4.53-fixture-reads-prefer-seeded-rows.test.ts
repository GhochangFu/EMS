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
 * file is that rule, and it covers the two further tables the mechanism moved
 * to once the `bms.assets` instances were closed.
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
 * **What this does not catch.** A query assembled by concatenation, held in a
 * `.sql` file, or built through a query builder is not one string literal and is
 * invisible here — the same fail-open the sibling rules carry, and the reason
 * these reads should stay written as literals. A read that resolves the row by
 * name is out of scope by design: naming a row is the *other* fix for this
 * mechanism, and `integration-fixture-sharing.test.ts` owns the collisions that
 * naming creates.
 */
describe("F4.53 — positional fixture reads resolve the oldest row", () => {
  /** The three tables suites resolve parents from. */
  const FIXTURE_TABLE = /\bFROM\s+bms\.(assets|locations|point_keys)\b/i;
  /** `LIMIT` is the positional tell, exactly as the `F4.68` rule uses it. */
  const POSITIONAL = /\bLIMIT\b/i;
  /**
   * A read that names its row is not positional and is not this rule's business.
   * `code`, because that is how the seed identifies a fixture, and `id`, because
   * a read bound to one id is already fully determined.
   */
  const NAMED_READ = /\b(?:code|id)\s*(?:=|\bIN\s*\(|=\s*ANY)/i;
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
  const EXEMPT = new Map<string, string>([
    [
      "apps/api/src/auth/access-control.integration.spec.ts",
      "the ungranted-location probe: refusal is asserted for any id, so which row it draws cannot change the verdict",
    ],
  ]);

  /** Every positional fixture read in `source` that does not prefer the oldest row. */
  function offendingReads(source: string): string[] {
    return stringLiterals(withoutComments(source)).filter(
      (literal) =>
        FIXTURE_TABLE.test(literal) &&
        POSITIONAL.test(literal) &&
        !NAMED_READ.test(literal) &&
        !PROJECTS_A_CONSTANT.test(literal) &&
        !PREFERS_OLDEST.test(literal),
    );
  }

  function scan(): { scanned: number; offenders: string[] } {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ["apps", "packages"]) {
      for (const file of walk(join(repoRoot, root))) {
        if (!/(\.spec|\.integration\.test)\.tsx?$/.test(file)) continue;
        const rel = relative(repoRoot, file).replace(/\\/g, "/");
        if (EXEMPT.has(rel)) continue;
        scanned += 1;
        for (const literal of offendingReads(readFileSync(file, "utf8"))) {
          offenders.push(`${rel} — ${literal.replace(/\s+/g, " ").trim().slice(0, 140)}`);
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

  it("the exemption list only gets shorter", () => {
    // Same guard the committed-fixture rules carry: an exemption is a debt, and
    // a rule that lets its own exemption list grow silently stops being a rule.
    expect([...EXEMPT.keys()]).toEqual(["apps/api/src/auth/access-control.integration.spec.ts"]);
    for (const [file, why] of EXEMPT) {
      expect(why.length, `${file} is exempt with no argument recorded`).toBeGreaterThan(40);
    }
  });
});
