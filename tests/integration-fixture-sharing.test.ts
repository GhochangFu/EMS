import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  READS_ASSETS_TABLE,
  repoRoot,
  stringLiterals,
  walk,
  withoutComments,
} from "./support/source-scan";

/**
 * The other half of the 2026-08-27 `point-aggregates` failure, and the half the
 * *shape* rules cannot see.
 *
 * Its siblings live in `tests/integration-fixture-isolation.test.ts`, which asks
 * how a suite resolves its fixture row; this file asks **which row** it resolves.
 * It is a separate file because that one is at the AGENTS.md §4.5 length limit,
 * and both read the tree through `tests/support/source-scan.ts`.
 *
 * `point-aggregates.integration.spec.ts` and
 * `reports.service.rls.integration.spec.ts` both resolved `CH-CRAC-101` and both
 * wrote `point_key = 'kw'` onto it in an overlapping recent window. Once the
 * first is converted to an exact code, **both suites satisfy every rule there** —
 * neither reads by pattern, neither reads by position — and the collision is
 * untouched. A rule that would have missed the defect it shipped with is not a
 * gate (AGENTS.md §4.6), so the invariant is stated directly: two suites must not
 * name the same asset.
 *
 * Sharing a row is the same defect the whole file is about, one level up. Whose
 * row it is decides who may write to it and who may delete it, and a seeded row
 * has no owner — so two suites that both claim one have no protocol between them
 * at all. `createFixtureAssets()` closes this for the rollback suites by giving
 * each its own row; a per-run prefix closes it for the committed-fixture suites.
 * A suite that must read a *seeded* row — because a continuous aggregate cannot
 * see uncommitted data — has neither escape, so the only thing left is for the
 * claims to be disjoint.
 *
 * **The claim is read from the code, not declared in a list**, so it cannot drift
 * from what the suite actually does. Two shapes count as claiming a code: an
 * exact-code `bms.assets` read with the constant in its parameters, and a call to
 * `resolveSeededAssetByCode()` — the shared resolver, which is where the read
 * itself lives once a suite uses it.
 *
 * **What this does not catch.** A constant imported from another module resolves
 * to nothing here (only same-file `const NAME = "..."` declarations are traced),
 * so a shared code routed through an import reads as unclaimed — fail-open, and
 * the reason no suite should export a seeded fixture code. Two suites *reading*
 * one row with neither writing to it would be flagged although it is harmless;
 * that is fail-closed and none exists today. And a code assembled at run time is
 * not a literal, so it is invisible, exactly as in the shape rules.
 */
describe("no two suites claim the same asset code", () => {
  /** An exact-code read. The pattern forms are the other rules' business. */
  const EXACT_CODE_READ = /\bcode\s*(?:=|IN\s*\()/i;
  /** The shared resolver in `apps/api/src/testing/integration-fixtures.ts`. */
  const RESOLVER_CALL = /resolveSeededAssetByCode\s*\(([^)]{0,200})\)/g;
  /** `const NAME = "LITERAL";` — the declaration, in this file, of a claimed code. */
  const CONST_STRING = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(["'])((?:\\.|(?!\2).)*)\2/g;
  /**
   * How far past a read's SQL literal its parameter array can reasonably run.
   *
   * A cap, not the bound — the window ends at the **call's own closing paren**,
   * whichever comes first. A raw window is the defect the `F4.67` review measured
   * twice in this file (600 characters either side; a window spanning from one
   * literal's close to the next one's open), and here it would be worse than
   * fail-open: an identifier picked up from the next statement makes two suites
   * appear to claim one code, which is a red build with no defect under it. A
   * nested call inside the arguments truncates the window early instead, which
   * loses a claim rather than inventing one.
   */
  const ARGUMENT_WINDOW = 300;

  /** Every asset code `source` names as its own fixture. */
  function assetCodeClaims(source: string): string[] {
    const src = withoutComments(source);
    const consts = new Map<string, string>();
    for (const m of src.matchAll(CONST_STRING)) {
      consts.set(m[1] as string, m[3] as string);
    }

    const claimed = new Set<string>();
    const collect = (text: string): void => {
      for (const id of text.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
        const value = consts.get(id[0]);
        if (value !== undefined) claimed.add(value);
      }
    };

    // The literals come back in source order, so a moving cursor gives each one
    // its exact position without searching the whole file for a duplicate text.
    let cursor = 0;
    for (const literal of stringLiterals(src)) {
      const at = src.indexOf(literal, cursor);
      cursor = at + literal.length;
      if (!READS_ASSETS_TABLE.test(literal) || !EXACT_CODE_READ.test(literal)) continue;
      const window = src.slice(cursor, cursor + ARGUMENT_WINDOW);
      const close = window.indexOf(")");
      collect(close === -1 ? "" : window.slice(0, close));
    }
    for (const call of src.matchAll(RESOLVER_CALL)) {
      collect(call[1] as string);
    }
    return [...claimed];
  }

  function claimsByFile(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const root of ["apps", "packages"]) {
      for (const file of walk(join(repoRoot, root))) {
        if (!/(\.spec|\.integration\.test)\.tsx?$/.test(file)) continue;
        const claims = assetCodeClaims(readFileSync(file, "utf8"));
        if (claims.length > 0) {
          out.set(relative(repoRoot, file).replace(/\\/g, "/"), claims.sort());
        }
      }
    }
    return out;
  }

  it("every asset code is claimed by at most one spec", () => {
    const claims = claimsByFile();

    // The floor the other rules carry: no collision must mean "scanned and
    // disjoint", not "extracted nothing". Four files claim codes as of this
    // commit, measured by running the function.
    expect(
      claims.size,
      "no spec was found claiming an asset code. Either the walk, the read pattern or the " +
        "constant tracing is broken, and the empty collision list below would mean nothing.",
    ).toBeGreaterThanOrEqual(3);

    const owners = new Map<string, string[]>();
    for (const [rel, codes] of claims) {
      for (const code of codes) {
        owners.set(code, [...(owners.get(code) ?? []), rel]);
      }
    }
    const shared = [...owners]
      .filter(([, files]) => files.length > 1)
      .map(([code, files]) => `${code} — ${files.join(", ")}`);

    expect(
      shared,
      `these asset codes are claimed by more than one spec:\n${shared.join("\n")}\n\n` +
        "Give one of them a different seeded row. A seeded asset has no owner, so two suites " +
        "that name it have no protocol about who writes to it or when — which is how " +
        "point-aggregates and reports.service.rls came to write `point_key = 'kw'` onto " +
        "CH-CRAC-101 at the same time. The codes already taken are listed by this test's " +
        "own scan; pick one nothing holds.",
    ).toEqual([]);
  });

  it("the analysis kills the mutation it exists to catch", () => {
    // The defect: `point-aggregates` naming the row `reports.service.rls` holds.
    // Both spellings, because the two suites write the read differently.
    const reports =
      'const GRID_ASSET_CODE = "CH-CRAC-101";\n' +
      "await fleet.query(`SELECT id FROM bms.assets WHERE code = ANY($1::text[])`, " +
      "[[SOLAR_ASSET_CODE, GRID_ASSET_CODE]]);";
    const viaResolver =
      'const FIXTURE_ASSET_CODE = "CH-CRAC-101";\n' +
      "const assetId = await resolveSeededAssetByCode(pool, FIXTURE_ASSET_CODE);";
    expect(assetCodeClaims(reports)).toContain("CH-CRAC-101");
    expect(assetCodeClaims(viaResolver)).toContain("CH-CRAC-101");

    // The fix: a different seeded row, so the two sets no longer meet.
    const fixed =
      'const FIXTURE_ASSET_CODE = "CH-CRAC-102";\n' +
      "const assetId = await resolveSeededAssetByCode(pool, FIXTURE_ASSET_CODE);";
    expect(assetCodeClaims(fixed)).toEqual(["CH-CRAC-102"]);

    // An inline read whose code is bound from a parameter the file does not
    // declare claims nothing — the fail-open case the docstring names.
    expect(
      assetCodeClaims("await pool.query(`SELECT id FROM bms.assets WHERE code = $1`, [code]);"),
    ).toEqual([]);

    // **The window stops at the call's own closing paren.** Without that bound it
    // runs 300 characters into whatever follows and collects any identifier that
    // resolves to a same-file string constant — inventing a claim, and with it a
    // collision that has no defect under it. `CH-CRAC-101` below belongs to the
    // NEXT statement and is not claimed by the read above it. This is the same
    // window defect the `F4.67` review measured twice in this file.
    expect(
      assetCodeClaims(
        "await pool.query(`SELECT id FROM bms.assets WHERE code = $1`, [code]);\n" +
          'const NOTE = "CH-CRAC-101";\n' +
          "log(NOTE);",
      ),
    ).toEqual([]);

    // Prose quoting a code is not claiming it.
    expect(
      assetCodeClaims(
        ' * it used to resolve `CH-CRAC-101` here.\n' +
          'const OTHER = "CH-CRAC-101";\n' +
          "await pool.query(`SELECT id FROM bms.locations WHERE code = $1`, [OTHER]);",
      ),
    ).toEqual([]);

    // A pattern read is the `F4.67` rule's business, not this one's: it names no
    // row, so there is nothing to collide on.
    expect(
      assetCodeClaims(
        'const P = "PV%";\n' +
          "await pool.query(`SELECT id FROM bms.assets WHERE code ILIKE $1 ORDER BY code LIMIT 1`, [P]);",
      ),
    ).toEqual([]);
  });
});
