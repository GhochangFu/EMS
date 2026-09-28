import { Global, Logger, Module } from "@nestjs/common";
import pg from "pg";

import {
  AUTH_DRIZZLE,
  AUTH_POOL,
  FLEET_DRIZZLE,
  FLEET_POOL,
  TENANT_DRIZZLE,
  TENANT_POOL,
} from "./database.tokens";
import { resolveDatabaseUrls } from "./database-urls";
import { createDb } from "@bms/db";

const urls = (): ReturnType<typeof resolveDatabaseUrls> => resolveDatabaseUrls(process.env);

const logger = new Logger("DatabaseModule");

/**
 * `F4.173` — one pool, with the `'error'` listener every pool needs. pg-pool
 * emits `'error'` when the server ends a client that sits idle in the pool (a
 * Postgres restart, a failover, `pg_terminate_backend`, an idle-timeout proxy);
 * with no listener Node throws and the process exits, and this module is
 * imported by both the api and the worker. The event is routine, so it is
 * logged and nothing else: the pool has already dropped the client, and the
 * next query opens a fresh one. Only `err.message` is logged — the error object
 * carries the client, whose connection parameters include the password.
 */
function createPool(name: "auth" | "tenant" | "fleet", connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString });
  pool.on("error", (err: Error) => {
    logger.error(`${name} pool: idle client error: ${err.message}`);
  });
  return pool;
}

@Global()
@Module({
  providers: [
    {
      // ADR 0043 Amendment 1 sized this for login rate and shipped max: 4;
      // Task 6.5 then put every authenticated request's grant resolution
      // (resolveDbUser, writableOrganizationIds, writableLocationIds, ...) on
      // this same pool, making it the hot path Amendment 1's own Consequences
      // section already says it is. Matches TENANT_POOL/FLEET_POOL's pg
      // default (10) instead of a stale, narrower number.
      provide: AUTH_POOL,
      useFactory: (): pg.Pool => createPool("auth", urls().auth),
    },
    {
      provide: TENANT_POOL,
      useFactory: (): pg.Pool => createPool("tenant", urls().tenant),
    },
    {
      provide: FLEET_POOL,
      useFactory: (): pg.Pool => createPool("fleet", urls().fleet),
    },
    { provide: AUTH_DRIZZLE, useFactory: (pool: pg.Pool) => createDb(pool), inject: [AUTH_POOL] },
    {
      provide: TENANT_DRIZZLE,
      useFactory: (pool: pg.Pool) => createDb(pool),
      inject: [TENANT_POOL],
    },
    {
      provide: FLEET_DRIZZLE,
      useFactory: (pool: pg.Pool) => createDb(pool),
      inject: [FLEET_POOL],
    },
  ],
  exports: [AUTH_POOL, TENANT_POOL, FLEET_POOL, AUTH_DRIZZLE, TENANT_DRIZZLE, FLEET_DRIZZLE],
})
export class DatabaseModule {}
