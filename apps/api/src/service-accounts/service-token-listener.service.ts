import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import { Client } from "pg";

import { serviceAccountTokens } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { SocketRegistry } from "../auth/socket-registry";
import { DATABASE_URL_AUTH_ENV_VAR } from "../database/database-urls";
import { AUTH_DRIZZLE } from "../database/database.tokens";
import type { ListenerClient, NotifyListener } from "../database/notify-listener";
import { sleep } from "../telemetry/sleep";
import { createServiceTokenRevokedListener } from "./service-token-notify";
import { ServiceTokenVerifier } from "./service-token-verifier.service";

/** `F4.17` / ADR 0125 decision 13 — the `bms_service_token_revoked` LISTEN client of this process. */
@Injectable()
export class ServiceTokenListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceTokenListenerService.name);
  private listener: NotifyListener | null = null;

  constructor(
    private readonly verifier: ServiceTokenVerifier,
    private readonly registry: SocketRegistry,
    @Inject(AUTH_DRIZZLE) private readonly authDb: BmsDb,
  ) {}

  onModuleInit(): void {
    const url = process.env[DATABASE_URL_AUTH_ENV_VAR];
    if (!url) {
      this.logger.warn("DATABASE_URL_AUTH missing; bms_service_token_revoked listener disabled");
      return;
    }
    this.listener = createServiceTokenRevokedListener({
      createClient: () => new Client({ connectionString: url }) as unknown as ListenerClient,
      forget: (tokenId) => this.verifier.forget(tokenId),
      forgetAll: () => this.verifier.forgetAll(),
      disconnectServiceToken: (tokenId) => this.registry.disconnectServiceToken(tokenId),
      connectedServiceTokenIds: () => this.registry.connectedServiceTokenIds(),
      readLiveTokenIds: async (ids) => {
        // `bms_auth`'s policy sees live tokens only (migration 0145).
        const rows = await this.authDb
          .select({ tokenId: serviceAccountTokens.tokenId })
          .from(serviceAccountTokens)
          .where(inArray(serviceAccountTokens.tokenId, [...ids]));
        return rows.map((row) => row.tokenId);
      },
      sleep,
      logger: {
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
