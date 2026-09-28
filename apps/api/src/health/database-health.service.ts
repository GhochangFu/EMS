import type { DatabaseHealth } from "@bms/shared";
import { Inject, Injectable } from "@nestjs/common";
import type pg from "pg";

import { FLEET_POOL } from "../database/database.tokens";
import { DATABASE_HEALTH_TIMEOUT_MS, readDatabaseHealth } from "./database-health";

/**
 * `F4.175` — hands `readDatabaseHealth` a `select 1` on the fleet pool, the
 * pool both processes already hold (`DatabaseModule` is global and both
 * `AppModule` and `WorkerModule` import it).
 *
 * **The fleet pool, not a fresh client.** The probe answers "can this process
 * reach its database through the pool it serves requests from". A pool with
 * every client checked out waits for one, and past the timeout that reads
 * unreachable — which is the truth for a readiness probe: the process cannot
 * serve a request that needs the database either.
 *
 * `@Inject(FLEET_POOL)` is an explicit token, so the class boots under
 * esbuild as `DatabaseModule`'s providers do (AGENTS.md §4.6).
 */
@Injectable()
export class DatabaseHealthService {
  constructor(@Inject(FLEET_POOL) private readonly pool: pg.Pool) {}

  read(): Promise<DatabaseHealth> {
    return readDatabaseHealth({
      ping: async () => {
        await this.pool.query("select 1");
      },
      timeoutMs: DATABASE_HEALTH_TIMEOUT_MS,
    });
  }
}
