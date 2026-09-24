import { isNull } from "drizzle-orm";

import { alarms } from "@bms/db";

/**
 * `F3.28` (ADR 0074 decision 4) — the one definition of an **active** alarm
 * on a read: raised and not yet cleared, acknowledged or not.
 *
 * ADR 0057 decision 1: `cleared_at IS NULL` is what makes an alarm active.
 * Acknowledgement is an annotation, not a closure, so `acknowledged_at` has no
 * part in this predicate — an acknowledged, uncleared alarm is still active,
 * and a cleared, unacknowledged one is not.
 *
 * `GET /alarms?state=active` and the active-count-by-severity read both use
 * this, so the rail's rows and its counts cannot disagree on what "active"
 * means.
 */
export const activeAlarmFilter = isNull(alarms.clearedAt);
