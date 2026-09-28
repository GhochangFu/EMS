import { randomUUID } from "node:crypto";

import { NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { createDb } from "@bms/db";
import { MIMIC_PRESETS, type DashboardMimicNodesResponseDto, type JwtPayload, type MimicNodeDto } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { countingClient } from "../control-room/generated-site-view.integration.spec";
import { MimicNodesService } from "./mimic-nodes.service";

/**
 * `F3.32` / ADR 0079 (plan U2) — `MimicNodesService` against a real database. The sibling
 * `.integration.test.ts` owns the pool; the assertions live here (ADR 0014, AGENTS.md §4.6).
 *
 * **One harness: every case runs in one transaction and rolls it back** (F3.68's
 * `inRolledBackTransaction`). The service is built over that same client, so it sees the
 * per-case organization, site, group, assets, points, samples and alarms, and nobody else does.
 * The `forUser` cases stub `AccessControlService` — its readable sets are the input the seam
 * under test consumes, and a stub keeps the dashboard row inside the transaction.
 *
 * **Needs migrations `0086` (the `mimic` widget type) and `0087` (the seven role codes).**
 *
 * **One clock.** SQL `now()` is frozen at `BEGIN`; samples are stamped `now() - N s` and
 * `read()` is handed that same instant.
 */

const RUN = randomUUID().slice(0, 8);

const WATER_TRAIN_KEYS = MIMIC_PRESETS.water_train.nodes.map((node) => node.key);

interface Train {
  readonly organizationId: string;
  readonly dashboardId: string;
  readonly wtpId: string;
  /** The `ro` member with the LATER code, inserted FIRST. */
  readonly roLaterId: string;
  /** The `ro` member with the EARLIER code, inserted second — the one shown. */
  readonly roEarlierId: string;
  readonly roEarlierCode: string;
  /** The wtp point keys by rank: rank 1, rank 2, rank 3, unranked. */
  readonly keys: { readonly r1: string; readonly r2: string; readonly r3: string; readonly unranked: string };
}

async function txNowMs(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ now: Date }>("SELECT now() AS now");
  const now = rows[0]?.now;
  if (!now) throw new Error("SELECT now() returned no row");
  return now.getTime();
}

async function one<T>(client: pg.PoolClient, sql: string, params: unknown[], what: string): Promise<T> {
  const { rows } = await client.query<T & pg.QueryResultRow>(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`F3.32 fixture: failed to insert ${what}`);
  return row;
}

async function seedSite(client: pg.PoolClient): Promise<{ organizationId: string; locationId: string; tag: string }> {
  const tag = `F332-${RUN}-${randomUUID().slice(0, 8)}`;
  const org = await one<{ id: string }>(
    client,
    "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'ZAR') RETURNING id",
    [`${tag}-ORG`, "F3.32 mimic fixture organization"],
    "the organization",
  );
  const loc = await one<{ id: string }>(
    client,
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
     VALUES ($1, $2, $3, $4, 'rsmoc', 0, 0, true) RETURNING id`,
    [org.id, `${tag}-LOC`, tag.toLowerCase(), "F3.32 mimic fixture site"],
    "the location",
  );
  return { organizationId: org.id, locationId: loc.id, tag };
}

async function seedAsset(
  client: pg.PoolClient,
  site: { organizationId: string; locationId: string; tag: string },
  code: string,
): Promise<string> {
  const domain = await one<{ code: string }>(
    client,
    "SELECT code FROM bms.asset_domains ORDER BY sort_order, code LIMIT 1",
    [],
    "a domain lookup (bms.asset_domains is empty — run pnpm db:migrate && pnpm db:seed)",
  );
  const asset = await one<{ id: string }>(
    client,
    `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [site.organizationId, code, `F3.32 ${code}`, `${site.tag} site`, site.locationId, domain.code],
    `asset ${code}`,
  );
  return asset.id;
}

async function seedDashboard(
  client: pg.PoolClient,
  site: { organizationId: string; tag: string },
  groupId: string | null,
): Promise<string> {
  const dashboard = await one<{ id: string }>(
    client,
    `INSERT INTO bms.dashboards (organization_id, slug, name, asset_group_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [site.organizationId, `${site.tag}-${randomUUID().slice(0, 6)}`.toLowerCase(), "F3.32 mimic fixture", groupId],
    "the dashboard",
  );
  return dashboard.id;
}

async function seedMimicWidget(
  client: pg.PoolClient,
  organizationId: string,
  dashboardId: string,
  config: unknown = { source: "preset", preset: "water_train" },
  gridY = 0,
): Promise<string> {
  const widget = await one<{ id: string }>(
    client,
    `INSERT INTO bms.dashboard_widgets
       (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
     VALUES ($1, $2, 'mimic', 0, $4, 12, 6, $3::jsonb) RETURNING id`,
    [organizationId, dashboardId, JSON.stringify(config), gridY],
    "the mimic widget",
  );
  return widget.id;
}

/**
 * The water train fixture: a group holding a `wtp` member with four ranked/unranked points, one
 * open and one cleared alarm, and two `ro` members; the other six roles carry no member. The
 * dashboard is scoped to the group and holds one mimic widget.
 *
 * - The wtp keys are inserted unranked-first (`a` unranked, `b` rank 2, `c` rank 1, `d` rank 3),
 *   so neither insertion order nor key order is the answer `c, b, d`, and the unranked `a` is the
 *   row a fourth slot would add.
 * - `c` has a 10 s old sample (present), `b` only an 8-day-old one (outside the window → null),
 *   `d` a 6-day-old one (inside → present).
 * - The `ro` member with the later code is inserted first, so neither `DESC` nor a missing
 *   `ORDER BY` shows the earlier code.
 */
async function seedTrain(client: pg.PoolClient): Promise<Train> {
  const site = await seedSite(client);
  const group = await one<{ id: string }>(
    client,
    `INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
     VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
    [site.locationId, `${site.tag}-GRP`.toLowerCase(), "F3.32 mimic fixture group", site.organizationId],
    "the group",
  );
  const wtpId = await seedAsset(client, site, `${site.tag}-WTP`);
  const roLaterCode = `${site.tag}-RO-B`;
  const roEarlierCode = `${site.tag}-RO-A`;
  const roLaterId = await seedAsset(client, site, roLaterCode);
  const roEarlierId = await seedAsset(client, site, roEarlierCode);
  for (const [assetId, role] of [
    [wtpId, "wtp"],
    [roLaterId, "ro"],
    [roEarlierId, "ro"],
  ] as const) {
    await client.query("INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES ($1, $2, $3)", [
      group.id,
      assetId,
      role,
    ]);
  }

  const prefix = `f332_${site.tag.slice(-8)}`;
  const keys = { unranked: `${prefix}_a`, r2: `${prefix}_b`, r1: `${prefix}_c`, r3: `${prefix}_d` };
  for (const [code, rank] of [
    [keys.unranked, null],
    [keys.r2, 2],
    [keys.r1, 1],
    [keys.r3, 3],
  ] as const) {
    await client.query(
      "INSERT INTO bms.point_keys (code, name, unit, headline_rank, active) VALUES ($1, $2, 'u', $3, true)",
      [code, `F3.32 ${code}`, rank],
    );
    await client.query(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit, active)
       VALUES ($1, $2, $3, $4, NULL, true)`,
      [site.organizationId, wtpId, code, `src_${code}`],
    );
  }
  for (const [key, ageSeconds] of [
    [keys.r1, 10],
    [keys.r2, 8 * 86_400],
    [keys.r3, 6 * 86_400],
    [keys.unranked, 10],
  ] as const) {
    await client.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES (now() - make_interval(secs => $4), $1, $2, $3, 'u')`,
      [wtpId, key, 42, ageSeconds],
    );
  }
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
     VALUES ($1, $2, 'critical', 'F3.32 open alarm', now(), NULL),
            ($1, $2, 'critical', 'F3.32 cleared alarm', now(), now())`,
    [site.organizationId, wtpId],
  );

  const dashboardId = await seedDashboard(client, site, group.id);
  await seedMimicWidget(client, site.organizationId, dashboardId);
  return {
    organizationId: site.organizationId,
    dashboardId,
    wtpId,
    roLaterId,
    roEarlierId,
    roEarlierCode,
    keys,
  };
}

function readService(pool: pg.Pool): MimicNodesService {
  // `read()` touches neither the Drizzle handle nor access control.
  return new MimicNodesService({} as never, pool, {} as AccessControlService);
}

async function readTrain(
  client: pg.PoolClient,
  train: Train,
  readable: readonly string[] | null = null,
): Promise<DashboardMimicNodesResponseDto> {
  return readService(client as unknown as pg.Pool).read(
    train.organizationId,
    train.dashboardId,
    readable,
    await txNowMs(client),
  );
}

function nodeOf(dto: DashboardMimicNodesResponseDto, key: string): MimicNodeDto {
  const node = dto.widgets[0]?.nodes.find((candidate) => candidate.key === key);
  if (!node) throw new Error(`node ${key} is absent from the mimic-nodes answer`);
  return node;
}

// ---------------------------------------------------------------- read() cases

/** M1 — the wtp node counts its one OPEN alarm; the cleared one does not count. */
export async function assertWtpCountsOneOpenAlarm(client: pg.PoolClient): Promise<void> {
  const dto = await readTrain(client, await seedTrain(client));
  expect(nodeOf(dto, "wtp").activeAlarms).toBe(1);
}

/** M2 — the wtp node shows exactly three of its four points, `rank ASC NULLS LAST, key ASC`. */
export async function assertWtpShowsTopThreeInRankOrder(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const dto = await readTrain(client, train);
  expect(nodeOf(dto, "wtp").asset?.points.map((point) => point.pointKey)).toEqual([
    train.keys.r1,
    train.keys.r2,
    train.keys.r3,
  ]);
}

/** M3a — a point whose only sample is 8 days old answers `latest: null`. */
export async function assertEightDayOldSampleIsNull(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const dto = await readTrain(client, train);
  const point = nodeOf(dto, "wtp").asset?.points.find((candidate) => candidate.pointKey === train.keys.r2);
  expect(point, "the rank-2 point is shown").toBeDefined();
  expect(point?.latest).toBeNull();
}

/** M3b — a point sampled 6 days ago answers its value (the window is not too tight). */
export async function assertSixDayOldSampleIsPresent(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const dto = await readTrain(client, train);
  const point = nodeOf(dto, "wtp").asset?.points.find((candidate) => candidate.pointKey === train.keys.r3);
  expect(point?.latest?.value).toBe(42);
}

/** M4a — two `ro` members: `memberCount: 2`. */
export async function assertRoCountsTwoMembers(client: pg.PoolClient): Promise<void> {
  const dto = await readTrain(client, await seedTrain(client));
  expect(nodeOf(dto, "ro").memberCount).toBe(2);
}

/** M4b — the `ro` node shows the member with the earlier code, inserted second. */
export async function assertRoShowsTheFirstCode(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const dto = await readTrain(client, train);
  expect(nodeOf(dto, "ro").asset?.code).toBe(train.roEarlierCode);
}

/** M5a — all eight preset nodes are answered, in the preset's declared order. */
export async function assertAllEightNodesInPresetOrder(client: pg.PoolClient): Promise<void> {
  const dto = await readTrain(client, await seedTrain(client));
  expect(dto.widgets[0]?.nodes.map((node) => node.key)).toEqual(WATER_TRAIN_KEYS);
}

/** M5b — the six roles no member carries answer `asset: null`, `memberCount: 0`. */
export async function assertSixUnassignedNodesAreNull(client: pg.PoolClient): Promise<void> {
  const dto = await readTrain(client, await seedTrain(client));
  const unassigned = (dto.widgets[0]?.nodes ?? []).filter((node) => node.key !== "wtp" && node.key !== "ro");
  expect(unassigned.map((node) => [node.key, node.asset, node.memberCount])).toEqual(
    WATER_TRAIN_KEYS.filter((key) => key !== "wtp" && key !== "ro").map((key) => [key, null, 0]),
  );
}

/** M6a — a readable set without the wtp member narrows the wtp node to "Not assigned". */
export async function assertUnreadableWtpIsUnassigned(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const dto = await readTrain(client, train, [train.roLaterId, train.roEarlierId]);
  expect([nodeOf(dto, "wtp").asset, nodeOf(dto, "wtp").memberCount]).toEqual([null, 0]);
}

/** M6b — positive control for M6a: the readable `ro` members are still shown. */
export async function assertReadableRoIsStillShown(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const dto = await readTrain(client, train, [train.roLaterId, train.roEarlierId]);
  expect(nodeOf(dto, "ro").asset?.id).toBe(train.roEarlierId);
}

/** M7 — the full read costs three statements. */
export async function assertFullReadIsThreeStatements(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const nowMs = await txNowMs(client);
  const counting = countingClient(client);
  await readService(counting.pool).read(train.organizationId, train.dashboardId, null, nowMs);
  expect(counting.count()).toBe(3);
}

/** M8 — a group-less dashboard answers eight unassigned nodes in one statement. */
export async function assertGrouplessDashboardIsEightNullsInOneStatement(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const dashboardId = await seedDashboard(client, site, null);
  await seedMimicWidget(client, site.organizationId, dashboardId);
  const nowMs = await txNowMs(client);
  const counting = countingClient(client);
  const dto = await readService(counting.pool).read(site.organizationId, dashboardId, null, nowMs);
  expect({
    nodes: dto.widgets[0]?.nodes.map((node) => [node.key, node.asset]),
    statements: counting.count(),
  }).toEqual({ nodes: WATER_TRAIN_KEYS.map((key) => [key, null]), statements: 1 });
}

/** M9 — a dashboard with no mimic widget answers `widgets: []` in one statement. */
export async function assertNoMimicIsEmptyInOneStatement(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const dashboardId = await seedDashboard(client, site, null);
  const nowMs = await txNowMs(client);
  const counting = countingClient(client);
  const dto = await readService(counting.pool).read(site.organizationId, dashboardId, null, nowMs);
  expect({ widgets: dto.widgets, statements: counting.count() }).toEqual({ widgets: [], statements: 1 });
}

/** M10 — a stored config the schema refuses is skipped; the good widget still answers. */
export async function assertBadConfigWidgetIsSkipped(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  await seedMimicWidget(client, train.organizationId, train.dashboardId, { source: "preset", preset: "gas_train" }, 6);
  const dto = await readTrain(client, train);
  expect(dto.widgets.map((widget) => widget.preset)).toEqual(["water_train"]);
}

// ---------------------------------------------------------------- forUser() cases

const JWT = { sub: "f332-fixture" } as unknown as JwtPayload;

function authorizedService(client: pg.PoolClient, readableOrganizationIds: string[] | null): MimicNodesService {
  const accessControl = {
    readableOrganizationIds: async () => readableOrganizationIds,
    readableAssetIds: async () => null,
  } as unknown as AccessControlService;
  const pool = client as unknown as pg.Pool;
  return new MimicNodesService(createDb(pool), pool, accessControl);
}

/** M11a — a caller whose readable organizations exclude the dashboard's gets 404. */
export async function assertForeignOrganizationIsNotFound(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  await expect(authorizedService(client, [randomUUID()]).forUser(JWT, train.dashboardId)).rejects.toBeInstanceOf(
    NotFoundException,
  );
}

/** M11b — positive control for M11a: the owning organization reads the one widget. */
export async function assertOwningOrganizationReads(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const dto = await authorizedService(client, [train.organizationId]).forUser(JWT, train.dashboardId);
  expect(dto.widgets.map((widget) => widget.preset)).toEqual(["water_train"]);
}
