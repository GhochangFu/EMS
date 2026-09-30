import { randomUUID } from "node:crypto";

import { Logger, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect, vi } from "vitest";

import { createDb } from "@bms/db";
import {
  MIMIC_PRESETS,
  type DashboardMimicNodesResponseDto,
  type JwtPayload,
  type MimicLayoutNodeDto,
  type MimicLayoutWidgetNodesDto,
  type MimicNodeDto,
} from "@bms/shared";

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

/** The wtp member's one open alarm: `critical`, raised an hour before the transaction's `now()`. */
const OPEN_ALARM_MESSAGE = "F3.32 open alarm";

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
  tabId: string | null = null,
): Promise<string> {
  const widget = await one<{ id: string }>(
    client,
    `INSERT INTO bms.dashboard_widgets
       (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, tab_id)
     VALUES ($1, $2, 'mimic', 0, $4, 12, 6, $3::jsonb, $5) RETURNING id`,
    [organizationId, dashboardId, JSON.stringify(config), gridY, tabId],
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
  // `bms.point_keys` is a global vocabulary keyed on `code` alone — creating the four rows once
  // and binding them to BOTH the wtp asset and the shown `ro` member (below) is what lets a LIMIT
  // wrongly moved to the OUTER query (across every asset's rows) be told apart from one correctly
  // applied per asset inside the lateral: only the per-asset LIMIT leaves both assets at 3.
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
  }

  /** Binds the four shared point keys to `assetId` and samples them the same way for each. */
  async function attachRankedPoints(assetId: string): Promise<void> {
    for (const code of [keys.unranked, keys.r2, keys.r1, keys.r3]) {
      await client.query(
        `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit, active)
         VALUES ($1, $2, $3, $4, NULL, true)`,
        [site.organizationId, assetId, code, `src_${assetId}_${code}`],
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
        [assetId, key, 42, ageSeconds],
      );
    }
  }

  await attachRankedPoints(wtpId);
  // The shown `ro` member (`roEarlierId`) gets the same four points — the positive control M4c
  // below reads against.
  await attachRankedPoints(roEarlierId);

  // The cleared alarm is the NEWER of the two at the same severity (`F3.32b`), so a top-alarm
  // read that forgets `cleared_at IS NULL` picks it rather than tying.
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
     VALUES ($1, $2, 'critical', $3, now() - interval '1 hour', NULL),
            ($1, $2, 'critical', 'F3.32 cleared alarm', now(), now())`,
    [site.organizationId, wtpId, OPEN_ALARM_MESSAGE],
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

/** A widget's preset name, or its layout id — one comparable value for either arm (`F3.32c`). */
function presetOrLayoutOf(widget: DashboardMimicNodesResponseDto["widgets"][number]): string {
  return widget.source === "preset" ? widget.preset : widget.layoutId;
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

/**
 * M4c — both the `wtp` node and the `ro` node carry exactly three points, out of the four each
 * asset owns. A LIMIT wrongly moved from the per-asset lateral to the OUTER query (across every
 * shown asset's rows) would leave the combined result at three total, not three per asset — this
 * reddens that mutation where M2 alone (wtp only) cannot.
 */
export async function assertWtpAndRoBothShowExactlyThreePoints(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const dto = await readTrain(client, train);
  expect([nodeOf(dto, "wtp").asset?.points.length, nodeOf(dto, "ro").asset?.points.length]).toEqual([3, 3]);
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

/**
 * M6c — plan D6, "readable first, then counted": when the readable set holds only the earlier
 * `ro` member, `memberCount` reads 1, not 2 — the filter runs BEFORE the `member_count` window
 * function, not after.
 */
export async function assertReadableSetNarrowsMemberCountToOne(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const dto = await readTrain(client, train, [train.roEarlierId]);
  expect(nodeOf(dto, "ro").memberCount).toBe(1);
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
  expect(dto.widgets.map(presetOrLayoutOf)).toEqual(["water_train"]);
}

// ---------------------------------------------------------------- F3.32b top-alarm cases

/**
 * A1 — `F3.32b` (ADR 0079 Amendment 2 item 3): with a NEWER open `warning` beside the older open
 * `critical`, the wtp node's top alarm is the `critical` one — severity rank first, `raised_at`
 * second. An order by `raised_at` alone answers the warning.
 */
export async function assertTopAlarmIsTheMostSevere(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
     VALUES ($1, $2, 'warning', 'F3.32b newer warning', now(), NULL)`,
    [train.organizationId, train.wtpId],
  );
  const nowMs = await txNowMs(client);
  const dto = await readTrain(client, train);
  expect(nodeOf(dto, "wtp").topAlarm).toEqual({
    severity: "critical",
    tone: "critical",
    label: "Critical",
    message: OPEN_ALARM_MESSAGE,
    raisedAt: new Date(nowMs - 3_600_000).toISOString(),
  });
}

/**
 * A2 — the fixture's cleared `critical` is newer than its open `critical`, so the top alarm is the
 * open one only while `cleared_at IS NULL` holds.
 */
export async function assertClearedAlarmIsNeverTop(client: pg.PoolClient): Promise<void> {
  const dto = await readTrain(client, await seedTrain(client));
  expect(nodeOf(dto, "wtp").topAlarm?.message).toBe(OPEN_ALARM_MESSAGE);
}

/** A3 — the six roles no member carries answer `topAlarm: null`. */
export async function assertUnassignedNodesHaveNoTopAlarm(client: pg.PoolClient): Promise<void> {
  const dto = await readTrain(client, await seedTrain(client));
  const unassigned = (dto.widgets[0]?.nodes ?? []).filter((node) => node.key !== "wtp" && node.key !== "ro");
  expect(unassigned.map((node) => [node.key, node.topAlarm])).toEqual(
    WATER_TRAIN_KEYS.filter((key) => key !== "wtp" && key !== "ro").map((key) => [key, null]),
  );
}

/** A4 — the shown `ro` member is assigned but has no open alarm: `topAlarm: null`. */
export async function assertAssignedNodeWithoutAlarmHasNoTopAlarm(client: pg.PoolClient): Promise<void> {
  const dto = await readTrain(client, await seedTrain(client));
  expect([nodeOf(dto, "ro").asset?.id !== undefined, nodeOf(dto, "ro").topAlarm]).toEqual([true, null]);
}

/**
 * A5 — an open `critical` alarm stamped with ANOTHER organization but the wtp asset's id, and
 * newer than the wtp's own, is never the top alarm: the lateral names `organization_id = $2`.
 * (`bms.alarms` has a single-column asset FK, so the cross-tenant row is constructible.)
 */
export async function assertForeignOrganizationAlarmIsNeverTop(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const foreign = await seedSite(client);
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
     VALUES ($1, $2, 'critical', 'F3.32b foreign alarm', now(), NULL)`,
    [foreign.organizationId, train.wtpId],
  );
  const dto = await readTrain(client, train);
  expect(nodeOf(dto, "wtp").topAlarm?.message).toBe(OPEN_ALARM_MESSAGE);
}

/**
 * A6 — ADR 0032 decision 9: a severity level declared by an `INSERT` (code, tone and label all
 * distinct, ranked above `critical`) is the top alarm, and the node carries the vocabulary row's
 * tone and label — not the code, and not a tone derived from it. The vocabulary row is written
 * inside the rolled-back transaction, like every fixture here.
 */
export async function assertTopAlarmCarriesTheVocabularyToneAndLabel(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  await client.query(
    `INSERT INTO bms.alarm_severities (code, label, tone, rank)
     VALUES ('f332b_sev_high', 'F3.32b High pressure', 'warning', 9032)`,
  );
  await client.query(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
     VALUES ($1, $2, 'f332b_sev_high', 'F3.32b vocabulary alarm', now(), NULL)`,
    [train.organizationId, train.wtpId],
  );
  const dto = await readTrain(client, train);
  const top = nodeOf(dto, "wtp").topAlarm;
  expect([top?.severity, top?.tone, top?.label]).toEqual(["f332b_sev_high", "warning", "F3.32b High pressure"]);
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
  expect(dto.widgets.map(presetOrLayoutOf)).toEqual(["water_train"]);
}

// ---------------------------------------------------------------- F3.32c layout cases

/**
 * The stored layout, in the order `read()` must answer it (`z, y, x`, then `key`). Inserted in
 * REVERSE (below), so neither insertion order nor key order is the answer. `d` is a passive unit
 * (no role, plan D6); `p` a panel; `t` a label. Every box is inside a 60 × 40 canvas.
 */
const LAYOUT_NODES: readonly MimicLayoutNodeDto[] = [
  { key: "p", kind: "panel", symbol: null, label: "Pretreatment", roleCode: null, tone: "info", x: 0, y: 0, w: 60, h: 40, z: 0 },
  { key: "a", kind: "unit", symbol: "tank", label: "WTP", roleCode: "wtp", tone: null, x: 5, y: 10, w: 8, h: 8, z: 1 },
  { key: "b", kind: "unit", symbol: "membrane", label: "RO", roleCode: "ro", tone: null, x: 30, y: 10, w: 8, h: 8, z: 1 },
  { key: "d", kind: "unit", symbol: "discharge", label: "Discharge", roleCode: null, tone: null, x: 45, y: 25, w: 6, h: 6, z: 1 },
  { key: "t", kind: "label", symbol: null, label: "Plant", roleCode: null, tone: null, x: 2, y: 2, w: 20, h: 3, z: 2 },
];

/** The pipes by key, in `read()`'s order; inserted reversed. */
const LAYOUT_PIPES = [
  { fromKey: "a", toKey: "b" },
  { fromKey: "b", toKey: "d" },
] as const;

/** Inserts `LAYOUT_NODES` and `LAYOUT_PIPES` as one layout of `organizationId`; answers its id. */
async function seedLayout(client: pg.PoolClient, organizationId: string): Promise<string> {
  const layout = await one<{ id: string }>(
    client,
    `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
     VALUES ($1, 'F3.32c fixture plant', $2, 60, 40) RETURNING id`,
    [organizationId, `f332c-${randomUUID().slice(0, 8)}`],
    "the layout",
  );
  const idByKey = new Map<string, string>();
  for (const node of [...LAYOUT_NODES].reverse()) {
    const row = await one<{ id: string }>(
      client,
      `INSERT INTO bms.mimic_layout_nodes
         (organization_id, layout_id, key, kind, symbol, label, role_code, tone, x, y, w, h, z)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        organizationId,
        layout.id,
        node.key,
        node.kind,
        node.symbol,
        node.label,
        node.roleCode,
        node.tone,
        node.x,
        node.y,
        node.w,
        node.h,
        node.z,
      ],
      `layout node ${node.key}`,
    );
    idByKey.set(node.key, row.id);
  }
  for (const pipe of [...LAYOUT_PIPES].reverse()) {
    await client.query(
      `INSERT INTO bms.mimic_layout_pipes (organization_id, layout_id, from_node_id, to_node_id)
       VALUES ($1, $2, $3, $4)`,
      [organizationId, layout.id, idByKey.get(pipe.fromKey), idByKey.get(pipe.toKey)],
    );
  }
  return layout.id;
}

/** The water train fixture plus one layout widget below its preset widget (grid y 6). */
async function seedTrainWithLayout(
  client: pg.PoolClient,
): Promise<{ train: Train; layoutId: string; widgetId: string }> {
  const train = await seedTrain(client);
  const layoutId = await seedLayout(client, train.organizationId);
  const widgetId = await seedMimicWidget(
    client,
    train.organizationId,
    train.dashboardId,
    { source: "layout", layoutId },
    6,
  );
  return { train, layoutId, widgetId };
}

function layoutWidgetOf(dto: DashboardMimicNodesResponseDto): MimicLayoutWidgetNodesDto {
  const widget = dto.widgets.find((candidate) => candidate.source === "layout");
  if (widget === undefined || widget.source !== "layout") {
    throw new Error("no layout widget in the mimic-nodes answer");
  }
  return widget;
}

/** L1a — a layout widget answers its id and its geometry: nodes in `z, y, x` order, pipes by key. */
export async function assertLayoutWidgetAnswersItsGeometry(client: pg.PoolClient): Promise<void> {
  const { train, layoutId, widgetId } = await seedTrainWithLayout(client);
  const widget = layoutWidgetOf(await readTrain(client, train));
  expect({ widgetId: widget.widgetId, layoutId: widget.layoutId, layout: widget.layout }).toEqual({
    widgetId,
    layoutId,
    layout: { name: "F3.32c fixture plant", canvasW: 60, canvasH: 40, nodes: LAYOUT_NODES, pipes: LAYOUT_PIPES, orgSymbols: [] },
  });
}

/**
 * L1b — each roled unit resolves exactly as a preset node: `a` (wtp) to the wtp member with its
 * one open alarm; `b` (ro) to the first-by-code of two members.
 */
export async function assertLayoutUnitsResolveLikePresetNodes(client: pg.PoolClient): Promise<void> {
  const { train } = await seedTrainWithLayout(client);
  const widget = layoutWidgetOf(await readTrain(client, train));
  expect(
    widget.nodes.map((node) => [node.key, node.roleCode, node.asset?.id, node.memberCount, node.activeAlarms]),
  ).toEqual([
    ["a", "wtp", train.wtpId, 1, 1],
    ["b", "ro", train.roEarlierId, 2, 0],
  ]);
}

/** L2 — the passive unit `d` is drawn (in `layout.nodes`) but not resolved (absent from `nodes`). */
export async function assertPassiveUnitIsDrawnNotResolved(client: pg.PoolClient): Promise<void> {
  const { train } = await seedTrainWithLayout(client);
  const widget = layoutWidgetOf(await readTrain(client, train));
  expect({
    drawn: widget.layout.nodes.some((node) => node.key === "d"),
    resolved: widget.nodes.some((node) => node.key === "d"),
  }).toEqual({ drawn: true, resolved: false });
}

/** L3 — a dashboard holding a layout widget costs five statements (M7's three, plus 1b and 1c). */
export async function assertLayoutReadIsFiveStatements(client: pg.PoolClient): Promise<void> {
  const { train } = await seedTrainWithLayout(client);
  const nowMs = await txNowMs(client);
  const counting = countingClient(client);
  await readService(counting.pool).read(train.organizationId, train.dashboardId, null, nowMs);
  expect(counting.count()).toBe(5);
}

/**
 * L4 — mixed widgets answer in grid order, not grouped by arm: preset (y 0), layout (y 6),
 * preset (y 12).
 */
export async function assertMixedWidgetsKeepGridOrder(client: pg.PoolClient): Promise<void> {
  const { train, layoutId } = await seedTrainWithLayout(client);
  await seedMimicWidget(client, train.organizationId, train.dashboardId, { source: "preset", preset: "water_train" }, 12);
  const dto = await readTrain(client, train);
  expect(dto.widgets.map(presetOrLayoutOf)).toEqual(["water_train", layoutId, "water_train"]);
}

/**
 * L5 — a widget naming ANOTHER organization's layout is skipped with one warning, and the preset
 * widget still answers. `FLEET_POOL` bypasses RLS, so only (1b)'s organization predicate hides it.
 */
export async function assertForeignLayoutWidgetIsSkippedWithOneWarning(client: pg.PoolClient): Promise<void> {
  const train = await seedTrain(client);
  const foreign = await seedSite(client);
  const foreignLayoutId = await seedLayout(client, foreign.organizationId);
  await seedMimicWidget(client, train.organizationId, train.dashboardId, { source: "layout", layoutId: foreignLayoutId }, 6);
  const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  try {
    const dto = await readTrain(client, train);
    const layoutWarnings = warn.mock.calls.filter((call) => String(call[0]).includes(foreignLayoutId));
    expect({ widgets: dto.widgets.map(presetOrLayoutOf), warnings: layoutWarnings.length }).toEqual({
      widgets: ["water_train"],
      warnings: 1,
    });
  } finally {
    warn.mockRestore();
  }
}

// ---------------------------------------------------------------- F3.73 per-tab cases

/**
 * `F3.73` (plan D3, task 2.3) fixture: a site-scoped dashboard (`location_id` set, no group) with
 * two groups at that site, each holding its own `wtp` member. Tabs are added per case.
 */
interface TabbedSite {
  readonly organizationId: string;
  readonly locationId: string;
  readonly dashboardId: string;
  readonly groupA: string;
  readonly groupB: string;
  readonly wtpA: string;
  readonly wtpB: string;
}

async function seedTabbedSite(client: pg.PoolClient): Promise<TabbedSite> {
  const site = await seedSite(client);
  const groupOf = async (suffix: string): Promise<{ groupId: string; wtpId: string }> => {
    const group = await one<{ id: string }>(
      client,
      `INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
       VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
      [site.locationId, `${site.tag}-${suffix}`.toLowerCase(), `F3.73 group ${suffix}`, site.organizationId],
      `group ${suffix}`,
    );
    const wtpId = await seedAsset(client, site, `${site.tag}-WTP-${suffix}`);
    await client.query("INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES ($1, $2, 'wtp')", [
      group.id,
      wtpId,
    ]);
    return { groupId: group.id, wtpId };
  };
  const a = await groupOf("A");
  const b = await groupOf("B");
  const dashboard = await one<{ id: string }>(
    client,
    `INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
     VALUES ($1, $2, 'F3.73 tabbed mimic fixture', $3) RETURNING id`,
    [site.organizationId, `${site.tag}-tabs`.toLowerCase(), site.locationId],
    "the site dashboard",
  );
  return {
    organizationId: site.organizationId,
    locationId: site.locationId,
    dashboardId: dashboard.id,
    groupA: a.groupId,
    groupB: b.groupId,
    wtpA: a.wtpId,
    wtpB: b.wtpId,
  };
}

/**
 * One tab of the fixture dashboard. `groupId: null` is an Overview (`location_id NULL`, plan D1).
 * `stampOrganizationId` overrides the tab's own `organization_id` — the cross-org fixture; the
 * fleet pool bypasses RLS, so only the read's predicate can tell the row apart.
 */
async function seedTab(
  client: pg.PoolClient,
  site: TabbedSite,
  key: string,
  groupId: string | null,
  stampOrganizationId: string = site.organizationId,
): Promise<string> {
  const tab = await one<{ id: string }>(
    client,
    `INSERT INTO bms.dashboard_tabs (organization_id, dashboard_id, location_id, asset_group_id, tab_key, label)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [stampOrganizationId, site.dashboardId, groupId === null ? null : site.locationId, groupId, key],
    `tab ${key}`,
  );
  return tab.id;
}

async function readTabbedSite(client: pg.PoolClient, site: TabbedSite): Promise<DashboardMimicNodesResponseDto> {
  return readService(client as unknown as pg.Pool).read(site.organizationId, site.dashboardId, null, await txNowMs(client));
}

/** Each widget's `wtp` node's asset id, in the answer's (grid) order. */
function wtpAssetIds(dto: DashboardMimicNodesResponseDto): (string | null)[] {
  return dto.widgets.map((widget) => widget.nodes.find((node) => node.key === "wtp")?.asset?.id ?? null);
}

/**
 * T1 — two tabs on two groups: each tab's mimic resolves ITS tab's group, never the first
 * widget's. A read that takes one group for the dashboard answers group A for both.
 */
export async function assertEachTabMimicResolvesItsOwnGroup(client: pg.PoolClient): Promise<void> {
  const site = await seedTabbedSite(client);
  const tabA = await seedTab(client, site, "sld", site.groupA);
  const tabB = await seedTab(client, site, "ups", site.groupB);
  await seedMimicWidget(client, site.organizationId, site.dashboardId, undefined, 0, tabA);
  await seedMimicWidget(client, site.organizationId, site.dashboardId, undefined, 6, tabB);
  expect(wtpAssetIds(await readTabbedSite(client, site))).toEqual([site.wtpA, site.wtpB]);
}

/** T1b — two groups still cost three statements: members and points are each ONE read. */
export async function assertTwoTabGroupsAreThreeStatements(client: pg.PoolClient): Promise<void> {
  const site = await seedTabbedSite(client);
  await seedMimicWidget(client, site.organizationId, site.dashboardId, undefined, 0, await seedTab(client, site, "sld", site.groupA));
  await seedMimicWidget(client, site.organizationId, site.dashboardId, undefined, 6, await seedTab(client, site, "ups", site.groupB));
  const nowMs = await txNowMs(client);
  const counting = countingClient(client);
  await readService(counting.pool).read(site.organizationId, site.dashboardId, null, nowMs);
  expect(counting.count()).toBe(3);
}

/**
 * T2 — a mimic on the Overview tab (no group, on a site dashboard with no group) answers every
 * node unassigned and does not throw; the group tab's mimic on the same dashboard still resolves.
 */
export async function assertOverviewTabMimicIsUnassignedForThatWidgetOnly(client: pg.PoolClient): Promise<void> {
  const site = await seedTabbedSite(client);
  const overview = await seedTab(client, site, "overview", null);
  const tabA = await seedTab(client, site, "sld", site.groupA);
  await seedMimicWidget(client, site.organizationId, site.dashboardId, undefined, 0, overview);
  await seedMimicWidget(client, site.organizationId, site.dashboardId, undefined, 6, tabA);
  const dto = await readTabbedSite(client, site);
  expect({
    overview: dto.widgets[0]?.nodes.map((node) => [node.key, node.asset, node.memberCount]),
    sld: wtpAssetIds(dto)[1],
  }).toEqual({ overview: WATER_TRAIN_KEYS.map((key) => [key, null, 0]), sld: site.wtpA });
}

/**
 * T3 — the organization predicate on the tab join (ADR 0043 Amendment 3). A tab stamped with
 * ANOTHER organization's id but hung on this dashboard and bound to this organization's group is
 * written through the fleet pool (it bypasses RLS, and nothing ties a tab's organization to its
 * dashboard's), and it exists. Its widget resolves as "no group" — every node unassigned — while
 * the honestly stamped tab on the SAME group, the positive control, resolves the member.
 */
export async function assertForeignStampedTabResolvesAsNoGroup(client: pg.PoolClient): Promise<void> {
  const site = await seedTabbedSite(client);
  const foreign = await seedSite(client);
  const stamped = await seedTab(client, site, "stamped", site.groupA, foreign.organizationId);
  const honest = await seedTab(client, site, "sld", site.groupA);
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.dashboard_tabs WHERE id = $1 AND organization_id = $2",
    [stamped, foreign.organizationId],
  );
  await seedMimicWidget(client, site.organizationId, site.dashboardId, undefined, 0, stamped);
  await seedMimicWidget(client, site.organizationId, site.dashboardId, undefined, 6, honest);
  expect({ stampedRowExists: rows[0]?.n, wtp: wtpAssetIds(await readTabbedSite(client, site)) }).toEqual({
    stampedRowExists: 1,
    wtp: [null, site.wtpA],
  });
}
