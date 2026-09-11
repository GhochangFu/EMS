import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Client } from "pg";

import type { BmsDb } from "@bms/db";
import type { AlarmListItem } from "@bms/shared";

import { DATABASE_URL_AUTH_ENV_VAR } from "../database/database-urls";
import { FLEET_DRIZZLE } from "../database/database.tokens";
import type { ListenerClient, ListenerLogger, NotifyListener } from "../database/notify-listener";
import { MetricsService } from "../observability/metrics.service";
import { sleep } from "../telemetry/sleep";
import { readAlarmListItem } from "./alarm-list-item";
import { createAlarmNotifyListener, type AlarmNotifyDeps } from "./alarm-notify";
import { AlarmsGateway } from "./alarms.gateway";

/**
 * Builds the listener's dependencies.
 *
 * **Exported, and separate from `onModuleInit`, so the metric wiring is
 * testable** — for the reason `telemetry-notify.service.ts` gives for
 * `buildListenerDeps`: a mutation that deleted the `onStateChange` hook
 * entirely once left every test passing, because the listener suite covers
 * the *listener* and nothing covered the wiring that drives the gauge. Pure
 * over its arguments; the only impure things left in the service are
 * `new Client()`, the fleet handle and the clock.
 */
export function buildAlarmListenerDeps(args: {
  createClient: () => ListenerClient;
  readAlarm: (alarmId: string) => Promise<AlarmListItem | null>;
  gateway: Pick<AlarmsGateway, "broadcastCreated">;
  metrics: Pick<MetricsService, "setAlarmListenerConnected" | "countAlarmListenerReconnect">;
  logger: ListenerLogger;
}): AlarmNotifyDeps {
  return {
    createClient: args.createClient,
    readAlarm: args.readAlarm,
    broadcast: (alarm) => {
      args.gateway.broadcastCreated(alarm);
    },
    logger: args.logger,
    sleep,
    onStateChange: (state) => {
      args.metrics.setAlarmListenerConnected(state === "connected");
    },
    onReconnectAttempt: () => {
      args.metrics.countAlarmListenerReconnect();
    },
  };
}

/**
 * Subscribes to `bms_alarms` and turns each `created` into
 * `AlarmsGateway.broadcastCreated` (`F3.11`, ADR 0064 decision 4).
 *
 * **Wiring only** — the reconnect loop lives in `database/notify-listener.ts`
 * and the decode-read-broadcast decision in `alarm-notify.ts`, which is where
 * the tests are. This file supplies what cannot be unit tested: a real
 * `pg.Client`, the fleet handle, the gateway, the Nest logger and the clock.
 * Every API process runs one of these, so a raise on the worker, on `api` or
 * on `api-replica` reaches the sockets of every API process.
 *
 * **Two connections, two roles, deliberately.** The `LISTEN` client connects
 * as `DATABASE_URL_AUTH` — `bms_auth`, the least privileged of the three
 * roles: `NOBYPASSRLS` with narrow, named grants on four tables, versus
 * `bms_fleet`'s `BYPASSRLS` and full DML on every `bms.*` table. `LISTEN`
 * needs no schema or table grant — a channel name is not a schema object —
 * so the long-lived connection carries no privilege it does not use, and a
 * future accidental query on this client (a copy-paste, a debugging line)
 * fails loudly against the four-table grant instead of silently succeeding
 * with full access. The read the notification triggers is a separate
 * statement on the injected fleet handle, with its reason recorded on
 * `readAlarmListItem`.
 */
@Injectable()
export class AlarmNotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlarmNotifyService.name);
  private listener: NotifyListener | null = null;

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly gateway: AlarmsGateway,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    const url = process.env[DATABASE_URL_AUTH_ENV_VAR];
    if (!url) {
      this.logger.warn("DATABASE_URL_AUTH missing; alarm NOTIFY listener disabled");
      this.metrics.setAlarmListenerConnected(false);
      return;
    }

    this.listener = createAlarmNotifyListener(
      buildAlarmListenerDeps({
        createClient: () => new Client({ connectionString: url }) as unknown as ListenerClient,
        readAlarm: (alarmId) => readAlarmListItem(this.fleetDb, alarmId),
        gateway: this.gateway,
        metrics: this.metrics,
        logger: {
          // Single-argument calls on purpose — see `telemetry-notify.service.ts`:
          // Nest's `Logger.error(message, stack?, context?)` took an object
          // message as a stack and printed `{}`. The listener interpolates the
          // real text.
          log: (message) => this.logger.log(message),
          warn: (message) => this.logger.warn(message),
          error: (message) => this.logger.error(message),
        },
      }),
    );

    this.metrics.setAlarmListenerConnected(false);
    this.listener.start();
  }

  async onModuleDestroy(): Promise<void> {
    const listener = this.listener;
    this.listener = null;
    if (listener !== null) {
      await listener.stop();
    }
  }
}
