import { z } from "zod";

/**
 * `F3.11` / ADR 0064 decision 4 — the Postgres channel a raised alarm is
 * announced on, and the shape of what rides it.
 *
 * Declared once and shared by both sides (§4.8): the producer is
 * `AlarmRaiser.raise`, which issues `pg_notify` as the last statement of its
 * `withTenant` transaction, and the consumer is `AlarmNotifyService`, which
 * runs `LISTEN bms_alarms` in every API process and turns a delivery into
 * `AlarmsGateway.broadcastCreated`. Postgres delivers a transactional `NOTIFY`
 * on commit and drops it on rollback, so a refused or rolled-back raise
 * notifies nobody and a listener never reads an id before the row is visible.
 *
 * A channel name is not a schema object: no grant, no migration (ADR 0064
 * Dependencies). The payload is ids only, never the alarm body — well under
 * Postgres's 8000-byte limit and inside ADR 0016 §2's `MAX_NOTIFY_UTF8_BYTES`
 * discipline — so the listener reads the alarm through `alarmListItemColumns`
 * itself and the socket message is the row, not a copy of it.
 */
export const ALARM_NOTIFY_CHANNEL = "bms_alarms";

/**
 * `F4.133` widens `type` to `z.enum([...])` when `acknowledged` and `cleared`
 * move onto this channel; today the listener acts on `created` only, so the
 * literal is the whole vocabulary. `.strict()`: a producer that grows the body
 * without widening the schema is refused at the consumer, not silently read.
 * `.uuid()` on both ids: the listener queries by `alarmId`, so a non-uuid never
 * reaches the query.
 */
export const alarmNotificationSchema = z
  .object({
    type: z.literal("created"),
    alarmId: z.string().uuid(),
    organizationId: z.string().uuid(),
  })
  .strict();

export type AlarmNotification = z.infer<typeof alarmNotificationSchema>;

/**
 * The bytes the producer binds as `pg_notify`'s second argument. Key order is
 * fixed — `type`, `alarmId`, `organizationId` — so the wire form is one exact
 * string a spec can assert rather than whatever property order the caller's
 * object literal happened to use.
 */
export function encodeAlarmNotification(n: AlarmNotification): string {
  return JSON.stringify({
    type: n.type,
    alarmId: n.alarmId,
    organizationId: n.organizationId,
  });
}

/**
 * The consumer's parse. `null` on any failure — a payload that is not JSON,
 * one that fails the schema, or an absent one — never a throw: this runs
 * inside a `pg` client's `notification` handler, where an escaped exception
 * would tear the listener down (§4.3, "input is not only HTTP"). The listener
 * ignores a `null`; it does not log the raw payload (§9.6).
 */
export function decodeAlarmNotification(raw: string | undefined): AlarmNotification | null {
  if (raw === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = alarmNotificationSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
