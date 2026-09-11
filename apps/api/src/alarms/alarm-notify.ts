import type { AlarmListItem, BackoffPolicy } from "@bms/shared";

import {
  createNotifyListener,
  reason,
  type ListenerClient,
  type ListenerLogger,
  type ListenerState,
  type NotifyListener,
} from "../database/notify-listener";
import { ALARM_NOTIFY_CHANNEL, decodeAlarmNotification } from "./alarm-notify-channel";

/**
 * `LISTEN bms_alarms` to `AlarmsGateway.broadcastCreated` (`F3.11`, ADR 0064
 * decision 4), on the generic `F4.34` loop.
 *
 * This is the decision half; `alarm-notify.service.ts` is the wiring. A
 * delivery is decoded through `decodeAlarmNotification` — `null` on any
 * failure, never a throw — and a valid one is answered with one read by id
 * and one broadcast of the row the read returned. The payload is ids only,
 * so the socket message is the database row, not a copy the producer made.
 *
 * **The raw payload is never logged** (§4.3's non-HTTP-input rule, §9.6).
 * `NOTIFY` needs no table privilege, so what arrives on the channel is data
 * of unknown provenance; an undecodable one is dropped with a fixed warn.
 * The alarm id that later warns *do* name is the schema's validated uuid,
 * not the payload text.
 *
 * **`organizationId` is validated and not yet read.** The schema requires it
 * so the producer cannot drop it, but nothing here scopes on it: the read is
 * fleet-wide (see `readAlarmListItem`) and the per-socket scope is the
 * gateway's. It is the payload `F4.133` extends when `acknowledged` and
 * `cleared` move onto this channel; until then the schema's `created`
 * literal is the only kind that decodes, so no `type` switch exists here —
 * `alarm-notify.spec.ts`'s `cleared` row reddens the day the literal widens.
 *
 * **The read is fire-and-forget on purpose.** `onNotification` runs inside a
 * `pg` event handler and must return synchronously; the promise is `void`ed
 * with its own `.catch`, because a rejection from a `.then` chain with no
 * handler is an unhandled rejection — and with nothing catching those in
 * this app, one slow fleet pool would take the API down through the very
 * loop that exists to keep it up.
 */
export type AlarmNotifyDeps = {
  /** A fresh client per attempt — `pg.Client` is not reusable after `end()`. */
  createClient(): ListenerClient;
  /** The alarm as the wire shape, or `null` when no row is visible. */
  readAlarm(alarmId: string): Promise<AlarmListItem | null>;
  /** `AlarmsGateway.broadcastCreated`. */
  broadcast(alarm: AlarmListItem): void;
  logger: ListenerLogger;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now?: () => number;
  random?: () => number;
  policy?: BackoffPolicy;
  stableMs?: number;
  onStateChange?(state: ListenerState): void;
  onReconnectAttempt?(): void;
};

/** Builds the listener. Nothing runs until `start()`. */
export function createAlarmNotifyListener(deps: AlarmNotifyDeps): NotifyListener {
  const { logger } = deps;
  return createNotifyListener({
    ...deps,
    channel: ALARM_NOTIFY_CHANNEL,
    onNotification: (raw) => {
      const notification = decodeAlarmNotification(raw);
      if (notification === null) {
        logger.warn(`Dropped an undecodable ${ALARM_NOTIFY_CHANNEL} payload`);
        return;
      }
      const { alarmId } = notification;
      void deps
        .readAlarm(alarmId)
        .then((row) => {
          if (row === null) {
            logger.warn(`${ALARM_NOTIFY_CHANNEL}: alarm ${alarmId} not found`);
            return;
          }
          // The read-back is the source of truth, not the payload. `NOTIFY`
          // needs no table privilege, so any connected role can replay a
          // known id; a row that is already cleared is not a `created`, and
          // emitting it would show every in-scope socket a stale alarm as
          // fresh (`F3.11` security review, L1). The legitimate race — an
          // auto-clear landing in the milliseconds between the raise's commit
          // and this read — drops the same way, and the lifecycle sweep's own
          // `cleared` broadcast is what the screen should see for it.
          if (row.clearedAt !== null) {
            logger.warn(`${ALARM_NOTIFY_CHANNEL}: alarm ${alarmId} is not active; dropped`);
            return;
          }
          deps.broadcast(row);
        })
        .catch((error: unknown) => {
          // Covers the read rejecting and `broadcast` throwing alike.
          logger.warn(`${ALARM_NOTIFY_CHANNEL}: fan-out failed for ${alarmId}: ${reason(error)}`);
        });
    },
  });
}
