import { Global, Module } from "@nestjs/common";
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
      useFactory: (): pg.Pool => new pg.Pool({ connectionString: urls().auth }),
    },
    {
      provide: TENANT_POOL,
      useFactory: (): pg.Pool => new pg.Pool({ connectionString: urls().tenant }),
    },
    {
      provide: FLEET_POOL,
      useFactory: (): pg.Pool => new pg.Pool({ connectionString: urls().fleet }),
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
