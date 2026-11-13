import { randomUUID } from "node:crypto";

import type pg from "pg";

/**
 * `F4.359` — the maintenance-cover fixtures shared by
 * `alarms/maintenance-cover.reads.integration.spec.ts`,
 * `alarm-raise.service.rls.integration.spec.ts`,
 * `alarm-suppression.integration.spec.ts` and
 * `alarm-lifecycle.integration.spec.ts`: an organization of its own, inserted
 * as the superuser and committed, its windows, and its teardown by id. They
 * live here, not in a rollback-isolated spec, because the teardown deletes the
 * organization's own assets (tests/integration-fixture-isolation.test.ts).
 */

/** A raw `pg` handle with the one method the fixture uses. */
export type Pg = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
};

function fail(message: string): never {
  throw new Error(message);
}

/**
 * One organization's tree and plant: SITE > BUILDING > ROOM, and ROOM_B beside
 * ROOM. `rtuId` is at ROOM and feeds `assetIds[0]` and `assetIds[1]` (both at
 * ROOM, K4); `assetIds[2]` is at ROOM_B and unwired. `ruleId` and `otherRuleId`
 * are threshold rules on `assetIds[0]`.
 */
export type CoverOrganization = {
  readonly organizationId: string;
  readonly site: string;
  readonly building: string;
  readonly room: string;
  readonly roomB: string;
  readonly rtuId: string;
  readonly assetIds: readonly [string, string, string];
  readonly ruleId: string;
  readonly otherRuleId: string;
  /** The oldest seeded user (F4.53) — a window's `created_by` / `ended_by`. */
  readonly userId: string;
};

async function one(db: Pg, text: string, values: unknown[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(text, values);
  return rows[0]?.id ?? fail(`no row returned by: ${text.slice(0, 60)}`);
}

/** Inserts a fresh organization and its plant as the superuser. `tag` makes every code unique. */
export async function insertCoverOrganization(db: Pg, tag: string): Promise<CoverOrganization> {
  const suffix = `${tag}-${randomUUID().slice(0, 8)}`.toUpperCase();
  const organizationId = await one(db, `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`, [
    `F4359-${suffix}`,
    `F4.359 ${suffix}`,
  ]);
  const location = (code: string, parentId: string | null): Promise<string> =>
    one(
      db,
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
       VALUES ($1, $2, $3, $2, 'smoc_campus', 0, 0, $4, true) RETURNING id`,
      [organizationId, `${code}-${suffix}`, `${code}-${suffix}`.toLowerCase(), parentId],
    );
  const site = await location("SITE", null);
  const building = await location("BLDG", site);
  const room = await location("ROOM", building);
  const roomB = await location("ROOMB", building);
  const rtuId = await one(
    db,
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type) VALUES ($1, $2, $3, $3, 'mqtt') RETURNING id`,
    [organizationId, room, `RTU-${suffix}`],
  );
  const domain = await db.query<{ code: string }>("SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1");
  const domainCode = domain.rows[0]?.code ?? fail("bms.asset_domains is empty — run pnpm db:seed");
  const asset = (code: string, locationId: string, wiredTo: string | null): Promise<string> =>
    one(
      db,
      `INSERT INTO bms.assets (organization_id, location_id, rtu_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $4, $4, 'F4.359 site', $5) RETURNING id`,
      [organizationId, locationId, wiredTo, `${code}-${suffix}`, domainCode],
    );
  const assetIds = [await asset("A1", room, rtuId), await asset("A2", room, rtuId), await asset("A3", roomB, null)] as const;
  const rule = (code: string): Promise<string> =>
    one(
      db,
      `INSERT INTO bms.automation_rules
         (organization_id, code, name, category, rule_type, asset_id, point_key, operator, threshold_value, severity)
       VALUES ($1, $2, $2, 'safety', 'threshold', $3, $4, 'gte', 999999, 'warning') RETURNING id`,
      [organizationId, `${code}-${suffix}`, assetIds[0], `f4359_${code.toLowerCase()}`],
    );
  const ruleId = await rule("R1");
  const otherRuleId = await rule("R2");
  const userId = await one(db, "SELECT id FROM bms.users ORDER BY created_at, id LIMIT 1", []);
  return { organizationId, site, building, room, roomB, rtuId, assetIds, ruleId, otherRuleId, userId };
}

export type WindowInput = {
  /** Offsets from the database's `now()`, in seconds. */
  readonly startsInSeconds: number;
  readonly endsInSeconds: number;
  readonly ended?: boolean;
  readonly assetIds?: readonly string[];
  readonly locationIds?: readonly string[];
  readonly ruleIds?: readonly string[];
};

/** A window and its targets, on the database clock. `ended` writes `ended_at`/`ended_by` (an early end). */
export async function insertWindow(db: Pg, org: CoverOrganization, input: WindowInput): Promise<string> {
  const id = await one(
    db,
    `INSERT INTO bms.maintenance_windows (organization_id, reason, starts_at, ends_at, created_by, ended_at, ended_by)
     VALUES ($1, 'F4.359 cover fixture', now() + make_interval(secs => $2), now() + make_interval(secs => $3), $4,
             CASE WHEN $5 THEN now() END, CASE WHEN $5 THEN $4::uuid END)
     RETURNING id`,
    [org.organizationId, input.startsInSeconds, input.endsInSeconds, org.userId, input.ended ?? false],
  );
  const target = async (column: "asset_id" | "location_id" | "rule_id", ids: readonly string[] | undefined): Promise<void> => {
    for (const targetId of ids ?? []) {
      await db.query(`INSERT INTO bms.maintenance_window_targets (window_id, organization_id, ${column}) VALUES ($1, $2, $3)`, [
        id,
        org.organizationId,
        targetId,
      ]);
    }
  };
  await target("asset_id", input.assetIds);
  await target("location_id", input.locationIds);
  await target("rule_id", input.ruleIds);
  return id;
}

/** Every row the fixture and the code under test wrote for the organization, children first. */
export async function dropCoverOrganization(db: Pg, organizationId: string): Promise<void> {
  await db.query("DELETE FROM bms.notification_deliveries WHERE organization_id = $1", [organizationId]);
  await db.query(
    "DELETE FROM bms.rule_notifications WHERE channel_id IN (SELECT id FROM bms.notification_channels WHERE organization_id = $1)",
    [organizationId],
  );
  await db.query("DELETE FROM bms.notification_channels WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.rule_executions WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.alarms WHERE organization_id = $1", [organizationId]);
  // A window (its targets cascade) keys to the assets, locations and rules below,
  // and an alarm keys to its window: windows after alarms, before the rest.
  await db.query("DELETE FROM bms.maintenance_windows WHERE organization_id = $1", [organizationId]);
  // ADR 0024: resolve the ids first; only a constant filter on the SEGMENTBY
  // column prunes compressed telemetry batches.
  const { rows: assetRows } = await db.query<{ id: string }>("SELECT id FROM bms.assets WHERE organization_id = $1", [
    organizationId,
  ]);
  const assetIds = assetRows.map((row) => row.id);
  if (assetIds.length > 0) {
    await db.query("DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])", [assetIds]);
  }
  await db.query("DELETE FROM bms.automation_rules WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.assets WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.rtus WHERE organization_id = $1", [organizationId]);
  // Three levels deep: leaves, then the building, then the site.
  for (let i = 0; i < 3; i += 1) {
    await db.query(
      `DELETE FROM bms.locations l WHERE l.organization_id = $1
          AND NOT EXISTS (SELECT 1 FROM bms.locations c WHERE c.parent_id = l.id)`,
      [organizationId],
    );
  }
  await db.query("DELETE FROM bms.organizations WHERE id = $1", [organizationId]);
}
