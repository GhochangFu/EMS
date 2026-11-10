import { Global, Inject, Injectable, Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import { createClient } from "redis";

import { MetricsService } from "../observability/metrics.service";
import { readRateLimitConfig, type RateLimitConfig } from "./rate-limit-config";
import { RateLimitStore, type RedisEvalClient } from "./rate-limit-store";
import { RateLimiterService } from "./rate-limiter.service";

/**
 * `F4.17` / ADR 0125 — the limiter, global so the guard and both Socket.IO
 * gateways resolve it from whichever module declares them. Imported by
 * `AppModule` only: the worker serves no `/api/v1` route.
 *
 * **Redis's third approved use** (ADR 0125 Q13): fixed-window counters with a
 * TTL, on their own node-redis client. `disableOfflineQueue` makes a command
 * fail at once while disconnected instead of queueing behind a reconnect, so
 * the store falls back to memory within one call. The URL is never logged —
 * after `F3.12` it will carry a password.
 */

export const RATE_LIMIT_REDIS = Symbol("RATE_LIMIT_REDIS");
export const RATE_LIMIT_CONFIG = Symbol("RATE_LIMIT_CONFIG");

type ClosableRedis = RedisEvalClient & { readonly isOpen: boolean; destroy(): void };

const logger = new Logger("RateLimitModule");

function createRateLimitRedis(env: NodeJS.ProcessEnv): ClosableRedis | null {
  const url = env.REDIS_URL?.trim();
  if (!url) {
    logger.warn("REDIS_URL missing; rate limits are counted per process (store: memory)");
    return null;
  }
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: (retries: number) => Math.min(250 * 2 ** retries, 5_000),
    },
  });
  let reported = false;
  client.on("error", (err: Error) => {
    // Once per outage, not once per reconnect attempt.
    if (!reported) {
      reported = true;
      logger.error(`rate-limit Redis client error: ${err.message}`);
    }
  });
  client.on("ready", () => {
    reported = false;
  });
  client.connect().catch(() => {
    // The reconnect strategy keeps trying; until it succeeds the store reads
    // `isReady === false` and counts in memory.
  });
  return client as unknown as ClosableRedis;
}

@Injectable()
class RateLimitRedisCloser implements OnModuleDestroy {
  constructor(@Inject(RATE_LIMIT_REDIS) private readonly client: ClosableRedis | null) {}

  onModuleDestroy(): void {
    // node-redis throws "The client is closed" from `destroy()` on a client
    // that never opened or already closed; shutdown must not.
    if (this.client?.isOpen) {
      this.client.destroy();
    }
  }
}

@Global()
@Module({
  providers: [
    { provide: RATE_LIMIT_CONFIG, useFactory: () => readRateLimitConfig(process.env) },
    { provide: RATE_LIMIT_REDIS, useFactory: () => createRateLimitRedis(process.env) },
    RateLimitRedisCloser,
    {
      provide: RateLimitStore,
      inject: [RATE_LIMIT_REDIS, { token: MetricsService, optional: true }],
      useFactory: (redis: ClosableRedis | null, metrics?: MetricsService) =>
        new RateLimitStore({ redis, onStoreError: () => metrics?.recordRateLimitStoreError() }),
    },
    {
      provide: RateLimiterService,
      inject: [RATE_LIMIT_CONFIG, RateLimitStore, { token: MetricsService, optional: true }],
      useFactory: (config: RateLimitConfig, store: RateLimitStore, metrics?: MetricsService) =>
        new RateLimiterService(config, store, metrics ?? null),
    },
  ],
  exports: [RateLimiterService, RATE_LIMIT_CONFIG],
})
export class RateLimitModule {}
