import { alarms, type BmsDb } from "@bms/db";
import type { AlarmListItem } from "@bms/shared";
import { eq, sql, type SQL } from "drizzle-orm";

/**
 * `F3.16` / ADR 0127 decision 14 — who sees an alarm, stated once.
 *
 * A caller's read scope is its readable asset ids (`AccessControlService
 * .readableAssetIds`; `null` is the global admin, who sees every alarm).
 *
 * - a `rule` alarm is visible when its asset is in the scope (unchanged);
 * - an `rtu_comms` alarm when the scope holds at least one asset served by
 *   that RTU (`assets.rtu_id = alarms.rtu_id`);
 * - an `ingest_host` alarm when the scope holds at least one asset served by
 *   a **monitored** RTU (`bms.rtu_health.monitored_since IS NOT NULL`) of the
 *   alarm's organization.
 *
 * The rule has three readers and three renderings, all in this file so none
 * drifts: the SQL predicate over `bms.alarms` (Drizzle for `AlarmsService` and
 * `AlarmDetailsService`, raw text for `DashboardService`'s pool queries), and
 * the per-socket form `AlarmsGateway.emitScoped` uses — the two sets
 * {@link readDeviceAlarmScope} reads at connection, which are the same two
 * sub-selects the predicate embeds.
 */

/** The RTUs that serve an asset of the scope. `$SCOPE` is the uuid[] of asset ids. */
const RTUS_OF_SCOPE = (scope: string) =>
  `SELECT scope_a.rtu_id FROM bms.assets scope_a WHERE scope_a.rtu_id IS NOT NULL AND scope_a.id = ANY(${scope})`;

/** The organizations in which an asset of the scope is served by a monitored RTU. */
const HOST_ORGANIZATIONS_OF_SCOPE = (scope: string) =>
  "SELECT scope_a.organization_id FROM bms.assets scope_a " +
  "JOIN bms.rtu_health scope_h ON scope_h.rtu_id = scope_a.rtu_id " +
  "AND scope_h.organization_id = scope_a.organization_id " +
  `WHERE scope_h.monitored_since IS NOT NULL AND scope_a.id = ANY(${scope})`;

/** The alarm columns the predicate reads, in whichever rendering. */
type AlarmRefs<T> = { source: T; assetId: T; rtuId: T; organizationId: T };

const SCOPE_MARK = "\u0000scope\u0000";

/**
 * The predicate as an ordered list of literal text and the four column
 * references, with the scope (a `uuid[]`) spliced in at each {@link SCOPE_MARK}.
 * Both renderings below walk this one list.
 */
function predicateParts<T>(lit: (text: string) => T, a: AlarmRefs<T>, scope: T): T[] {
  const withScope = (text: string): T[] =>
    text.split(SCOPE_MARK).flatMap((piece, i) => (i === 0 ? [lit(piece)] : [scope, lit(piece)]));
  return [
    lit("(("),
    a.source,
    lit(" = 'rule' AND "),
    a.assetId,
    ...withScope(` = ANY(${SCOPE_MARK}))`),
    lit(" OR ("),
    a.source,
    lit(" = 'rtu_comms' AND "),
    a.rtuId,
    ...withScope(` IN (${RTUS_OF_SCOPE(SCOPE_MARK)}))`),
    lit(" OR ("),
    a.source,
    lit(" = 'ingest_host' AND "),
    a.organizationId,
    ...withScope(` IN (${HOST_ORGANIZATIONS_OF_SCOPE(SCOPE_MARK)})))`),
  ];
}

/**
 * Drizzle: `bms.alarms` rows visible to a bounded scope. The global admin
 * (`null`) takes no predicate at all — callers spread
 * `...(assetIds ? [alarmVisibleTo(assetIds)] : [])`.
 */
export function alarmVisibleTo(assetIds: readonly string[]): SQL {
  const scope = sql`${sql.param([...assetIds])}::uuid[]`;
  return sql.join(
    predicateParts<SQL>(
      (text) => sql.raw(text),
      {
        source: sql`${alarms.source}`,
        assetId: sql`${alarms.assetId}`,
        rtuId: sql`${alarms.rtuId}`,
        organizationId: sql`${alarms.organizationId}`,
      },
      scope,
    ),
  );
}

/**
 * Raw SQL text for a `pg` pool query: `alias` names `bms.alarms` in the
 * caller's FROM, `scopeParam` is the placeholder of a `uuid[]` parameter
 * (`$1`). A NULL parameter is the global admin and passes every alarm.
 *
 * **Both arguments are spliced into the SQL text unescaped**, so each must be a
 * literal written in the calling source (`"al"`, `"$1"`) — never a value from a
 * request, a row or configuration. The scope itself only ever travels as the
 * bound parameter.
 */
export function alarmVisibleToSql(alias: string, scopeParam: string): string {
  const scope = `${scopeParam}::uuid[]`;
  const body = predicateParts<string>(
    (text) => text,
    {
      source: `${alias}.source`,
      assetId: `${alias}.asset_id`,
      rtuId: `${alias}.rtu_id`,
      organizationId: `${alias}.organization_id`,
    },
    scope,
  ).join("");
  return `(${scope} IS NULL OR ${body})`;
}

/**
 * The device half of a bounded scope, for a reader that holds one alarm in
 * memory rather than a query (the socket): the RTUs serving an asset of the
 * scope, and the organizations where an asset of the scope is on a monitored
 * RTU.
 */
export type DeviceAlarmScope = {
  readonly rtuIds: readonly string[];
  readonly hostOrganizationIds: readonly string[];
};

export const EMPTY_DEVICE_ALARM_SCOPE: DeviceAlarmScope = { rtuIds: [], hostOrganizationIds: [] };

/**
 * Reads {@link DeviceAlarmScope} for a bounded scope with the predicate's own
 * two sub-selects. Fleet handle: the scope spans organizations and was already
 * computed by `AccessControlService` (the "bypass, then trust an
 * already-computed grant" shape of `withReadScope`).
 */
export async function readDeviceAlarmScope(db: BmsDb, assetIds: readonly string[]): Promise<DeviceAlarmScope> {
  if (assetIds.length === 0) {
    return EMPTY_DEVICE_ALARM_SCOPE;
  }
  const scope = sql`${sql.param([...assetIds])}::uuid[]`;
  const subselect = (render: (s: string) => string) =>
    sql.join(render(SCOPE_MARK).split(SCOPE_MARK).flatMap((piece, i) => (i === 0 ? [sql.raw(piece)] : [scope, sql.raw(piece)])));
  const result = await db.execute<{ kind: "rtu" | "org"; id: string }>(sql`
    SELECT DISTINCT 'rtu' AS kind, rtu_id::text AS id FROM (${subselect(RTUS_OF_SCOPE)}) r
    UNION
    SELECT DISTINCT 'org' AS kind, organization_id::text AS id FROM (${subselect(HOST_ORGANIZATIONS_OF_SCOPE)}) o`);
  return {
    rtuIds: result.rows.filter((r) => r.kind === "rtu").map((r) => r.id),
    hostOrganizationIds: result.rows.filter((r) => r.kind === "org").map((r) => r.id),
  };
}

/** `bms.alarms.organization_id` of one alarm, or `null` when no row has the id. */
export async function readAlarmOrganization(db: BmsDb, alarmId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: alarms.organizationId })
    .from(alarms)
    .where(eq(alarms.id, alarmId))
    .limit(1);
  return row?.organizationId ?? null;
}

/**
 * The rule over one alarm in memory. `assetIds === null` is the global admin.
 * `organizationId` is the alarm's own and is read only for an `ingest_host`
 * alarm (the list item does not carry it); `null` there fails closed.
 */
export function alarmVisibleInMemory(
  alarm: Pick<AlarmListItem, "source" | "assetId" | "rtuId">,
  organizationId: string | null,
  assetIds: readonly string[] | null,
  device: DeviceAlarmScope,
): boolean {
  if (assetIds === null) {
    return true;
  }
  switch (alarm.source) {
    case "rule":
      return alarm.assetId !== null && assetIds.includes(alarm.assetId);
    case "rtu_comms":
      return alarm.rtuId !== null && device.rtuIds.includes(alarm.rtuId);
    case "ingest_host":
      return organizationId !== null && device.hostOrganizationIds.includes(organizationId);
  }
}
