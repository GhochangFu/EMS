import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { AdminAssetTemplateDto, AssetInstantiationResultDto, JwtPayload } from "@bms/shared";

import type { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import type { Fixtures as BaseFixtures } from "./asset-templates.instantiate.integration.spec";
import type { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * `F3.2` / ADR 0067 decisions 3, 4 and 5 — the per-asset default dashboards, as
 * **database** outcomes.
 *
 * A new pair rather than cases added to `asset-templates.instantiate.integration.spec.ts`
 * (830 lines, AGENTS.md §4.5's cap is 1000), and a new fixture rather than that
 * suite's: this one needs a template whose `content.dashboards` carries both
 * branches of `planView` — an authored `widgets[]` view and a `featured`-only
 * view — and a point that is declared, optional and **unresolvable**, so that a
 * widget reports `partial` and a fallback tile reports `unresolved` on real rows.
 *
 * Every expectation is computed with **independent SQL through the fixture
 * pool**, never read back from the service's own return value, and the two are
 * then compared (G1c). A report that says `boundPoints: 2` while two rows exist
 * is the only interesting kind of wrong here, and asserting the DTO against
 * itself would never see it.
 *
 * **Codes carry a `randomUUID` suffix, and the suffix is in the declaration
 * itself.** `assets.code` is globally unique and `dashboards.slug` is unique per
 * organization, so two concurrent instances of this file would collide on the
 * slug rather than on anything the feature does — and, worse, each `DELETE` in
 * {@link cleanup} would sweep the other's committed rows.
 * `tests/integration-fixture-isolation.test.ts` is the gate, and it reads the
 * DECLARATION of the constant named in the `LIKE` argument, which is why
 * `randomUUID()` is called there rather than through an intermediate `RUN`.
 */

export const TEST_TEMPLATE_CODE = `F32-DASH-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
export const TEST_ASSET_PREFIX = `F32-DASH-${randomUUID().slice(0, 8).toUpperCase()}-`;

/** The `content.dashboards` keys this fixture declares, in record order. */
const VIEW_OVERVIEW = "overview";
const VIEW_TRENDS = "trends";

export type Services = {
  templates: AssetTemplatesAdminService;
  /** Takes the **wire-shape** payload, parsed through the real schema. */
  instantiate: (
    jwt: JwtPayload,
    templateId: string,
    body: unknown,
  ) => Promise<AssetInstantiationResultDto>;
  dashboards: AssetDashboardsInstantiateService;
};

export type Fixtures = BaseFixtures & {
  /** A live rule category and severity, so the fixture can carry one alarm. */
  categoryCode: string;
  severityCode: string;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectRejection(
  run: () => Promise<unknown>,
  match: RegExp,
  what: string,
): Promise<void> {
  let message: string | null = null;
  try {
    await run();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message !== null, `${what}: expected a rejection, but the call succeeded`);
  assert(
    match.test(message ?? ""),
    `${what}: rejected with "${message}", which does not match ${match}`,
  );
}

/** The rejection's **class**, which `expectRejection`'s message match cannot see. */
async function expectRejectionNamed(
  run: () => Promise<unknown>,
  className: string,
  what: string,
): Promise<void> {
  let name: string | null = null;
  try {
    await run();
  } catch (err) {
    name = err instanceof Error ? err.constructor.name : String(err);
  }
  assert(name !== null, `${what}: expected a rejection, but the call succeeded`);
  assert(name === className, `${what}: expected a ${className}, got a ${name}`);
}

export async function loadDashboardFixtures(
  pool: pg.Pool,
  base: BaseFixtures,
): Promise<Fixtures> {
  const { rows: categories } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.rule_categories WHERE active = true ORDER BY sort_order, code LIMIT 1`,
  );
  const { rows: severities } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.alarm_severities WHERE active = true ORDER BY rank, code LIMIT 1`,
  );
  const categoryCode = categories[0]?.code;
  const severityCode = severities[0]?.code;
  if (!categoryCode || !severityCode) {
    throw new Error(
      "F3.2 fixtures missing — need one live rule category and one live alarm severity. " +
        "Run 'pnpm db:seed'.",
    );
  }
  return { ...base, categoryCode, severityCode };
}

/**
 * Deletes only this run's rows, children before parents.
 *
 * The order is not house style. `dashboards.asset_template_id` has **no**
 * cascade (ADR 0067 decision 1), so a surviving stamped dashboard makes the
 * `asset_templates` delete fail with a raw foreign-key error; and
 * `dashboards.asset_id` cascades, so deleting the assets first would remove the
 * very rows the failure of a later case needs to be visible in.
 */
export async function cleanup(pool: pg.Pool): Promise<void> {
  const dashboardScope = `SELECT id FROM bms.dashboards WHERE slug LIKE $1`;
  const slugLike = `${TEST_ASSET_PREFIX.toLowerCase()}%`;

  await pool.query(
    `DELETE FROM bms.dashboard_widget_points
      WHERE widget_id IN (SELECT id FROM bms.dashboard_widgets
                           WHERE dashboard_id IN (${dashboardScope}))`,
    [slugLike],
  );
  await pool.query(
    `DELETE FROM bms.dashboard_widgets WHERE dashboard_id IN (${dashboardScope})`,
    [slugLike],
  );
  await pool.query(`DELETE FROM bms.dashboards WHERE slug LIKE $1`, [slugLike]);
  await pool.query(
    `DELETE FROM bms.automation_rules
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)
         OR source_template_id IN (SELECT id FROM bms.asset_templates WHERE code LIKE $2)`,
    [`${TEST_ASSET_PREFIX}%`, `${TEST_TEMPLATE_CODE}%`],
  );
  await pool.query(
    `DELETE FROM bms.asset_points WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [
    `${TEST_TEMPLATE_CODE}%`,
  ]);
}

/** The four declared points; `[2]` is optional with **no** pattern, so it is skipped. */
function fixturePoints(fx: Fixtures) {
  return [
    {
      pointKey: fx.pointKeys[0].code,
      kind: "measured" as const,
      required: true,
      sortOrder: 0,
      sourceDataKeyPattern: "{asset_code}_P0",
    },
    {
      pointKey: fx.pointKeys[1].code,
      kind: "measured" as const,
      required: true,
      sortOrder: 1,
      sourceDataKeyPattern: "{asset_code}_P1",
    },
    {
      pointKey: fx.pointKeys[2].code,
      kind: "measured" as const,
      required: false,
      sortOrder: 2,
    },
    {
      pointKey: fx.pointKeys[3].code,
      kind: "measured" as const,
      required: true,
      sortOrder: 3,
      sourceDataKeyPattern: "{asset_code}_P3",
    },
  ];
}

function tile(pointKey: string, index: number) {
  return {
    title: `Tile ${index}`,
    widgetType: "value_tile" as const,
    pointKeys: [pointKey],
    config: {},
    gridX: index * 3,
    gridY: 0,
    gridW: 3,
    gridH: 2,
  };
}

/** The published fixture: one authored view, one `featured`-only view, one alarm. */
export async function publishFixtureTemplate(
  svc: Services,
  fx: Fixtures,
  code = TEST_TEMPLATE_CODE,
): Promise<AdminAssetTemplateDto> {
  const [k0, k1, k2, k3] = fx.pointKeys.map((row) => row.code);
  const draft = await svc.templates.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code,
    name: "Default Dashboards Fixture",
    assetType: "test_skid",
    domain: "water",
    points: fixturePoints(fx),
    content: {
      contentVersion: 1,
      alarms: [
        {
          code: "DASH_FIXTURE_HIGH",
          pointKey: k0,
          operator: "gt",
          thresholdValue: 9,
          severity: fx.severityCode,
          message: "Fixture point above the class limit",
          category: fx.categoryCode,
        },
      ],
      dashboards: {
        [VIEW_OVERVIEW]: {
          featured: [k0, k1, k2, k3],
          widgets: [
            tile(k0, 0),
            tile(k1, 1),
            {
              title: "Fixture trend",
              widgetType: "chart" as const,
              // Three keys, one of which (`k2`) never becomes an `asset_points`
              // row — this is the widget that must report `partial`.
              pointKeys: [k0, k1, k2],
              config: { series: "line" as const },
              gridX: 0,
              gridY: 2,
              gridW: 12,
              gridH: 4,
            },
          ],
        },
        // No `widgets` — the `featured` fallback, with the unresolvable key last
        // so its tile reports `unresolved` beside a tile that binds.
        [VIEW_TRENDS]: { featured: [k3, k2] },
      },
    },
  });
  return svc.templates.publish(fx.adminJwt, draft.id);
}

/** A second published template of the same shape whose content declares **no** `dashboards`. */
export async function publishPlainTemplate(
  svc: Services,
  fx: Fixtures,
): Promise<AdminAssetTemplateDto> {
  const draft = await svc.templates.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: `${TEST_TEMPLATE_CODE}-PLAIN`,
    name: "No Dashboards Fixture",
    assetType: "test_skid",
    domain: "water",
    points: fixturePoints(fx),
    content: { contentVersion: 1 },
  });
  return svc.templates.publish(fx.adminJwt, draft.id);
}

type DashboardRow = {
  id: string;
  slug: string;
  name: string;
  asset_id: string | null;
  asset_template_id: string | null;
  template_id: string | null;
  location_id: string | null;
  asset_group_id: string | null;
  organization_id: string;
};

/** Every dashboard this run wrote, by independent SQL, in slug order. */
async function dashboardsOf(pool: pg.Pool, assetCode: string): Promise<DashboardRow[]> {
  const { rows } = await pool.query<DashboardRow>(
    `SELECT d.id, d.slug, d.name, d.asset_id, d.asset_template_id, d.template_id,
            d.location_id, d.asset_group_id, d.organization_id
       FROM bms.dashboards d JOIN bms.assets a ON a.id = d.asset_id
      WHERE a.code = $1 ORDER BY d.slug`,
    [assetCode],
  );
  return rows;
}

async function widgetCountOf(pool: pg.Pool, dashboardId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.dashboard_widgets WHERE dashboard_id = $1`,
    [dashboardId],
  );
  return Number(rows[0].n);
}

async function pointRowsOf(
  pool: pg.Pool,
  dashboardId: string,
): Promise<{ grid_x: number; grid_y: number; widget_type: string; points: number }[]> {
  const { rows } = await pool.query<{
    grid_x: number;
    grid_y: number;
    widget_type: string;
    points: string;
  }>(
    `SELECT w.grid_x, w.grid_y, w.widget_type,
            (SELECT COUNT(*) FROM bms.dashboard_widget_points p WHERE p.widget_id = w.id)::text
              AS points
       FROM bms.dashboard_widgets w WHERE w.dashboard_id = $1
      ORDER BY w.grid_y, w.grid_x`,
    [dashboardId],
  );
  return rows.map((row) => ({
    grid_x: row.grid_x,
    grid_y: row.grid_y,
    widget_type: row.widget_type,
    points: Number(row.points),
  }));
}

async function countAssets(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.assets WHERE code LIKE $1`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  return Number(rows[0].n);
}

/**
 * G1, G1b and G1c — one asset, two views, and the report checked against the
 * rows rather than against itself.
 */
export async function assertOneAssetGetsBothViews(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  template: AdminAssetTemplateDto,
): Promise<void> {
  const code = `${TEST_ASSET_PREFIX}G1`;
  const result = await svc.instantiate(fx.adminJwt, template.id, {
    rtuId: fx.rtuId,
    assets: [{ code, name: "Dashboard Skid G1" }],
  });

  const rows = await dashboardsOf(pool, code);
  assert(rows.length === 2, `expected 2 dashboard rows for ${code}, found ${rows.length}`);

  const slug = code.toLowerCase();
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const overview = bySlug.get(`${slug}-${VIEW_OVERVIEW}`);
  const trends = bySlug.get(`${slug}-${VIEW_TRENDS}`);
  assert(
    overview !== undefined && trends !== undefined,
    `slugs must be <code>-<view>; found ${rows.map((row) => row.slug).join(", ")}`,
  );

  for (const row of rows) {
    assert(
      row.asset_template_id === template.id,
      `${row.slug}: must carry the version stamp ${template.id}, got ${row.asset_template_id}`,
    );
    assert(
      row.template_id === null && row.location_id === null && row.asset_group_id === null,
      `${row.slug}: the other scope and stamp columns must stay NULL`,
    );
    assert(
      row.organization_id === fx.organizationId,
      `${row.slug}: must be stamped with the template's organization`,
    );
  }

  assert(
    (await widgetCountOf(pool, (overview as DashboardRow).id)) === 3,
    "the authored view must write one widget per template widget (3)",
  );
  assert(
    (await widgetCountOf(pool, (trends as DashboardRow).id)) === 2,
    "the featured fallback must write one tile per featured key (2)",
  );

  // The DTO, and only now that the rows have been counted independently.
  const asset = result.assets[0];
  assert(asset !== undefined, "the result must carry the asset it built");
  assert(
    asset.dashboards.length === 2,
    `the per-asset DTO must report 2 views, got ${asset.dashboards.length}`,
  );
  assert(
    result.dashboardCount === 2,
    `dashboardCount must be 2, got ${result.dashboardCount}`,
  );
  // Sorted by view name, NOT by the order the author typed: `content` is
  // `jsonb` and Postgres does not keep object key order (it stores by key
  // length, then bytewise, so this fixture comes back `trends, overview`). The
  // service states the order instead of inheriting that one — see its docblock.
  assert(
    asset.dashboards.map((entry) => entry.view).join(",") === `${VIEW_OVERVIEW},${VIEW_TRENDS}`,
    `views must be reported in view-name order, got ${asset.dashboards.map((e) => e.view).join(",")}`,
  );

  // G1b — the chart is `partial` and keyed by its position in the view.
  const overviewReport = asset.dashboards[0];
  assert(overviewReport !== undefined, "the overview report must exist");
  const chart = overviewReport.resolutions[2];
  assert(chart !== undefined, "the overview report must carry a resolution per widget");
  assert(
    chart.widgetKey === `${VIEW_OVERVIEW}#2`,
    `the chart's widgetKey must be "${VIEW_OVERVIEW}#2", got "${chart.widgetKey}"`,
  );
  assert(
    chart.outcome === "partial",
    `a widget whose third key has no asset point is "partial", got "${chart.outcome}"`,
  );
  assert(chart.boundPoints === 2, `the chart must bind 2 points, reported ${chart.boundPoints}`);
  assert(
    overviewReport.omittedFeatured === 0,
    "an authored view omits no featured key — the fallback did not run",
  );

  const trendsReport = asset.dashboards[1];
  assert(trendsReport !== undefined, "the trends report must exist");
  assert(
    trendsReport.resolutions.map((entry) => entry.outcome).join(",") === "bound,unresolved",
    `the fallback's second tile names the unresolvable key: got ` +
      `${trendsReport.resolutions.map((entry) => entry.outcome).join(",")}`,
  );

  // G1c — the DB's own count of the chart's bindings, against the report.
  const overviewWidgets = await pointRowsOf(pool, (overview as DashboardRow).id);
  const chartRow = overviewWidgets.find((row) => row.widget_type === "chart");
  assert(chartRow !== undefined, "the authored chart must have been written as a chart widget");
  assert(
    (chartRow as { points: number }).points === chart.boundPoints,
    `the chart has ${(chartRow as { points: number }).points} dashboard_widget_points rows but ` +
      `the report claims ${chart.boundPoints}`,
  );
  assert(
    (chartRow as { points: number }).points === 2,
    "the chart must bind exactly the two keys that resolved",
  );
  assert(
    overviewWidgets.reduce((total, row) => total + row.points, 0) === overviewReport.boundPoints,
    "the view's boundPoints must equal the dashboard_widget_points rows it wrote",
  );

  // The fallback's lattice and its unresolved tile, on the rows.
  const trendsWidgets = await pointRowsOf(pool, (trends as DashboardRow).id);
  assert(
    trendsWidgets.map((row) => `${row.widget_type}@${row.grid_x},${row.grid_y}:${row.points}`)
      .join(" ") === "value_tile@0,0:1 value_tile@3,0:0",
    `the fallback lays 3-wide tiles from (0,0) and the unresolvable key binds nothing; got ` +
      trendsWidgets
        .map((row) => `${row.widget_type}@${row.grid_x},${row.grid_y}:${row.points}`)
        .join(" "),
  );
}

/** G1d — the audit row is the durable record, so it carries the count too. */
export async function assertInstantiateAuditCarriesDashboardCount(
  pool: pg.Pool,
  template: AdminAssetTemplateDto,
): Promise<void> {
  const { rows } = await pool.query<{ payload: { dashboardCount?: number } }>(
    `SELECT payload FROM bms.audit_log
      WHERE action = 'master.asset.instantiate' AND entity_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [template.id],
  );
  const payload = rows[0]?.payload;
  assert(payload !== undefined, "the instantiate audit row must exist");
  assert(
    payload.dashboardCount === 2,
    `the audit payload must carry dashboardCount 2, got ${String(payload.dashboardCount)}`,
  );
}

/** G1e — a template with no `dashboards` key writes nothing and reports nothing. */
export async function assertTemplateWithoutDashboardsWritesNone(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  plain: AdminAssetTemplateDto,
): Promise<void> {
  const code = `${TEST_ASSET_PREFIX}G1E`;
  const result = await svc.instantiate(fx.adminJwt, plain.id, {
    rtuId: fx.rtuId,
    assets: [{ code, name: "Dashboard Skid G1e" }],
  });
  assert(
    result.dashboardCount === 0,
    `dashboardCount must be 0 with no dashboards key, got ${result.dashboardCount}`,
  );
  assert(
    result.assets[0]?.dashboards.length === 0,
    "the per-asset DTO must report no views when the template declares none",
  );
  const rows = await dashboardsOf(pool, code);
  assert(rows.length === 0, `expected no dashboard rows, found ${rows.length}`);
}

/**
 * G1f — a slug already taken rolls the WHOLE batch back.
 *
 * The hand-made dashboard is inserted with the exact slug the first view would
 * derive, then removed here, so the count afterwards is over this run's prefix
 * alone and cannot be satisfied by the collision row itself.
 */
export async function assertSlugCollisionRollsBackTheBatch(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  template: AdminAssetTemplateDto,
): Promise<void> {
  const code = `${TEST_ASSET_PREFIX}G1F`;
  // The **last** view in write order, not the first. Colliding on the first
  // would fail before any dashboard row was written, and the count below would
  // be zero because nothing ran rather than because anything rolled back —
  // which is exactly the "partial batch" mutation this case names.
  const slug = `${code.toLowerCase()}-${VIEW_TRENDS}`;
  const before = await countAssets(pool);
  await pool.query(
    `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3)`,
    [fx.organizationId, slug, "Hand-made collision"],
  );
  try {
    await expectRejection(
      () =>
        svc.instantiate(fx.adminJwt, template.id, {
          rtuId: fx.rtuId,
          assets: [{ code, name: "Dashboard Skid G1f" }],
        }),
      new RegExp(slug),
      // Matching the TRENDS slug is also what proves the run reached the second
      // view: had the first view failed, the message would name `-overview` and
      // this regex would not match. The counts below are therefore a rollback
      // claim about rows that existed, not about rows that were never written.
      "a taken slug must be refused with a message naming it",
    );
    assert(
      (await countAssets(pool)) === before,
      "a refused batch must leave no asset behind — the whole transaction rolls back",
    );
    const { rows: ruleRows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms.automation_rules
        WHERE asset_id IN (SELECT id FROM bms.assets WHERE code = $1)`,
      [code],
    );
    assert(Number(ruleRows[0].n) === 0, "a refused batch must leave no seeded rule behind");
    const { rows: dashRows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms.dashboards WHERE slug LIKE $1 AND slug <> $2`,
      [`${code.toLowerCase()}%`, slug],
    );
    assert(
      Number(dashRows[0].n) === 0,
      `the earlier view's dashboard must be rolled back too, found ${dashRows[0].n}`,
    );
    const { rows: widgetRows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms.dashboard_widgets w
         JOIN bms.dashboards d ON d.id = w.dashboard_id
        WHERE d.slug LIKE $1`,
      [`${code.toLowerCase()}%`],
    );
    assert(
      Number(widgetRows[0].n) === 0,
      `the earlier view's widgets must be rolled back too, found ${widgetRows[0].n}`,
    );
  } finally {
    await pool.query(`DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`, [
      fx.organizationId,
      slug,
    ]);
  }
}

/**
 * G2 and G2b — the backfill creates for the unstamped, skips the stamped, and
 * stamps from the version it was asked for rather than from the one the asset
 * is pinned to.
 */
export async function assertBackfillCreatesAndSkips(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  template: AdminAssetTemplateDto,
): Promise<AdminAssetTemplateDto> {
  const codes = ["G2A", "G2B", "G2C"].map((suffix) => `${TEST_ASSET_PREFIX}${suffix}`);
  await svc.instantiate(fx.adminJwt, template.id, {
    rtuId: fx.rtuId,
    assets: codes.map((code) => ({ code, name: `Backfill ${code}` })),
  });

  // Two of the three lose their defaults, which is the state the backfill
  // exists for: assets pinned to a version whose dashboards they do not have.
  for (const code of codes.slice(0, 2)) {
    await pool.query(
      `DELETE FROM bms.dashboards WHERE asset_id IN (SELECT id FROM bms.assets WHERE code = $1)`,
      [code],
    );
  }

  // A NEW version of the same code. The three assets stay pinned to v1.
  const v2Draft = await svc.templates.createDraftFrom(fx.adminJwt, template.id);
  const v2 = await svc.templates.publish(fx.adminJwt, v2Draft.id);
  assert(v2.version > template.version, "the fixture's second version must outrank the first");

  // Asserted per code, not on the totals alone: earlier cases in this file also
  // leave assets pinned to this template code, and a total that happened to
  // match would say nothing about which asset was skipped and why.
  const result = await svc.dashboards.backfill(fx.adminJwt, v2.id);
  const outcomes = new Map(result.assets.map((entry) => [entry.code, entry.outcome]));
  assert(
    outcomes.get(codes[0]) === "created" &&
      outcomes.get(codes[1]) === "created" &&
      outcomes.get(codes[2]) === "skipped_existing",
    `outcomes must follow the stamp, got ${[...outcomes].map(([c, o]) => `${c}=${o}`).join(" ")}`,
  );
  assert(
    result.createdCount === result.assets.filter((e) => e.outcome === "created").length,
    `createdCount ${result.createdCount} disagrees with the per-asset outcomes`,
  );
  assert(
    result.skippedCount === result.assets.filter((e) => e.outcome === "skipped_existing").length,
    `skippedCount ${result.skippedCount} disagrees with the per-asset outcomes`,
  );
  assert(
    result.createdCount === 2,
    `exactly the two assets whose dashboards were deleted must be created, got ${result.createdCount}`,
  );

  // G2b — an asset pinned to v1 carries **v2**'s stamp after the backfill.
  const created = await dashboardsOf(pool, codes[0]);
  assert(created.length === 2, `the backfilled asset must carry both views, got ${created.length}`);
  assert(
    created.every((row) => row.asset_template_id === v2.id),
    "the backfill stamps the version it was called on, not the version the asset is pinned to",
  );
  const { rows: pinned } = await pool.query<{ template_id: string | null }>(
    `SELECT template_id FROM bms.assets WHERE code = $1`,
    [codes[0]],
  );
  assert(
    pinned[0]?.template_id === template.id,
    "the backfill must not re-pin the asset — only its dashboards are new",
  );

  // The second call is the idempotence claim, by row count as well as by report.
  const { rows: countBefore } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.dashboards WHERE slug LIKE $1`,
    [`${TEST_ASSET_PREFIX.toLowerCase()}%`],
  );
  const again = await svc.dashboards.backfill(fx.adminJwt, v2.id);
  assert(
    again.createdCount === 0,
    `the second call must create nothing, got ${again.createdCount}`,
  );
  const repeat = new Map(again.assets.map((entry) => [entry.code, entry.outcome]));
  assert(
    codes.every((code) => repeat.get(code) === "skipped_existing"),
    `every asset must now be skipped, got ${[...repeat].map(([c, o]) => `${c}=${o}`).join(" ")}`,
  );
  const { rows: countAfter } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.dashboards WHERE slug LIKE $1`,
    [`${TEST_ASSET_PREFIX.toLowerCase()}%`],
  );
  assert(
    countBefore[0].n === countAfter[0].n,
    `the second call changed the dashboard count from ${countBefore[0].n} to ${countAfter[0].n}`,
  );
  return v2;
}

/** G2c — permission is decided BEFORE the status is read. */
export async function assertBackfillRefusesDraftAndLocationAdmin(
  svc: Services,
  fx: Fixtures,
  v2: AdminAssetTemplateDto,
): Promise<void> {
  const draft = await svc.templates.createDraftFrom(fx.adminJwt, v2.id);

  await expectRejection(
    () => svc.dashboards.backfill(fx.adminJwt, draft.id),
    /Only a published template can be instantiated/,
    "a draft version must be refused with the lifecycle sentence",
  );
  await expectRejectionNamed(
    () => svc.dashboards.backfill(fx.adminJwt, draft.id),
    "ConflictException",
    "a draft version is a 409",
  );

  // The SAME draft id with a location admin's JWT. A 403 and not the 409 above
  // is the whole claim: a caller who may not author learns nothing about the
  // version's lifecycle state.
  await expectRejectionNamed(
    () => svc.dashboards.backfill(fx.locationAdminJwt, draft.id),
    "ForbiddenException",
    "a location admin must be refused BEFORE the draft status is disclosed",
  );
}

/** G2d — the backfill leaves its own audit row. */
export async function assertBackfillAuditRow(
  pool: pg.Pool,
  v2: AdminAssetTemplateDto,
): Promise<void> {
  const { rows } = await pool.query<{
    entity_type: string;
    payload: { createdCount?: number; templateCode?: string };
  }>(
    `SELECT entity_type, payload FROM bms.audit_log
      WHERE action = 'master.dashboard.backfill' AND entity_id = $1
      ORDER BY created_at ASC LIMIT 1`,
    [v2.id],
  );
  const row = rows[0];
  assert(row !== undefined, "the backfill must write a master.dashboard.backfill audit row");
  assert(
    row.entity_type === "asset_template",
    `the audit row's entity is the template, got ${row.entity_type}`,
  );
  assert(
    row.payload.createdCount === 2,
    `the audit payload must carry createdCount 2, got ${String(row.payload.createdCount)}`,
  );
}
