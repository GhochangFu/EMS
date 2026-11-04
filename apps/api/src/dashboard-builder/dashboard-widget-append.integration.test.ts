import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import { TrendPointsService } from "../trend-points/trend-points.service";
import { DashboardsService } from "./dashboards.service";
import { DashboardWidgetAppendService } from "./dashboard-widget-append.service";
import {
  aConfigTabKeyNamingNoTabIs400,
  aDashboardTheCallerCannotManageIs404,
  aFullTabIs409,
  aFullTabRollsBackEveryStrip,
  aFullTabStillReplacesItsStrip,
  anOffListSelectionIs400WithTheStampUnchanged,
  aRepeatedTabKeyIs400,
  aSelectionOnTheListIsAppended,
  aStripIsInsertedAtTheFootOfItsTab,
  aTabsStripIsReplacedInPlace,
  theStripAnswerParsesInBodyOrder,
  theStripArmKeepsTheTabRules,
  theStripArmMovesUpdatedAtAndAStaleSaveIs412,
  theStripAuditRowCarriesIdsAndCountsOnly,
  theTrendArm404PrecedesTheSelection400,
  anEmptyCanvasTakesTheWidgetAtTheTopWithTheDefaultSize,
  anUnknownTabKeyIs400,
  anUnreadableAssetIs403WithoutAnId,
  anUnregisteredPairIs400NamingItsIndexOnly,
  aRepeatedPairIs400NamingItsIndex,
  aSaveWithThePreAppendIfMatchIs412,
  aTabbedDashboardWithoutTabKeyIs400,
  aTabKeyOnAnUntabbedDashboardIs400,
  type AppendCtx,
  theAnswerParsesAndCarriesThePairs,
  theAppendMovesUpdatedAt,
  theAuditRowCarriesIdsAndCountsOnly,
  theCapCountsOnlyTheChosenTab,
  theLocationAdminAppendsAReadablePoint,
  theOtherWidgetsAreUntouched,
  theWidgetLandsAtTheFootOfItsTab,
  twoConcurrentAppendsAt39GiveOneSuccessAndOne409,
} from "./dashboard-widget-append.integration.spec";

/**
 * `F4.303` U14 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the pools, this run's dashboards and their cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "F4.303",
  label: "POST /dashboards/:id/widgets/append",
  because:
    "the tenant transaction's row lock, the per-tab count, the organization-bounded pair " +
    "resolution and the audit row are facts about a real Postgres that a fake db cannot prove.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F4.303 — DashboardWidgetAppendService.append (ADR 0108 Amendment 6 item 5)", () => {
  let fleetPool: pg.Pool;
  let superuserPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  const dashboardIds: string[] = [];
  let ctx: AppendCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    // W12 runs two tenant transactions at once beside the scope reads, so each pool holds four.
    const POOL = { max: 4 } as const;
    fleetPool = await openIntegrationPool(url, "F4.303", POOL);
    await primeSeededSubjects(fleetPool);
    superuserPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.303", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.303",
      POOL,
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.303",
      POOL,
    );
    const fleetDb = createDb(fleetPool);
    const { rows: orgRows } = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    const eskomOrgId = orgRows[0]?.id;
    if (!eskomOrgId) throw new Error("F4.303: the ESKOM organization is not seeded — run pnpm db:seed");

    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
    const dashboards = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
    const trendPoints = new TrendPointsService(fleetDb, createDb(tenantPool), accessControl, audit);
    const append = new DashboardWidgetAppendService(createDb(tenantPool), dashboards, accessControl, audit, trendPoints);
    // `F4.306` U7 — a segment of ESKOM with an effective trend point, for the selection cases.
    const listed = (await trendPoints.effective(eskomOrgId, {})).find((segment) => segment.points.length > 0);
    if (!listed?.points[0]) throw new Error("F4.306: no segment of ESKOM has an effective trend point — run pnpm db:seed");
    const admin = jwtFor(SEEDED.globalAdmin, "admin");
    const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");

    // The OLDEST seeded assets with active registrations — rows no concurrent suite deletes mid-run.
    const { rows: assetRows } = await fleetPool.query<{
      asset_id: string;
      location_id: string;
      points: { id: string; key: string }[];
    }>(
      `SELECT a.id AS asset_id, a.location_id,
              json_agg(json_build_object('id', p.id, 'key', p.point_key) ORDER BY p.created_at, p.id) AS points
         FROM bms.assets a
         JOIN bms.asset_points p ON p.asset_id = a.id AND p.active AND p.organization_id = a.organization_id
        WHERE a.organization_id = $1
        GROUP BY a.id, a.location_id, a.created_at
        ORDER BY a.created_at, a.id`,
      [eskomOrgId],
    );
    const readableIds = new Set((await accessControl.readableAssetIds(locationAdmin)) ?? []);
    const readable = assetRows.find((row) => readableIds.has(row.asset_id) && row.points.length >= 2);
    const unreadable = assetRows.find((row) => !readableIds.has(row.asset_id));
    const [first, second] = readable?.points ?? [];
    if (!readable || !unreadable || !first || !second || !unreadable.points[0]) {
      throw new Error(
        "F4.303: ESKOM needs an asset wc-admin can read with two active points, and one it cannot read — run pnpm db:seed",
      );
    }

    let n = 0;
    ctx = {
      append,
      dashboards,
      admin,
      locationAdmin,
      superuserPool,
      readable: { assetId: readable.asset_id, pointKeys: [first.key, second.key], pointId: first.id },
      unreadable: { assetId: unreadable.asset_id, pointKey: unreadable.points[0].key },
      scopedLocationId: readable.location_id,
      segment: listed.domain,
      pointCode: listed.points[0].code,
      newDashboard: async (options = {}) => {
        n += 1;
        const created = await dashboards.create(admin, {
          organizationId: eskomOrgId,
          slug: `f4303-append-${RUN}-${n}`,
          name: "F4.303 append fixture",
          ...(options.locationId === undefined ? {} : { locationId: options.locationId }),
        } as Parameters<DashboardsService["create"]>[1]);
        dashboardIds.push(created.id);
        return created.id;
      },
    };
  }, 60_000);

  afterAll(async () => {
    if (dashboardIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [dashboardIds]);
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
    }
    await Promise.all([fleetPool, superuserPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("W1: a dashboard the caller cannot manage is a 404 and its updated_at does not move", async () => {
    await aDashboardTheCallerCannotManageIs404(ctx);
  }, 60_000);

  it("W2: an unreadable asset is a 403 that echoes no id", async () => {
    await anUnreadableAssetIs403WithoutAnId(ctx);
  }, 60_000);

  it("W2 control: the location admin appends a point it can read on the same kind of dashboard", async () => {
    await theLocationAdminAppendsAReadablePoint(ctx);
  }, 60_000);

  it("W3: a pair with no active registration is a 400 naming its index only", async () => {
    await anUnregisteredPairIs400NamingItsIndexOnly(ctx);
  }, 60_000);

  it("a repeated pair is a 400 naming its index", async () => {
    await aRepeatedPairIs400NamingItsIndex(ctx);
  }, 60_000);

  it("W4: a tabbed dashboard without tabKey is a 400", async () => {
    await aTabbedDashboardWithoutTabKeyIs400(ctx);
  }, 60_000);

  it("W5: an unknown tabKey is a 400", async () => {
    await anUnknownTabKeyIs400(ctx);
  }, 60_000);

  it("W6: a tabKey on a dashboard without tabs is a 400", async () => {
    await aTabKeyOnAnUntabbedDashboardIs400(ctx);
  }, 60_000);

  it("W7: 40 widgets on the tab is a 409 with the cap sentence", async () => {
    await aFullTabIs409(ctx);
  }, 60_000);

  it("W8: 39 on the tab and 40 on another tab succeeds", async () => {
    await theCapCountsOnlyTheChosenTab(ctx);
  }, 60_000);

  it("W9: the widget lands at gridX 0 under the lowest widget of its tab, with the body's window and function", async () => {
    await theWidgetLandsAtTheFootOfItsTab(ctx);
  }, 60_000);

  it("an empty canvas takes the widget at gridY 0 with the default 6 by 4 size", async () => {
    await anEmptyCanvasTakesTheWidgetAtTheTopWithTheDefaultSize(ctx);
  }, 60_000);

  it("W10: every other widget, its points and its sources are byte-identical after the append", async () => {
    await theOtherWidgetsAreUntouched(ctx);
  }, 60_000);

  it("W11: the append moves updated_at and answers the stored value", async () => {
    await theAppendMovesUpdatedAt(ctx);
  }, 60_000);

  it("W11: a builder save with the pre-append If-Match is a 412", async () => {
    await aSaveWithThePreAppendIfMatchIs412(ctx);
  }, 60_000);

  it("W12: two concurrent appends at 39 give one success and one 409", async () => {
    await twoConcurrentAppendsAt39GiveOneSuccessAndOne409(ctx);
  }, 60_000);

  it("W13: the audit row carries ids and counts only", async () => {
    await theAuditRowCarriesIdsAndCountsOnly(ctx);
  }, 60_000);

  it("W14: the answer parses with appendChartWidgetResponseSchema and carries the pairs in order", async () => {
    await theAnswerParsesAndCarriesThePairs(ctx);
  }, 60_000);

  it("F4.306 T1: the trend arm's 404 precedes the selection's 400, and updated_at does not move", async () => {
    await theTrendArm404PrecedesTheSelection400(ctx);
  }, 60_000);

  it("F4.306 T1: an off-list selection is a 400 naming indexes only, with updated_at unchanged", async () => {
    await anOffListSelectionIs400WithTheStampUnchanged(ctx);
  }, 60_000);

  it("F4.306 T1 control: a selection on the list is appended and stored as sent", async () => {
    await aSelectionOnTheListIsAppended(ctx);
  }, 60_000);

  it("F4.306 T2: a repeated tabKey is a 400 naming the strip index", async () => {
    await aRepeatedTabKeyIs400(ctx);
  }, 60_000);

  it("F4.306 T3: the trend arm keeps the chart arm's tab rules", async () => {
    await theStripArmKeepsTheTabRules(ctx);
  }, 60_000);

  it("F4.306 T3: a config.tabKey that names no tab is a 400", async () => {
    await aConfigTabKeyNamingNoTabIs400(ctx);
  }, 60_000);

  it("F4.306 T4: a tab's strip is replaced in place, every other row byte-identical", async () => {
    await aTabsStripIsReplacedInPlace(ctx);
  }, 60_000);

  it("F4.306 T5: a strip is inserted at gridX 0, the foot of its tab, 12 by 4", async () => {
    await aStripIsInsertedAtTheFootOfItsTab(ctx);
  }, 60_000);

  it("F4.306 T6: a full tab is a 409 that rolls back every strip", async () => {
    await aFullTabRollsBackEveryStrip(ctx);
  }, 60_000);

  it("F4.306 T6 control: a full tab still replaces its strip", async () => {
    await aFullTabStillReplacesItsStrip(ctx);
  }, 60_000);

  it("F4.306 T7: the trend arm moves updated_at and a stale If-Match save is a 412", async () => {
    await theStripArmMovesUpdatedAtAndAStaleSaveIs412(ctx);
  }, 60_000);

  it("F4.306 T8: one audit row with ids and counts only", async () => {
    await theStripAuditRowCarriesIdsAndCountsOnly(ctx);
  }, 60_000);

  it("F4.306 T9: the answer parses and lists the widgets in body order", async () => {
    await theStripAnswerParsesInBodyOrder(ctx);
  }, 60_000);
});
