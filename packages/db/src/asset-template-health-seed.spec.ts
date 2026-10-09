import type pg from "pg";
import { expect } from "vitest";

import {
  HEALTH_BANDS,
  HEALTH_BASELINE_CONTENT,
  HEALTH_ROLE_TEMPLATE_PIN_SQL,
  HEALTH_ROLE_TEMPLATE_POINTS_SQL,
  HEALTH_ROLE_TEMPLATE_REPIN_SQL,
  HEALTH_ROLE_TEMPLATE_SQL,
  HEALTH_TEMPLATE_PIN_SQL,
  HEALTH_TEMPLATE_POINTS_SQL,
  HEALTH_TEMPLATE_SQL,
  HEALTH_TEMPLATE_VERIFY_SQL,
  ROLE_TEMPLATE_CODE_EXPR,
  seedAssetTemplateHealth,
} from "./asset-template-health-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const WRITE_STATEMENTS = [
  HEALTH_TEMPLATE_SQL,
  HEALTH_TEMPLATE_POINTS_SQL,
  HEALTH_TEMPLATE_PIN_SQL,
  HEALTH_ROLE_TEMPLATE_SQL,
  HEALTH_ROLE_TEMPLATE_POINTS_SQL,
  HEALTH_ROLE_TEMPLATE_PIN_SQL,
  HEALTH_ROLE_TEMPLATE_REPIN_SQL,
];

/**
 * The five names `E1.3` pins the presentation to (ADR 0050 Context).
 *
 * Listed here rather than derived from the export, so that this file is a second
 * statement of the requirement and not an echo of it. Whether the list is a
 * *valid* band list is not asserted here — `packages/db` cannot import
 * `templateHealthSchema`, and the API-side spec parses the same literal with it.
 */
export function assertTheClientsFiveBandsAreSeeded(): void {
  expect(HEALTH_BANDS.map((band) => band.label)).toEqual([
    "Excellent",
    "Good",
    "Fair",
    "Poor",
    "Critical",
  ]);
  expect(HEALTH_BASELINE_CONTENT.health?.bands).toHaveLength(5);
}

/**
 * A domain baseline weights nothing, and the seed must not start.
 *
 * An omitted weight is `1.0` (ADR 0050 Amendment 1 decision 3). A weight is also
 * a *reference* — `collectContentPointRefs` walks `health.weights`' keys and
 * `publish()` refuses one naming a point the template does not declare — so a
 * weight added here silently acquires a second thing to keep in step with the
 * catalog the points are read from.
 */
export function assertTheBaselineWeightsNothing(): void {
  expect(HEALTH_BASELINE_CONTENT.health?.weights).toBeUndefined();
  expect(HEALTH_BASELINE_CONTENT.contentVersion).toBe(1);
}

/**
 * A re-seed must not fail, and must never rewrite a published version.
 *
 * `DO NOTHING` rather than `DO UPDATE` for the second reason: ADR 0015 makes a
 * published version immutable, and an asset pins the *version*. A seed that
 * overwrote `content` would give every pinned asset different bands without
 * anything in the audit trail saying so — the one guarantee `assets.template_id`
 * exists to give, removed by a re-run of `pnpm db:seed`.
 */
export function assertReSeedingNeverRewritesAPublishedVersion(): void {
  expect(HEALTH_TEMPLATE_SQL).toContain("ON CONFLICT (organization_id, code, version) DO NOTHING");
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("ON CONFLICT (template_id, point_key) DO NOTHING");
  expect(HEALTH_ROLE_TEMPLATE_SQL).toContain("ON CONFLICT (organization_id, code, version) DO NOTHING");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain("ON CONFLICT (template_id, point_key) DO NOTHING");
  for (const sql of WRITE_STATEMENTS) {
    expect(sql).not.toContain("DO UPDATE");
  }
}

/**
 * The pin owns its own existence, never its target.
 *
 * `template_id IS NULL` is what lets an operator migrate an asset to another
 * template through ADR 0039's explicit, previewed and audited path and keep that
 * pin across a re-seed. Without the guard the seed silently reverses every such
 * migration, and does it in the step furthest from where anyone would look.
 */
export function assertThePinNeverReversesAnOperatorsMigration(): void {
  expect(HEALTH_TEMPLATE_PIN_SQL).toContain("a.template_id IS NULL");
  expect(HEALTH_ROLE_TEMPLATE_PIN_SQL).toContain("a.template_id IS NULL");
}

/**
 * An asset is never pinned to another domain's template.
 *
 * No database constraint holds this: `assets_template_id_asset_templates_id_fk`
 * checks that the template *exists*, not that it belongs to the asset's domain.
 * ADR 0031 Amendment 1 ruled the same pair in the other direction — instantiate
 * copies the template's domain onto the asset — so a cross-domain pin is a state
 * the product has already decided cannot happen, held here by the statement that
 * could create it and by the post-condition that reads it back.
 */
export function assertNoAssetIsPinnedAcrossDomains(): void {
  expect(HEALTH_TEMPLATE_PIN_SQL).toContain("t.domain = a.domain");
  expect(HEALTH_ROLE_TEMPLATE_PIN_SQL).toContain("t.domain = a.domain");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("dom.domain = a.domain");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("role_t.domain = a.domain");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("t.id = a.template_id AND t.domain = a.domain");
}

/**
 * Every statement is bounded to one organization.
 *
 * Not a style point, and the precedent is a measured one: `F4.69`'s row records
 * that an unbounded seed statement turned the hierarchy verify red one step
 * later, when it asserted PHE's `asset_points` count exactly. Since `F4.170` it
 * checks only that the catalog's points are present, so it no longer sees an
 * extra row; these text gates are the guard. The same applies here — an
 * unbounded pin would give PHE's pilot assets an ESKOM template.
 */
export function assertEveryStatementIsBoundedToOneOrganization(): void {
  expect(HEALTH_TEMPLATE_SQL).toContain("a.organization_id = $1");
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("ap.organization_id = $1");
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("t.organization_id = $1");
  expect(HEALTH_TEMPLATE_PIN_SQL).toContain("a.organization_id = $1");
  expect(HEALTH_TEMPLATE_PIN_SQL).toContain("t.organization_id = $1");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("a.organization_id = $1");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("t.organization_id = $1");
  expect(HEALTH_ROLE_TEMPLATE_SQL).toContain("a.organization_id = $1");
  expect(HEALTH_ROLE_TEMPLATE_SQL).toContain("ap.organization_id = $1");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain("ap.organization_id = $1");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain("t.organization_id = $1");
  expect(HEALTH_ROLE_TEMPLATE_PIN_SQL).toContain("a.organization_id = $1");
  expect(HEALTH_ROLE_TEMPLATE_PIN_SQL).toContain("t.organization_id = $1");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("a.organization_id = $1");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("dom.organization_id = $1");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("role_t.organization_id = $1");
  // `asset_group_members` has no organization column: the role is read through
  // `agm.asset_id = a.id`, and `a` is bounded above in every statement.
  expect(ROLE_TEMPLATE_CODE_EXPR).toContain("agm.asset_id = a.id");
}

/**
 * The declared points claim no wiring.
 *
 * These templates carry bands for assets that already exist; they are not wiring
 * templates. A literal `source_data_key_pattern` has no `{asset_code}` token, so
 * instantiating two assets from one would map both onto one telemetry stream —
 * the aliasing `asset-templates-instantiate.service.ts` reserves `asset_code` to
 * prevent — and a `{asset_code}` pattern would claim a key `apps/sim` does not
 * write. `required = false` with a NULL pattern makes `planAsset` skip the point
 * and report it, which is the only honest third option.
 */
export function assertTheDeclaredPointsClaimNoWiring(): void {
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("source_data_key_pattern");
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("  NULL,\n  false,\n  0");
  expect(HEALTH_TEMPLATE_POINTS_SQL).not.toContain("{asset_code}");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain("  NULL,\n  false,\n  0");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).not.toContain("{asset_code}");
}

/**
 * Points are `measured`, which is what keeps this row out of ADR 0039's merge.
 *
 * `calc-definitions.service` joins `template_points` with `WHERE kind =
 * 'derived'`, so a measured declaration gives `coalesce(asset_points.<col>,
 * template_points.<col>)` no right-hand side and changes no asset's calc
 * configuration. A `derived` point here would silently enrol 148 assets in the
 * calc engine, and would need a formula the seed has no reason to invent.
 *
 * **And the engine's own outputs never become measured declarations (`F2.8`).**
 * `CalcWriteService` creates a `source_kind = 'computed'` catalog row for
 * `site_kw`, `it_kw` and `pue` on each incomer the first time it writes them.
 * Without the `computed` predicate, the next `compose up` — which re-runs this
 * seed — would read those rows back and declare the three outputs as MEASURED
 * points on `BASELINE-ELECTRICAL`, the template the other 41 electrical assets
 * stay pinned to. The predicate is the one thing that keeps the engine from
 * feeding its results back into a baseline through the seed.
 */
export function assertTheDeclaredPointsAreMeasuredAndNotDerived(): void {
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("'measured'");
  expect(HEALTH_TEMPLATE_POINTS_SQL).not.toContain("'derived'");
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("ap.source_kind <> 'computed'");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain("'measured'");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).not.toContain("'derived'");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain("ap.source_kind <> 'computed'");
}

/**
 * The insert and its post-condition must select the same templates.
 *
 * The check finds the rows it verifies **by** `asset_type`, so an insert that
 * wrote a different one would leave the post-condition inspecting zero rows and
 * reporting a success it has not established — the failure mode the
 * post-condition exists to prevent, reintroduced one statement over. Exactly the
 * drift `ruled-point-catalog-seed` shares one predicate to avoid.
 */
export function assertTheInsertAndTheVerifySelectTheSameTemplates(): void {
  expect(HEALTH_TEMPLATE_SQL).toContain("'baseline'");
  expect(HEALTH_ROLE_TEMPLATE_SQL).toContain("'baseline'");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("t.asset_type = 'baseline'");
}

/**
 * The post-condition reads back the two states that make `resolveBand` return
 * `null`, and the one `publish()` refuses.
 *
 * This is the gate a static test of the literal cannot give: the write is SQL,
 * so a health block the API would reject still lands, `parseHealth` returns
 * `undefined`, every band is `null`, and the donut stays exactly as empty as it
 * was — while the seed reports success.
 */
export function assertTheVerifyReadsBackWhatMakesABandNull(): void {
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("jsonb_array_length(t.content -> 'health' -> 'bands')");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain(
    "(t.content -> 'health' -> 'bands' -> -1 ->> 'minScore')::numeric IS DISTINCT FROM 0",
  );
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("t.status <> 'published'");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("FROM bms.template_points tp");
}

/**
 * `F2.32` (ADR 0058 Amendment 3): a role template declares the keys of its own
 * class, never the domain's union.
 *
 * The class is the asset's `bms.asset_group_members.role` (`min(role)` when it
 * holds several, so the choice is deterministic). The points statement must
 * reach the template through that role.
 */
export function assertARoleTemplateIsBuiltFromItsOwnClassOnly(): void {
  expect(ROLE_TEMPLATE_CODE_EXPR).toContain("min(agm.role)");
  expect(ROLE_TEMPLATE_CODE_EXPR).toContain("FROM bms.asset_group_members agm");
  expect(ROLE_TEMPLATE_CODE_EXPR).toContain("agm.asset_id = a.id");
  expect(ROLE_TEMPLATE_CODE_EXPR).toContain("'BASELINE-' || upper(a.domain) || '-'");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain(`t.code = ${ROLE_TEMPLATE_CODE_EXPR}`);
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain("DISTINCT ON (t.id, ap.point_key)");
}

/**
 * The template insert and the points insert decide "this class has a template"
 * by the same rule: one of its active assets carries an active, non-computed
 * point. If they disagreed, a pointless role template would trip `unusable` and
 * stop the boot.
 */
export function assertARoleTemplateIsWrittenOnlyForAClassWithPoints(): void {
  expect(HEALTH_ROLE_TEMPLATE_SQL).toContain("ap.active = true");
  expect(HEALTH_ROLE_TEMPLATE_SQL).toContain("ap.source_kind <> 'computed'");
  expect(HEALTH_ROLE_TEMPLATE_SQL).toContain("a.active = true");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain("ap.active = true");
  expect(HEALTH_ROLE_TEMPLATE_POINTS_SQL).toContain("a.active = true");
}

/**
 * The role pin, the re-pin and the verify find the role template by the same
 * expression the insert writes, so the four cannot drift apart.
 */
export function assertEveryRoleStatementNamesTheTemplateTheSameWay(): void {
  expect(HEALTH_ROLE_TEMPLATE_SQL).toContain(ROLE_TEMPLATE_CODE_EXPR);
  expect(HEALTH_ROLE_TEMPLATE_PIN_SQL).toContain(`t.code = ${ROLE_TEMPLATE_CODE_EXPR}`);
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain(`role_t.code = ${ROLE_TEMPLATE_CODE_EXPR}`);
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain(`role_t.code = ${ROLE_TEMPLATE_CODE_EXPR}`);
}

/**
 * The re-pin moves only an asset on version 1 of its own `BASELINE-<DOMAIN>`.
 * That predicate alone cannot tell a seed-written pin from an operator's —
 * migrate refuses no move to a lower version, and instantiation from v1 writes
 * the same pin (ADR 0058 Amendment 3) — so the bound to this run's role
 * templates below is what protects the operator. A bare
 * `template_id IS NOT NULL` would also move an asset on another code.
 */
export function assertTheRepinMovesOnlyADomainBaselineV1Pin(): void {
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("a.template_id = dom.id");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("dom.code = 'BASELINE-' || upper(a.domain)");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("dom.version = 1");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("role_t.version = 1");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).not.toContain("template_id IS NOT NULL");
}

/**
 * ADR 0058 Amendment 3 decision 4: the re-pin moves an asset only to a role
 * template THIS run inserted, so a later run, which inserts none, moves
 * nothing — even an asset an operator has put back on `BASELINE-<DOMAIN>` v1.
 * The insert returns the ids it wrote (`DO NOTHING` returns none for a row
 * that already existed), and the re-pin and the verify are bound to them. The
 * verify must share the bound: unbound, it would count the operator's legal v1
 * pin and stop the boot.
 */
export function assertTheRepinIsBoundToTheRoleTemplatesThisRunInserted(): void {
  expect(HEALTH_ROLE_TEMPLATE_SQL).toContain("DO NOTHING\nRETURNING id");
  expect(HEALTH_ROLE_TEMPLATE_REPIN_SQL).toContain("role_t.id = ANY($2::uuid[])");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("role_t.id = ANY($2::uuid[])");
}

/**
 * The verify asks the re-pin's own question with the re-pin's own predicates,
 * so a re-pin the policy silently declined is a thrown boot.
 */
export function assertTheVerifyCountsRoledAssetsLeftOnTheDomainBaseline(): void {
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("AS left_on_domain_baseline");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("dom.code = 'BASELINE-' || upper(a.domain)");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("dom.version = 1");
}

type Recorded = { sql: string; params: unknown[] | undefined };

/** The ids the fake role-template insert reports it wrote. */
const INSERTED_ROLE_TEMPLATE_IDS = ["role-t-1", "role-t-2"];

/**
 * Each write answers a distinct power of two, so a result field that read the
 * wrong statement, or summed a wrong pair, changes the total.
 */
const ROW_COUNTS = new Map<string, number>([
  [HEALTH_TEMPLATE_SQL, 1],
  [HEALTH_TEMPLATE_POINTS_SQL, 64],
  [HEALTH_ROLE_TEMPLATE_POINTS_SQL, 128],
  [HEALTH_ROLE_TEMPLATE_REPIN_SQL, 4],
  [HEALTH_ROLE_TEMPLATE_PIN_SQL, 8],
  [HEALTH_TEMPLATE_PIN_SQL, 16],
]);

/** A pool that records each statement and answers the verify with `verifyRow`. */
function recordingPool(verifyRow: Record<string, number>): { pool: pg.Pool; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql === HEALTH_TEMPLATE_VERIFY_SQL) {
        return { rows: [verifyRow], rowCount: 1 };
      }
      if (sql === HEALTH_ROLE_TEMPLATE_SQL) {
        return {
          rows: INSERTED_ROLE_TEMPLATE_IDS.map((id) => ({ id })),
          rowCount: INSERTED_ROLE_TEMPLATE_IDS.length,
        };
      }
      return { rows: [], rowCount: ROW_COUNTS.get(sql) ?? 0 };
    },
  } as unknown as pg.Pool;
  return { pool, calls };
}

const CLEAN = { unpinned: 0, unusable: 0, left_on_domain_baseline: 0 };

/**
 * The order is load-bearing. The role templates and their points must exist
 * before the re-pin or either pin reads them, and the role pin must run before
 * the domain pin, because the domain pin takes every `template_id IS NULL`
 * asset that is left.
 */
export async function assertTheStatementsRunInTheirLoadBearingOrder(): Promise<void> {
  const { pool, calls } = recordingPool(CLEAN);
  await seedAssetTemplateHealth(pool, "org-1");
  expect(calls.map((call) => call.sql)).toEqual([
    HEALTH_TEMPLATE_SQL,
    HEALTH_TEMPLATE_POINTS_SQL,
    HEALTH_ROLE_TEMPLATE_SQL,
    HEALTH_ROLE_TEMPLATE_POINTS_SQL,
    HEALTH_ROLE_TEMPLATE_REPIN_SQL,
    HEALTH_ROLE_TEMPLATE_PIN_SQL,
    HEALTH_TEMPLATE_PIN_SQL,
    HEALTH_TEMPLATE_VERIFY_SQL,
  ]);
}

/** Both template inserts take the bands as `$2`; every statement takes the org as `$1`. */
export async function assertEveryStatementGetsTheOrganizationAndTheBands(): Promise<void> {
  const { pool, calls } = recordingPool(CLEAN);
  await seedAssetTemplateHealth(pool, "org-1");
  for (const call of calls) {
    expect(call.params?.[0]).toBe("org-1");
  }
  const content = JSON.stringify(HEALTH_BASELINE_CONTENT);
  expect(calls.find((call) => call.sql === HEALTH_ROLE_TEMPLATE_SQL)?.params).toEqual(["org-1", content]);
  expect(calls.find((call) => call.sql === HEALTH_TEMPLATE_SQL)?.params).toEqual(["org-1", content]);
}

/**
 * Two template inserts (1 + 2) and two pins (8 + 16) are summed; the re-pin
 * (4) is counted on its own. The points inserts (64, 128) are in no field.
 */
export async function assertTheResultCountsEachWriteOnce(): Promise<void> {
  const { pool } = recordingPool(CLEAN);
  await expect(seedAssetTemplateHealth(pool, "org-1")).resolves.toEqual({
    templates: 3,
    pinned: 24,
    repinned: 4,
  });
}

/** The re-pin and the verify receive exactly the ids the role insert returned. */
export async function assertTheRepinAndTheVerifyGetTheInsertedRoleTemplateIds(): Promise<void> {
  const { pool, calls } = recordingPool(CLEAN);
  await seedAssetTemplateHealth(pool, "org-1");
  const bound = ["org-1", INSERTED_ROLE_TEMPLATE_IDS];
  expect(calls.find((call) => call.sql === HEALTH_ROLE_TEMPLATE_REPIN_SQL)?.params).toEqual(bound);
  expect(calls.find((call) => call.sql === HEALTH_TEMPLATE_VERIFY_SQL)?.params).toEqual(bound);
}

/** A roled asset left on its domain baseline is a thrown boot, and the message says so. */
export async function assertARoledAssetLeftOnTheDomainBaselineThrows(): Promise<void> {
  const { pool } = recordingPool({ ...CLEAN, left_on_domain_baseline: 3 });
  await expect(seedAssetTemplateHealth(pool, "org-1")).rejects.toThrow(
    /3 roled asset\(s\) are still on their domain baseline/,
  );
}

/** A clean verify row does not throw: the positive beside the case above. */
export async function assertACleanVerifyDoesNotThrow(): Promise<void> {
  const { pool } = recordingPool(CLEAN);
  await expect(seedAssetTemplateHealth(pool, "org-1")).resolves.toBeDefined();
}
