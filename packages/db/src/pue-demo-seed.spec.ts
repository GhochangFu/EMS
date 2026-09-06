import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

/**
 * Where `seed.ts` might be, tried in order — `asset-domains-seed.spec.ts`'s
 * `SEED_CANDIDATES` idiom, and for the reason its docblock gives:
 * `import.meta.url` is a `TS1470` error under this package's CommonJS build
 * and `__dirname` does not exist when Vitest loads the file as ESM, so the two
 * cwds the suite actually runs from are named instead.
 */
const SEED_CANDIDATES = ["src/seed.ts", "packages/db/src/seed.ts"];

function readSeedSource(): string {
  const path = SEED_CANDIDATES.map((c) => resolve(process.cwd(), c)).find((p) => existsSync(p));
  if (path === undefined) {
    throw new Error(`seed.ts not found from ${process.cwd()}; tried ${SEED_CANDIDATES.join(", ")}`);
  }
  return readFileSync(path, "utf8");
}

/**
 * Comments and string literals blanked to spaces of the same length, so a call
 * named in prose cannot be mistaken for a call site. Same helper, same reason,
 * as `asset-domains-seed.spec.ts` — and it matters more here, because this
 * module's docblocks name every one of these functions.
 */
function codeOnly(source: string): string {
  const blank = (match: string): string => " ".repeat(match.length);
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/`(?:\\.|[^`\\])*`/g, blank)
    .replace(/"(?:\\.|[^"\\])*"/g, blank);
}

/** The index of a call that must appear exactly once, or a failure naming it. */
function soleCallAt(code: string, call: string): number {
  const at = code.indexOf(call);
  expect(at, `seed.ts does not call ${call}`).toBeGreaterThan(-1);
  expect(code.indexOf(call, at + 1), `seed.ts runs ${call} twice`).toBe(-1);
  return at;
}

/**
 * The one subquery of {@link PUE_DEMO_VERIFY_SQL} aliased `alias`, sliced from
 * its opening parenthesis to its closing one.
 *
 * Sliced rather than matched against the whole statement because every claim
 * below is about **one** of the five subqueries: `t.version = 1` appears in
 * `derived_points` already, and `active = true` appears on the driving assets
 * of three of them. A `toContain` over the whole string would pass on the
 * wrong subquery and prove nothing.
 */
function subqueryAliased(sql: string, alias: string): string {
  const end = sql.indexOf(`) AS ${alias}`);
  expect(end, `no subquery of the verify is aliased ${alias}`).toBeGreaterThan(-1);
  let depth = 0;
  let at = end;
  for (; at >= 0; at -= 1) {
    if (sql[at] === ")") depth += 1;
    if (sql[at] === "(") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return sql.slice(at, end + 1);
}

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

/**
 * **The `rack_kw` catalog rows are written BEFORE the health baselines** —
 * the migration review's finding A, and the reason `run 1` and `run N` of
 * `db:seed` now agree.
 *
 * `HEALTH_TEMPLATE_POINTS_SQL` declares on each `BASELINE-*` every
 * non-computed `bms.asset_points` key its domain's assets carry. Written after
 * it, the fourteen `rack_kw` rows are invisible to that statement on the first
 * boot, so `BASELINE-IT` declares `pdu_util_pct` alone on run 1 and gains
 * `rack_kw` only on run 2 — on a **published** version, which ADR 0015 makes
 * immutable, so the first boot's template is not the one every later boot
 * produces. Measured live before the fix: the `BASELINE-IT rack_kw`
 * `template_points` row was 28 s younger than the incomer template.
 *
 * `seedPueDemoRackKwPoints` therefore runs on its own, after
 * `seedRuledPointCatalog` (its only dependency is the `bms.point_keys` FK) and
 * before `seedAssetTemplateHealth`; `seedPueDemo` keeps its place last, because
 * the template copy and the pin both need the baselines to exist.
 *
 * The three call texts are matched in full, including `(pool, eskomOrgId)`:
 * `seedPueDemoRackKwPoints` has `seedPueDemo` as a prefix, so a bare
 * `indexOf("seedPueDemo")` would find the rack_kw call and the ordering claim
 * would be vacuously true.
 */
export function assertTheRackKwRowsAreSeededBeforeTheHealthBaselines(): void {
  const code = codeOnly(readSeedSource());
  const rackKwAt = soleCallAt(code, "await seedPueDemoRackKwPoints(pool, eskomOrgId);");
  const healthAt = soleCallAt(code, "await seedAssetTemplateHealth(pool, eskomOrgId);");
  const pueAt = soleCallAt(code, "await seedPueDemo(pool, eskomOrgId);");
  const catalogAt = soleCallAt(code, "await seedRuledPointCatalog(pool, eskomOrgId);");

  expect(
    catalogAt,
    "the rack_kw rows FK into bms.point_keys through the ruled-point catalog, so they cannot be written before it",
  ).toBeLessThan(rackKwAt);
  expect(
    rackKwAt,
    "the rack_kw catalog rows must be written BEFORE seedAssetTemplateHealth, or BASELINE-IT " +
      "declares rack_kw only from the second boot, on a published and therefore immutable version",
  ).toBeLessThan(healthAt);
  expect(
    healthAt,
    "seedPueDemo copies BASELINE-ELECTRICAL's measured points and moves its pin, so it still runs after the baselines",
  ).toBeLessThan(pueAt);
}

/**
 * **A deactivated `rack_kw` row must not lock the boot** — the migration
 * review's finding B.
 *
 * The `it_assets_without_rack_kw` subquery used to require `ap.active = true`.
 * Every write in this module is `ON CONFLICT … DO NOTHING`, so it cannot
 * re-activate a row: an administrator who deactivates one IT point through
 * `asset-points.service.ts` makes `db:seed` throw on **every** later
 * `compose up`, and `api`, `sim` and `ingest` all wait on the `migrate`
 * service. A supported administrative action would stop the stack.
 *
 * The subquery therefore tests existence only — the same shape
 * `UNCATALOGUED_RULED_POINTS_SQL` uses for exactly the same class of row, and
 * the same shape `verifyHierarchySeed`'s `eskom_it_rack_kw_points` count
 * already had. The seed's job is that a row exists; whether it is active is the
 * administrator's.
 */
export function assertADeactivatedRackKwRowCannotLockTheBoot(): void {
  const subquery = subqueryAliased(PUE_DEMO_VERIFY_SQL, "it_assets_without_rack_kw");
  expect(subquery).toContain("ap.point_key = 'rack_kw'");
  expect(
    subquery.includes("ap.active"),
    "the rack_kw existence check must not require ap.active = true: DO NOTHING cannot " +
      "re-activate a row an administrator deactivated, so one deactivation would fail db:seed " +
      "on every later compose up and block the whole stack from starting",
  ).toBe(false);

  // Mutation: put the predicate back and the analysis above must go red.
  const mutated = PUE_DEMO_VERIFY_SQL.replace(
    "          AND ap.point_key = 'rack_kw'",
    "          AND ap.point_key = 'rack_kw'\n          AND ap.active = true",
  );
  expect(mutated, "the mutation did not apply — the subquery's shape changed").not.toBe(
    PUE_DEMO_VERIFY_SQL,
  );
  expect(subqueryAliased(mutated, "it_assets_without_rack_kw").includes("ap.active")).toBe(true);
}

/**
 * **The verify matches the pin, version for version** — the code review's
 * finding C.
 *
 * `PUE_DEMO_PIN_SQL` moves a pin off `BASELINE-ELECTRICAL` **version 1** only.
 * `incomers_still_on_the_baseline` matched the code at any version, so a
 * database whose administrator published a v2 of the electrical baseline and
 * migrated the incomers onto it — ADR 0039's explicit, previewed and audited
 * path — reported incomers the pin is deliberately not allowed to touch, threw,
 * and blocked the boot. The two statements now name the same version, so the
 * post-condition asks about exactly the rows the statement before it could move.
 */
export function assertTheVerifyAgreesWithThePinOnTheBaselineVersion(): void {
  expect(PUE_DEMO_PIN_SQL).toContain("baseline.version = 1");
  const subquery = subqueryAliased(PUE_DEMO_VERIFY_SQL, "incomers_still_on_the_baseline");
  expect(subquery).toContain("t.code = 'BASELINE-ELECTRICAL'");
  expect(
    subquery,
    "the verify must count only the version the pin can move, or an operator-published v2 of " +
      "the baseline turns db:seed red on a database nothing is wrong with",
  ).toContain("t.version = 1");
}
