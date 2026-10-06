import { randomUUID } from "node:crypto";
import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload, OnboardingCommitResponseDto, OnboardingDraft } from "@bms/shared";

import type { AssetTemplateInstantiationService } from "../asset-templates/asset-templates-instantiate.service";
import type { InstantiateAssetsBody } from "../asset-templates/asset-templates.schema";
import type { StockAssetTemplateEntry } from "../asset-templates/stock-catalog/types";

/**
 * `F3.22` PR 2 (ADR 0091 decisions 4, 5 and 10) — the onboarding commit
 * creates, publishes and instantiates templates inside its one transaction,
 * against the real database.
 *
 * The `.test` sibling builds the real services on the real `bms_auth`,
 * `bms_tenant` and `bms_fleet` roles, seeds five draft sessions in the
 * organization of `phe-admin@bms.local`, commits each one in `beforeAll` and
 * records what it answered. Each assertion below reads one of those outcomes,
 * and every "written" or "not written" claim counts on the `bms_fleet` pool,
 * which bypasses row-level security, so a row cannot hide behind a policy.
 *
 * Every code this file writes starts with {@link TEST_CODE}, which is unique to
 * the run, and `cleanup` deletes that prefix only.
 */

/** The per-run prefix of every code this file writes. Unique per run, so two runs never delete each other's rows. */
export const TEST_CODE = `F322C-${randomUUID().slice(0, 8).toUpperCase()}`;

export const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
export const ADMIN_EMAIL = "admin@bms.local";

/** What a commit answered: the result, or the error it refused with. */
export type Outcome =
  | { readonly ok: true; readonly result: OnboardingCommitResponseDto }
  | { readonly ok: false; readonly error: unknown };

export type Fixtures = {
  readonly fleet: pg.Pool;
  readonly organizationId: string;
  readonly adminJwt: JwtPayload;
  readonly instantiation: AssetTemplateInstantiationService;
  readonly stockEntry: StockAssetTemplateEntry;
  readonly sessionIds: Readonly<Record<"authored" | "stock" | "collision" | "organization", string>>;
  readonly outcomes: Readonly<Record<"authored" | "stock" | "collision" | "organization", Outcome>>;
};

/** Codes per scenario, all under the run prefix. */
export const CODES = {
  authored: {
    location: `${TEST_CODE}-A`,
    rtu: `${TEST_CODE}-A-RTU`,
    pointKey: `${TEST_CODE}_A_PK`,
    template: `${TEST_CODE}-A-TPL`,
    plain: `${TEST_CODE}-A-PLAIN`,
    templated: [`${TEST_CODE}-A-T1`, `${TEST_CODE}-A-T2`],
    route: `${TEST_CODE}-A-ROUTE`,
  },
  stock: {
    location: `${TEST_CODE}-S`,
    rtu: `${TEST_CODE}-S-RTU`,
    template: `${TEST_CODE}-S-STK`,
    templated: `${TEST_CODE}-S-T1`,
  },
  collision: {
    location: `${TEST_CODE}-C`,
    rtu: `${TEST_CODE}-C-RTU`,
    template: `${TEST_CODE}-C-TPL`,
    plain: `${TEST_CODE}-C-PLAIN`,
    existingLocation: `${TEST_CODE}-C-HELD`,
    taken: `${TEST_CODE}-C-TAKEN`,
  },
  organization: {
    location: `${TEST_CODE}-O`,
    rtu: `${TEST_CODE}-O-RTU`,
    template: `${TEST_CODE}-O-TPL`,
    templated: `${TEST_CODE}-O-T1`,
  },
} as const;

function location(code: string): OnboardingDraft["location"] {
  return {
    code,
    slug: code.toLowerCase(),
    name: `F3.22 ${code}`,
    type: "smoc_campus",
    latitude: 0,
    longitude: 0,
  };
}

function rtu(code: string): NonNullable<OnboardingDraft["rtus"]>[number] {
  return { code, displayName: `F3.22 ${code}`, protocol: "simulator", config: {} };
}

/** I1: an authored template on a point key this draft declares, two templated assets and one plain. */
export function authoredDraft(domain: string): OnboardingDraft {
  const c = CODES.authored;
  return {
    location: location(c.location),
    rtus: [rtu(c.rtu)],
    pointKeys: [{ code: c.pointKey, name: "F3.22 authored point key" }],
    templates: [
      {
        code: c.template,
        name: "F3.22 authored template",
        domain,
        points: [{ pointKey: c.pointKey, sourceDataKeyPattern: "{asset_code}_PK" }],
      },
    ],
    assets: [
      { rtuIndex: 0, code: c.plain, name: "Plain", siteName: "F3.22 Site", domain },
      ...c.templated.map((code) => ({
        rtuIndex: 0,
        code,
        name: `Templated ${code}`,
        siteName: "F3.22 Site",
        domain,
        template: { code: c.template },
      })),
    ],
    assetPoints: [{ assetIndex: 0, pointKey: c.pointKey, sourceDataKey: `${c.plain}_RAW` }],
  } as OnboardingDraft;
}

/**
 * I2: the shipped stock entry under this run's code, with a pattern for every
 * measured point (Q1 option C), and one templated asset.
 */
export function stockDraft(entry: StockAssetTemplateEntry): OnboardingDraft {
  const c = CODES.stock;
  const patterns = Object.fromEntries(
    entry.points
      .filter((point) => (point.kind ?? "measured") === "measured")
      .map((point, index) => [point.pointKey, `{asset_code}_P${index}`]),
  );
  return {
    location: location(c.location),
    rtus: [rtu(c.rtu)],
    onboardingMeta: { useExistingPointKeys: true },
    templates: [{ stockCode: c.template, patterns }],
    assets: [
      {
        rtuIndex: 0,
        code: c.templated,
        name: "Stock templated",
        siteName: "F3.22 Site",
        domain: entry.domain,
        template: { code: c.template },
      },
    ],
  } as OnboardingDraft;
}

/** I3: a templated asset whose code an existing asset holds, beside a plain asset that must roll back too. */
export function collisionDraft(domain: string, pointKey: string): OnboardingDraft {
  const c = CODES.collision;
  return {
    location: location(c.location),
    rtus: [rtu(c.rtu)],
    onboardingMeta: { useExistingPointKeys: true },
    templates: [
      {
        code: c.template,
        name: "F3.22 collision template",
        domain,
        points: [{ pointKey, sourceDataKeyPattern: "{asset_code}_C" }],
      },
    ],
    assets: [
      { rtuIndex: 0, code: c.plain, name: "Plain", siteName: "F3.22 Site", domain },
      {
        rtuIndex: 0,
        code: c.taken,
        name: "Taken",
        siteName: "F3.22 Site",
        domain,
        template: { code: c.template },
      },
    ],
    assetPoints: [{ assetIndex: 0, pointKey, sourceDataKey: `${c.plain}_RAW` }],
  } as OnboardingDraft;
}

/** I4: an organization template, published before the run, onto the RTU this commit writes. */
export function organizationDraft(domain: string): OnboardingDraft {
  const c = CODES.organization;
  return {
    location: location(c.location),
    rtus: [rtu(c.rtu)],
    onboardingMeta: { useExistingPointKeys: true },
    assets: [
      {
        rtuIndex: 0,
        code: c.templated,
        name: "Organization templated",
        siteName: "F3.22 Site",
        domain,
        template: { code: c.template, version: 1 },
      },
    ],
  } as OnboardingDraft;
}

function resultOf(outcome: Outcome, label: string): OnboardingCommitResponseDto {
  if (!outcome.ok) {
    const err = outcome.error as { message?: string; getResponse?: () => unknown };
    throw new Error(
      `${label}: the commit was refused — ${err.message ?? String(outcome.error)} ` +
        JSON.stringify(err.getResponse?.() ?? null),
    );
  }
  return outcome.result;
}

async function count(pool: pg.Pool, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/** I1 — the result's template part, and the asset ids in draft order. */
export function assertTheAuthoredCommitAnswersTheTemplateCounts(fx: Fixtures): void {
  const result = resultOf(fx.outcomes.authored, "I1");
  expect(result.templateIds).toHaveLength(1);
  expect(result.templatedAssetCount).toBe(2);
  expect(result.templatedAssetPointCount).toBe(2);
  expect(result.assetIds).toHaveLength(3);
}

/** I1 — the template row is published at version 1, in this organization. */
export async function assertTheAuthoredTemplateIsPublished(fx: Fixtures): Promise<void> {
  const result = resultOf(fx.outcomes.authored, "I1");
  const { rows } = await fx.fleet.query<{ status: string; version: number; organization_id: string }>(
    `SELECT status, version, organization_id FROM bms.asset_templates WHERE id = $1`,
    [result.templateIds[0]],
  );
  expect(rows).toEqual([{ status: "published", version: 1, organization_id: fx.organizationId }]);
}

/** I1 — the templated assets carry the pin; the plain asset does not. */
export async function assertOnlyTheTemplatedAssetsCarryThePin(fx: Fixtures): Promise<void> {
  const result = resultOf(fx.outcomes.authored, "I1");
  const { rows } = await fx.fleet.query<{ code: string; template_id: string | null }>(
    `SELECT code, template_id FROM bms.assets WHERE id = ANY($1) ORDER BY code`,
    [result.assetIds],
  );
  const c = CODES.authored;
  expect(rows).toEqual(
    [
      { code: c.plain, template_id: null },
      ...c.templated.map((code) => ({ code, template_id: result.templateIds[0] })),
    ].sort((a, b) => a.code.localeCompare(b.code)),
  );
}

/** I1 — the four audit actions, all in one organization, and the commit's payload names the template. */
export async function assertTheAuthoredCommitWritesTheFourAuditActions(fx: Fixtures): Promise<void> {
  const result = resultOf(fx.outcomes.authored, "I1");
  const { rows } = await fx.fleet.query<{ action: string; organization_id: string; payload: unknown }>(
    `SELECT action, organization_id, payload FROM bms.audit_log
      WHERE entity_id = ANY($1) AND action = ANY($2)`,
    [
      [result.templateIds[0], fx.sessionIds.authored],
      [
        "master.asset_template.create",
        "master.asset_template.publish",
        "master.asset.instantiate",
        "master.onboarding.commit",
      ],
    ],
  );
  // Distinct: I5 later instantiates the same template through the route, which
  // writes a second `master.asset.instantiate` on the same entity.
  expect([...new Set(rows.map((row) => row.action))].sort()).toEqual([
    "master.asset.instantiate",
    "master.asset_template.create",
    "master.asset_template.publish",
    "master.onboarding.commit",
  ]);
  expect([...new Set(rows.map((row) => row.organization_id))]).toEqual([fx.organizationId]);
  const commitRow = rows.find((row) => row.action === "master.onboarding.commit");
  expect((commitRow?.payload as { templateIds?: string[] }).templateIds).toEqual(result.templateIds);
}

/** I2 — a stock entry is stamped with the catalog's code and version, and audited as an import. */
export async function assertTheStockEntryIsStampedAndAuditedAsAnImport(fx: Fixtures): Promise<void> {
  const result = resultOf(fx.outcomes.stock, "I2");
  const { rows } = await fx.fleet.query<{ status: string; stock_code: string; stock_version: number }>(
    `SELECT status, stock_code, stock_version FROM bms.asset_templates WHERE id = $1`,
    [result.templateIds[0]],
  );
  expect(rows).toEqual([
    { status: "published", stock_code: CODES.stock.template, stock_version: fx.stockEntry.stockVersion },
  ]);
  const { rows: audit } = await fx.fleet.query<{ action: string }>(
    `SELECT action FROM bms.audit_log WHERE entity_id = $1 AND action LIKE 'master.asset_template.%'`,
    [result.templateIds[0]],
  );
  expect(audit.map((row) => row.action).sort()).toEqual([
    "master.asset_template.import",
    "master.asset_template.publish",
  ]);
}

/** I2 — the stock entry's alarms and views seed rules and dashboards inside the same commit. */
export function assertTheStockCommitSeedsRulesAndDashboards(fx: Fixtures): void {
  const result = resultOf(fx.outcomes.stock, "I2");
  expect(result.templatedAssetCount).toBe(1);
  expect(result.seededRuleCount).toBe(fx.stockEntry.content?.alarms?.length ?? 0);
  expect(result.seededRuleCount).toBeGreaterThan(0);
  expect(result.dashboardCount).toBeGreaterThan(0);
}

/** I3 — a taken asset code refuses the commit with the core's own text. */
export function assertATakenTemplatedAssetCodeRefusesTheCommit(fx: Fixtures): void {
  const outcome = fx.outcomes.collision;
  expect(outcome.ok, "the commit must be refused").toBe(false);
  const message = outcome.ok ? "" : String((outcome.error as Error).message);
  expect(message).toContain("already exist");
  expect(message).toContain(CODES.collision.taken);
}

/** I3 — the refusal rolled back every row of the draft, and the session is still a draft. */
export async function assertTheRefusedCommitWroteNothing(fx: Fixtures): Promise<void> {
  const c = CODES.collision;
  expect(
    await count(fx.fleet, `SELECT count(*) AS n FROM bms.asset_templates WHERE code = $1`, [c.template]),
    "the template the refused commit created must roll back",
  ).toBe(0);
  expect(await count(fx.fleet, `SELECT count(*) AS n FROM bms.locations WHERE code = $1`, [c.location])).toBe(0);
  expect(await count(fx.fleet, `SELECT count(*) AS n FROM bms.rtus WHERE code = $1`, [c.rtu])).toBe(0);
  expect(await count(fx.fleet, `SELECT count(*) AS n FROM bms.assets WHERE code = $1`, [c.plain])).toBe(0);
  // The positive beside the absences: the colliding asset is the fixture's, still there.
  expect(await count(fx.fleet, `SELECT count(*) AS n FROM bms.assets WHERE code = $1`, [c.taken])).toBe(1);
  const { rows } = await fx.fleet.query<{ status: string }>(
    `SELECT status FROM bms.onboarding_sessions WHERE id = $1`,
    [fx.sessionIds.collision],
  );
  expect(rows).toEqual([{ status: "draft" }]);
}

/**
 * F3.25 (plan Q8) — every session is seeded with a checkpoint ring. A commit
 * closes the session, and there is no rollback after commit, so the close
 * writes `checkpoints = NULL`. The refused commit rolled back, so its session
 * still holds the ring: the positive that proves the seed wrote one.
 */
export const SEEDED_RING = [{ seq: 1, label: "F3.25 seeded checkpoint" }];

export async function assertTheCommitCloseClearsTheRing(fx: Fixtures): Promise<void> {
  const ring = async (id: string) =>
    (await fx.fleet.query<{ checkpoints: unknown }>(`SELECT checkpoints FROM bms.onboarding_sessions WHERE id = $1`, [id]))
      .rows;
  expect(await ring(fx.sessionIds.collision), "the refused commit keeps the seeded ring").toEqual([
    { checkpoints: SEEDED_RING },
  ]);
  expect(await ring(fx.sessionIds.authored), "the committed session's ring is cleared").toEqual([{ checkpoints: null }]);
}

/**
 * I4 (decision 5) — an `organization_admin` commits an organization template
 * onto the RTU the same commit writes. With the location check on, the auth
 * pool cannot see that location and the core answers `Target location is
 * outside your access scope`.
 */
export async function assertAnOrganizationAdminCommitsAnOrganizationTemplate(fx: Fixtures): Promise<void> {
  const result = resultOf(fx.outcomes.organization, "I4");
  expect(result.templatedAssetCount).toBe(1);
  const { rows } = await fx.fleet.query<{ code: string; rtu_id: string }>(
    `SELECT code, rtu_id FROM bms.assets WHERE id = ANY($1)`,
    [result.assetIds],
  );
  expect(rows).toEqual([{ code: CODES.organization.templated, rtu_id: result.rtuIds[0] }]);
}

/** I5 (decision 10) — one asset point per measured template point, fed by the RTU this commit wrote. */
export async function assertTemplatedAssetPointsAreFedByTheNewRtu(fx: Fixtures): Promise<void> {
  const result = resultOf(fx.outcomes.authored, "I1");
  const { rows } = await fx.fleet.query<{ code: string; n: string; rtu_ids: string[] }>(
    `SELECT a.code, count(ap.id) AS n, array_agg(DISTINCT ap.rtu_id) AS rtu_ids
       FROM bms.assets a JOIN bms.asset_points ap ON ap.asset_id = a.id
      WHERE a.code = ANY($1)
      GROUP BY a.code ORDER BY a.code`,
    [CODES.authored.templated],
  );
  expect(rows.map((row) => ({ code: row.code, n: Number(row.n), rtuIds: row.rtu_ids }))).toEqual(
    [...CODES.authored.templated].sort().map((code) => ({ code, n: 1, rtuIds: [result.rtuIds[0]] })),
  );
}

/**
 * I5 — a templated asset point from the commit fills the same columns as one
 * the instantiate route writes onto the same RTU after the commit. The route is
 * the other door to the same core, so the two must not differ.
 */
export async function assertTheCommitAndTheRouteWriteTheSameColumns(fx: Fixtures): Promise<void> {
  const result = resultOf(fx.outcomes.authored, "I1");
  await fx.instantiation.instantiate(fx.adminJwt, result.templateIds[0] as string, {
    target: { kind: "rtu", rtuId: result.rtuIds[0] },
    assets: [{ code: CODES.authored.route, name: "Route" }],
  } as unknown as InstantiateAssetsBody);
  const filled = async (code: string): Promise<string[]> => {
    const { rows } = await fx.fleet.query<Record<string, unknown>>(
      `SELECT ap.* FROM bms.asset_points ap JOIN bms.assets a ON a.id = ap.asset_id WHERE a.code = $1`,
      [code],
    );
    expect(rows, `one point on ${code}`).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    return Object.keys(row)
      .filter((key) => row[key] !== null)
      .sort();
  };
  expect(await filled(CODES.authored.templated[0])).toEqual(await filled(CODES.authored.route));
}

/**
 * Deletes every row this file can have written, children first, by the run
 * prefix. `dashboards.asset_template_id` has no cascade (ADR 0067 decision 1),
 * so the dashboards go before the templates; the audit rows go by the ids the
 * run recorded.
 */
export async function cleanup(
  pool: pg.Pool,
  ids: { readonly auditEntityIds: readonly string[]; readonly sessionIds: readonly string[] },
): Promise<void> {
  const assetScope = `SELECT id FROM bms.assets WHERE code LIKE $1`;
  const dashboardScope = `SELECT id FROM bms.dashboards WHERE asset_id IN (${assetScope})`;
  await pool.query(
    `DELETE FROM bms.dashboard_widget_points
      WHERE widget_id IN (SELECT id FROM bms.dashboard_widgets WHERE dashboard_id IN (${dashboardScope}))`,
    [`${TEST_CODE}%`],
  );
  await pool.query(`DELETE FROM bms.dashboard_widgets WHERE dashboard_id IN (${dashboardScope})`, [
    `${TEST_CODE}%`,
  ]);
  await pool.query(`DELETE FROM bms.dashboards WHERE asset_id IN (${assetScope})`, [`${TEST_CODE}%`]);
  await pool.query(`DELETE FROM bms.automation_rules WHERE asset_id IN (${assetScope})`, [
    `${TEST_CODE}%`,
  ]);
  await pool.query(`DELETE FROM bms.asset_points WHERE asset_id IN (${assetScope})`, [`${TEST_CODE}%`]);
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  // template_points cascade on the foreign key.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  await pool.query(
    `DELETE FROM bms.rtu_connection_configs WHERE rtu_id IN (SELECT id FROM bms.rtus WHERE code LIKE $1)`,
    [`${TEST_CODE}%`],
  );
  await pool.query(`DELETE FROM bms.rtus WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  await pool.query(`DELETE FROM bms.point_keys WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  await pool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  if (ids.auditEntityIds.length > 0) {
    await pool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [ids.auditEntityIds]);
  }
  if (ids.sessionIds.length > 0) {
    await pool.query(`DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)`, [ids.sessionIds]);
  }
}
