import { Global, Module } from "@nestjs/common";
import pg from "pg";

import { DRIZZLE, POOL_TOKEN } from "./database.tokens";
import { createDb } from "@bms/db";

@Global()
@Module({
  providers: [
    {
      provide: POOL_TOKEN,
      useFactory: (): pg.Pool => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error("DATABASE_URL is required");
        }
        return new pg.Pool({ connectionString: url });
      },
    },
    {
      provide: DRIZZLE,
      useFactory: (pool: pg.Pool) => createDb(pool),
      inject: [POOL_TOKEN],
    },
  ],
  exports: [DRIZZLE, POOL_TOKEN],
})
export class DatabaseModule {}
