import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Client } from "pg";

import { DATABASE_URL_AUTH_ENV_VAR } from "../database/database-urls";
import type { ListenerClient, NotifyListener } from "../database/notify-listener";
import { sleep } from "../telemetry/sleep";
import { AccessControlService } from "./access-control.service";
import { SocketRegistry } from "./socket-registry";
import { createUserDisabledListener } from "./user-disabled-notify";

/**
 * `F3.78` / ADR 0089 decision 8 — `LISTEN bms_user_disabled` to
 * `SocketRegistry.disconnectUser`, one per API process.
 *
 * **Wiring only**, the `AlarmNotifyService` shape: the loop is
 * `database/notify-listener.ts`, the decode-and-close decision is
 * `user-disabled-notify.ts`, and the tests are there. The `LISTEN` client
 * connects as `DATABASE_URL_AUTH` (`bms_auth`, the least privileged role —
 * `LISTEN` needs no grant), for the reason `alarm-notify.service.ts` records.
 *
 * Provided by `AuthModule` only, which the worker never imports
 * (`tests/f4.24-worker-imports-no-api-loop.test.ts` lists this file as a loop
 * site): the worker holds no socket to close.
 */
@Injectable()
export class UserDisabledListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UserDisabledListenerService.name);
  private listener: NotifyListener | null = null;

  constructor(
    private readonly registry: SocketRegistry,
    private readonly accessControl: AccessControlService,
  ) {}

  onModuleInit(): void {
    const url = process.env[DATABASE_URL_AUTH_ENV_VAR];
    if (!url) {
      this.logger.warn("DATABASE_URL_AUTH missing; bms_user_disabled listener disabled");
      return;
    }

    this.listener = createUserDisabledListener({
      createClient: () => new Client({ connectionString: url }) as unknown as ListenerClient,
      disconnectUser: (userId) => this.registry.disconnectUser(userId),
      // The catch-up on every connect: a NOTIFY sent while this LISTEN
      // connection was down is lost, so re-read the users holding a socket.
      connectedUserIds: () => this.registry.connectedUserIds(),
      readDisabledUserIds: (ids) => this.accessControl.disabledUserIds(ids),
      sleep,
      logger: {
        // Single-argument calls — see `alarm-notify.service.ts`.
        log: (message) => this.logger.log(message),
        warn: (message) => this.logger.warn(message),
        error: (message) => this.logger.error(message),
      },
    });
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
