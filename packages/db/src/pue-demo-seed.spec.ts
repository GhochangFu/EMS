import { CALC_DIALECT_V2, parseFormula } from "@bms/shared";
import { expect } from "vitest";

import { HEALTH_BASELINE_CONTENT } from "./asset-template-health-seed";
import {
  PUE_DEMO_DERIVED_POINTS,
  PUE_DEMO_FORMULAS,
  PUE_DEMO_PIN_SQL,
  PUE_DEMO_RACK_KW_POINTS_SQL,
  PUE_DEMO_TEMPLATE_POINTS_SQL,
  PUE_DEMO_TEMPLATE_SQL,
  PUE_DEMO_VERIFY_SQL,
  pueDemoTemplateParams,
  pueDemoTemplatePointsParams,
} from "./pue-demo-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000000";

const WRITE_STATEMENTS = [
  PUE_DEMO_RACK_KW_POINTS_SQL,
  PUE_DEMO_TEMPLATE_SQL,
  PUE_DEMO_TEMPLATE_POINTS_SQL,
  PUE_DEMO_PIN_SQL,
];

/** Parses under `bms-calc-v2` or fails the test with the parser's own errors. */
function parseV2(formula: string) {
  const result = parseFormula(formula, { dialect: CALC_DIALECT_V2 });
  if (!result.ok) {
    throw new Error(`${formula} does not parse under ${CALC_DIALECT_V2}: ${JSON.stringify(result.errors)}`);
  }
  return result;
}

/**
 * The three demo formulas are legal `bms-calc-v2` and name what the seed
 * arranges for them: `kw` across the site, `rack_kw` across the `IT_LOAD`
 * group, and the two siblings on the incomer itself.
 *
 * Asserted on the parsed nodes rather than on `crossRefKey`'s string, so this
 * file pins what the formula *means* and not the key's encoding — that form is
 * `cross-ref.ts`'s to define and its own spec's to pin. `pue` reads two derived
 * siblings on its own asset, which `v2` admits (ADR 0055 decision 7) and the
 * scheduler resolves in the same tick through its `computedThisTick` overlay.
 */
export function assertTheThreeFormulasParseUnderV2(): void {
  const siteKw = parseV2(PUE_DEMO_FORMULAS.site_kw);
  expect(siteKw.refs).toEqual([]);
  expect(siteKw.crossRefs).toHaveLength(1);
  expect(siteKw.crossRefs[0]).toMatchObject({
    kind: "aggregate",
    fn: "sum",
    pointKey: "kw",
    scope: { kind: "site" },
  });

  const itKw = parseV2(PUE_DEMO_FORMULAS.it_kw);
  expect(itKw.refs).toEqual([]);
  expect(itKw.crossRefs).toHaveLength(1);
  expect(itKw.crossRefs[0]).toMatchObject({
    kind: "aggregate",
    fn: "sum",
    pointKey: "rack_kw",
    scope: { kind: "group", code: "IT_LOAD" },
  });

  const pue = parseV2(PUE_DEMO_FORMULAS.pue);
  expect(pue.refs).toEqual(["site_kw", "it_kw"]);
  expect(pue.crossRefs).toEqual([]);

  // The two aggregates are `v2`-only; `pue` parses under `v1` as well, which is
  // fine and expected — it is a plain local ratio.
  expect(parseFormula(PUE_DEMO_FORMULAS.site_kw).ok).toBe(false);
  expect(parseFormula(PUE_DEMO_FORMULAS.it_kw).ok).toBe(false);
}

/**
 * The demo diverges from the stock `electrical-feeder` formula in exactly one
 * key, and it is deliberate (plan §3.1).
 *
 * `apps/sim` emits `rack_kw` for its IT assets and never `kw`, so the stock
 * `sum({kw} @group('IT_LOAD'))` would resolve fourteen members that carry no
 * such reading and refuse every tick as `coverage_below_floor`. A real incomer
 * meters real IT feeders in `kw`; the stock entry keeps that. The other two
 * literals are byte-identical to the stock ones — `tests/f2.8-pue-curve-is-gone`
 * reads both files as text and holds the pair together.
 */
export function assertItKwReadsRackKwHereAndOnlyHere(): void {
  expect(PUE_DEMO_FORMULAS.site_kw).toBe("sum({kw} @site)");
  expect(PUE_DEMO_FORMULAS.it_kw).toBe("sum({rack_kw} @group('IT_LOAD'))");
  expect(PUE_DEMO_FORMULAS.pue).toBe("{site_kw} / {it_kw}");
  expect(PUE_DEMO_DERIVED_POINTS.map((point) => point.pointKey)).toEqual(["site_kw", "it_kw", "pue"]);
  expect(PUE_DEMO_DERIVED_POINTS.map((point) => point.sortOrder)).toEqual([100, 101, 102]);
}

/**
 * A re-seed must not fail, and must never rewrite a published version.
 *
 * The same rule `asset-template-health-seed.spec.ts` states, for the same
 * reason: ADR 0015 makes a published version immutable and an asset pins the
 * version. Every write here is `DO NOTHING` or predicated, so the hundredth
 * `compose up` writes what the first one wrote and nothing more.
 */
export function assertReSeedingNeverRewritesAPublishedVersion(): void {
  expect(PUE_DEMO_TEMPLATE_SQL).toContain("ON CONFLICT (organization_id, code, version) DO NOTHING");
  expect(PUE_DEMO_TEMPLATE_POINTS_SQL).toContain("ON CONFLICT (template_id, point_key) DO NOTHING");
  expect(PUE_DEMO_RACK_KW_POINTS_SQL).toContain("ON CONFLICT (asset_id, point_key) DO NOTHING");
  for (const sql of WRITE_STATEMENTS) {
    expect(sql).not.toContain("DO UPDATE");
  }
}

/**
 * The pin moves only a `BASELINE-ELECTRICAL` pin, and selects the incomer by
 * its role.
 *
 * Ruling 1 names "the site's `incoming-supply` asset", and `demoRoleForAsset`
 * already writes that role, so the selector is read off data rather than a
 * code list (plan §11 decision 3). Naming the source template in the `WHERE` is
 * what makes an operator's migration (ADR 0039's explicit, previewed and
 * audited path) survive a re-seed: an incomer pinned anywhere else is not
 * touched, and one already on the incomer template is a no-op.
 */
export function assertThePinMovesOnlyABaselinePinOfAnIncomer(): void {
  expect(PUE_DEMO_PIN_SQL).toContain("baseline.code = 'BASELINE-ELECTRICAL'");
  expect(PUE_DEMO_PIN_SQL).toContain("a.template_id = baseline.id");
  expect(PUE_DEMO_PIN_SQL).toContain("agm.role = 'incoming-supply'");
  expect(PUE_DEMO_PIN_SQL).toContain("incomer.domain = a.domain");
}

/**
 * The dialect reaches the database as a **parameter**, never as a literal.
 *
 * `tests/adr-0055-calc-v2-invariants.test.ts` part (c) refuses a `'bms-calc-v2'`
 * literal under `apps/api/src` and `packages/shared/src/contracts`; this seed
 * lives outside both scans, so the same rule is held here by hand. The three
 * derived rows are `scheduled` at 60 s with a NULL `min_coverage_ratio` — ADR
 * 0055 decision 11's fail-closed default, relaxed only on an imported draft —
 * and a NULL `max_input_age_seconds`, which the engine reads as its 300 s
 * default.
 */
export function assertTheDialectIsAParameterAndTheRowsAreScheduled(): void {
  expect(PUE_DEMO_TEMPLATE_POINTS_SQL).not.toContain("bms-calc");
  expect(PUE_DEMO_TEMPLATE_POINTS_SQL).toContain("'derived'");
  expect(PUE_DEMO_TEMPLATE_POINTS_SQL).toContain("$2::varchar,\n  'scheduled',\n  60,\n  NULL,\n  NULL");
  expect(PUE_DEMO_TEMPLATE_POINTS_SQL).toContain("src.kind = 'measured'");

  const params = pueDemoTemplatePointsParams(ORGANIZATION_ID);
  expect(params[0]).toBe(ORGANIZATION_ID);
  expect(params[1]).toBe(CALC_DIALECT_V2);
  expect(params[2]).toEqual(["site_kw", "it_kw", "pue"]);
  expect(params[3]).toEqual([
    PUE_DEMO_FORMULAS.site_kw,
    PUE_DEMO_FORMULAS.it_kw,
    PUE_DEMO_FORMULAS.pue,
  ]);
  expect(params[5]).toEqual(["kW", "kW", null]);
  expect(params[6]).toEqual([100, 101, 102]);
}

/**
 * The `rack_kw` catalog rows satisfy `asset_points_source_ref_check`.
 *
 * `unmapped` requires `rtu_id IS NULL`, and that is also the shape
 * `seedRuledPointCatalog` writes for every electrical key. Membership in
 * `sum({rack_kw} @group('IT_LOAD'))` needs the key declared "by template or by
 * an active mapping" (`readScopeMembers`); the IT baseline declares only
 * `pdu_util_pct`, so without these rows the aggregate resolves zero members.
 */
export function assertRackKwRowsSatisfyTheSourceRefCheck(): void {
  expect(PUE_DEMO_RACK_KW_POINTS_SQL).toContain("'rack_kw'");
  expect(PUE_DEMO_RACK_KW_POINTS_SQL).toContain("'SIM_RACK_KW',\n  NULL,\n  'unmapped'");
  expect(PUE_DEMO_RACK_KW_POINTS_SQL).toContain("a.domain = 'it'");
  expect(PUE_DEMO_RACK_KW_POINTS_SQL).toContain("a.active = true");
}

/**
 * The incomer template keeps the health band, so E1.3's donut loses no asset.
 *
 * `asset_type = 'baseline'` puts the row under `HEALTH_TEMPLATE_VERIFY_SQL`'s
 * `unusable` check on every later seed; `content` is the same
 * `HEALTH_BASELINE_CONTENT` the four domain baselines carry.
 */
export function assertTheIncomerTemplateKeepsItsHealthBand(): void {
  expect(PUE_DEMO_TEMPLATE_SQL).toContain("'baseline'");
  expect(PUE_DEMO_TEMPLATE_SQL).toContain("'BASELINE-ELECTRICAL-INCOMER'");
  expect(PUE_DEMO_TEMPLATE_SQL).toContain("'published'");
  const params = pueDemoTemplateParams(ORGANIZATION_ID);
  expect(params[0]).toBe(ORGANIZATION_ID);
  expect(JSON.parse(params[1])).toEqual(HEALTH_BASELINE_CONTENT);
}

/**
 * Every statement is bounded to one organization — the same measured rule the
 * health seed states, because an unbounded write here would give PHE WB's
 * assets an ESKOM template and turn `verifyHierarchySeed` red one step later.
 */
export function assertEveryStatementIsBoundedToOneOrganization(): void {
  expect(PUE_DEMO_RACK_KW_POINTS_SQL).toContain("a.organization_id = $1");
  expect(PUE_DEMO_TEMPLATE_SQL).toContain("$1::uuid");
  expect(PUE_DEMO_TEMPLATE_POINTS_SQL).toContain("incomer.organization_id = $1");
  expect(PUE_DEMO_TEMPLATE_POINTS_SQL).toContain("baseline.organization_id = $1");
  expect(PUE_DEMO_PIN_SQL).toContain("a.organization_id = $1");
  expect(PUE_DEMO_PIN_SQL).toContain("incomer.organization_id = $1");
  expect(PUE_DEMO_PIN_SQL).toContain("baseline.organization_id = $1");
  expect(PUE_DEMO_VERIFY_SQL).toContain("a.organization_id = $1");
  expect(PUE_DEMO_VERIFY_SQL).toContain("t.organization_id = $1");
}

/**
 * The post-condition reads back every write, because a FORCE-RLS write can
 * drop rows without raising.
 *
 * Zero-uncovered counts rather than totals (the migration review of PR #100's
 * rule): an IT asset with no `rack_kw` row, an IT asset outside `IT_LOAD`, and
 * an incomer still on the baseline are each a failure the statements cannot
 * report on their own. The absolute cardinalities (9 incomers, 14 members, 14
 * rows) live in `verify-hierarchy-seed.ts`, the boot gate.
 */
export function assertTheVerifyReadsBackEveryWrite(): void {
  expect(PUE_DEMO_VERIFY_SQL).toContain("AS it_assets_without_rack_kw");
  expect(PUE_DEMO_VERIFY_SQL).toContain("AS it_assets_outside_it_load");
  expect(PUE_DEMO_VERIFY_SQL).toContain("AS incomers_still_on_the_baseline");
  expect(PUE_DEMO_VERIFY_SQL).toContain("AS derived_points");
  expect(PUE_DEMO_VERIFY_SQL).toContain("AS pinned_incomers");
  expect(PUE_DEMO_VERIFY_SQL).toContain("ag.code = 'IT_LOAD'");
  expect(PUE_DEMO_VERIFY_SQL).toContain("ap.point_key = 'rack_kw'");
}
