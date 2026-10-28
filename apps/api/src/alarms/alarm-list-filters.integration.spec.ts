import type pg from "pg";
import { expect } from "vitest";

import type { AlarmsService } from "./alarms.service";

/**
 * `F4.291` PR 2 (ADR 0099 Amendment 9 E5(b)) — `AlarmsService.list`'s three
 * new filters against a real database: `severity` (equality on the code),
 * `raisedFrom` (inclusive) and `raisedTo` (exclusive), ANDed onto the
 * existing ones, with the keyset cursor still paging inside the filtered
 * set. The route's `alarmListQuerySchema` does not change; the copilot's
 * `list_alarms` is the one caller that passes them.
 *
 * Each claim sits beside a positive neighbour: the same asset with no filter
 * lists all three alarms, so an empty filtered answer cannot pass by reading
 * nothing. The fixture lives in a fresh organization of its own (inserted
 * as the superuser, deleted by id in `afterAll`); the helpers below are
 * shared with `alarm-stats.integration.spec.ts`.
 *
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

/** A raw `pg` handle with the one method the fixture uses. */
export type Pg = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
};

function fail(message: string): never {
  throw new Error(message);
}

/** A fresh organization: no seeded row is read or written by a suite that uses it. */
export async function insertOrganization(db: Pg, code: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
    [code, `F4.291 ${code}`],
  );
  return rows[0]?.id ?? fail(`organization ${code} was not inserted`);
}

export async function insertLocationRow(
  db: Pg,
  input: { organizationId: string; code: string; name: string; parentId: string | null },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
     VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5, true) RETURNING id`,
    [input.organizationId, input.code, input.code.toLowerCase(), input.name, input.parentId],
  );
  return rows[0]?.id ?? fail(`location ${input.code} was not inserted`);
}

export async function insertAsset(
  db: Pg,
  input: { organizationId: string; locationId: string; code: string; name: string },
): Promise<string> {
  const domain = await db.query<{ code: string }>("SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1");
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
     VALUES ($1, $2, $3, $4, 'F4.291 site', $5) RETURNING id`,
    [
      input.organizationId,
      input.locationId,
      input.code,
      input.name,
      domain.rows[0]?.code ?? fail("bms.asset_domains is empty — run pnpm db:seed"),
    ],
  );
  return rows[0]?.id ?? fail(`asset ${input.code} was not inserted`);
}

export type AlarmInput = {
  readonly assetId: string;
  readonly severity: string;
  readonly raisedAt: Date;
  readonly acknowledgedAt?: Date | null;
  readonly clearedAt?: Date | null;
};

export async function insertAlarm(db: Pg, organizationId: string, input: AlarmInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, acknowledged_at, cleared_at)
     VALUES ($1, $2, $3, 'F4.291 fixture alarm', $4, $5, $6) RETURNING id`,
    [organizationId, input.assetId, input.severity, input.raisedAt, input.acknowledgedAt ?? null, input.clearedAt ?? null],
  );
  return rows[0]?.id ?? fail("alarm was not inserted");
}

/** Every row the fixture inserted, by its organization id, children first. */
export async function dropOrganization(db: Pg, organizationId: string): Promise<void> {
  await db.query("DELETE FROM bms.alarms WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.assets WHERE organization_id = $1", [organizationId]);
  // The fixtures are two levels deep (a site and its children): children first.
  await db.query("DELETE FROM bms.locations WHERE organization_id = $1 AND parent_id IS NOT NULL", [organizationId]);
  await db.query("DELETE FROM bms.locations WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.organizations WHERE id = $1", [organizationId]);
}

/** Two severities that exist in `bms.alarm_severities` (the FK), lowest rank last. */
export async function twoSeverities(db: Pg): Promise<{ high: string; low: string }> {
  const { rows } = await db.query<{ code: string }>(
    "SELECT code FROM bms.alarm_severities WHERE active = true ORDER BY rank DESC LIMIT 2",
  );
  if (rows.length < 2) fail("need two active alarm_severities rows — run pnpm db:seed");
  return { high: rows[0]!.code, low: rows[1]!.code };
}

export type AlarmListFiltersFixture = {
  readonly svc: AlarmsService;
  readonly organizationId: string;
  readonly assetId: string;
  /** Day 1 00:00Z; the alarms are `high` at day 1, `low` at day 2 and `low` at exactly day 3. */
  readonly day1: Date;
  readonly day2: Date;
  readonly day3: Date;
  readonly high: string;
  readonly low: string;
  /** The ids, by day. */
  readonly ids: { readonly d1: string; readonly d2: string; readonly d3: string };
};

/**
 * The fixture: one asset in a fresh organization, three alarms on three days.
 * `created` receives the organization id as soon as it is inserted, so the
 * suite drops it even when a later insert throws (no leaked organization).
 */
export async function buildAlarmListFiltersFixture(
  db: Pg,
  run: string,
  svc: AlarmsService,
  created: (organizationId: string) => void,
): Promise<AlarmListFiltersFixture> {
  const organizationId = await insertOrganization(db, `F4291-L-${run}`);
  created(organizationId);
  const site = await insertLocationRow(db, { organizationId, code: `F4291-L-${run}-S`, name: "F4.291 list site", parentId: null });
  const assetId = await insertAsset(db, { organizationId, locationId: site, code: `F4291-L-${run}-A`, name: "F4.291 list asset" });
  const { high, low } = await twoSeverities(db);
  const day1 = new Date("2026-03-01T00:00:00.000Z");
  const day2 = new Date("2026-03-02T00:00:00.000Z");
  const day3 = new Date("2026-03-03T00:00:00.000Z");
  const d1 = await insertAlarm(db, organizationId, { assetId, severity: high, raisedAt: day1 });
  const d2 = await insertAlarm(db, organizationId, { assetId, severity: low, raisedAt: day2 });
  const d3 = await insertAlarm(db, organizationId, { assetId, severity: low, raisedAt: day3 });
  return { svc, organizationId, assetId, day1, day2, day3, high, low, ids: { d1, d2, d3 } };
}

async function ids(fx: AlarmListFiltersFixture, filters: Record<string, unknown>): Promise<string[]> {
  const page = await fx.svc.list({ limit: 100, assetIds: [fx.assetId], state: "all", ...filters });
  return page.items.map((item) => item.id);
}

/** The positive neighbour every claim below stands beside: no filter lists all three. */
async function expectAllThree(fx: AlarmListFiltersFixture): Promise<void> {
  expect(await ids(fx, {})).toEqual([fx.ids.d3, fx.ids.d2, fx.ids.d1]);
}

/** `severity` keeps the alarms of that code only. */
export async function assertSeverityKeepsThatCodeOnly(fx: AlarmListFiltersFixture): Promise<void> {
  await expectAllThree(fx);
  expect(await ids(fx, { severity: fx.low })).toEqual([fx.ids.d3, fx.ids.d2]);
}

/** `raisedFrom` is inclusive and `raisedTo` exclusive: [day 2, day 3) holds the day-2 alarm only. */
export async function assertTheRaisedRangeIsHalfOpen(fx: AlarmListFiltersFixture): Promise<void> {
  await expectAllThree(fx);
  expect(await ids(fx, { raisedFrom: fx.day2, raisedTo: fx.day3 })).toEqual([fx.ids.d2]);
}

/** Both filters together are their intersection: `low` in [day 1, day 3) is the day-2 alarm. */
export async function assertSeverityAndRangeIntersect(fx: AlarmListFiltersFixture): Promise<void> {
  await expectAllThree(fx);
  expect(await ids(fx, { raisedFrom: fx.day1, raisedTo: fx.day3 })).toEqual([fx.ids.d2, fx.ids.d1]);
  expect(await ids(fx, { severity: fx.low, raisedFrom: fx.day1, raisedTo: fx.day3 })).toEqual([fx.ids.d2]);
}

/** The keyset cursor pages inside the filtered set: two pages of one, then no cursor. */
export async function assertTheCursorPagesInsideTheFilter(fx: AlarmListFiltersFixture): Promise<void> {
  await expectAllThree(fx);
  const filter = { assetIds: [fx.assetId], state: "all" as const, severity: fx.low };
  const first = await fx.svc.list({ ...filter, limit: 1 });
  expect(first.items.map((item) => item.id)).toEqual([fx.ids.d3]);
  expect(first.nextCursor).not.toBeNull();
  const second = await fx.svc.list({ ...filter, limit: 1, cursor: first.nextCursor ?? undefined });
  expect(second.items.map((item) => item.id)).toEqual([fx.ids.d2]);
  expect(second.nextCursor).toBeNull();
}
