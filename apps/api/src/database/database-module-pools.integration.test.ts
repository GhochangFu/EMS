import { Logger, type INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, vi, type MockInstance } from "vitest";

import {
  assertCheckedOutClientLossIsLoggedForPool,
  assertCheckoutLeavesNoListenerBehind,
  assertIdleClientLossIsLoggedForPool,
  assertPoolServesTheNextQuery,
  assertPoolServesTheNextQueryAfterACheckout,
} from "./database-module-pools.integration.spec";
import { DatabaseModule } from "./database.module";
import { AUTH_POOL, FLEET_POOL, TENANT_POOL } from "./database.tokens";
import { requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";

/**
 * `F4.173` — Vitest entry point. Assertions live in the sibling `.spec` (ADR
 * 0014); see its header for what the suite holds.
 *
 * **The pools come from the real module.** A hand-built `pg.Pool` would prove
 * the listener pattern, not that `DatabaseModule` attaches it. The context is
 * booted with `NestFactory.createApplicationContext` because `@nestjs/testing`
 * is not a dependency of `apps/api`. It boots under esbuild although class
 * injection does not (AGENTS.md §4.6): every provider here is a `useFactory`
 * with an explicit `inject`, which needs no `design:paramtypes`.
 *
 * `resolveDatabaseUrls` reads `process.env` and has no injection point, so the
 * three role URLs are derived from `DATABASE_URL` into `process.env` when they
 * are not set (CI sets none of them), and restored afterwards.
 */

const connectionString = requireIntegrationDb({
  item: "F4.173",
  label: "DatabaseModule pools against a server-ended client",
  because:
    "a pg client with no 'error' listener throws when Postgres ends its backend. No other " +
    "suite boots DatabaseModule, so this is the only gate that api and worker survive a restart.",
  connection: "owner",
});

const ROLE_ENV = [
  ["auth", "DATABASE_URL_AUTH", "bms_auth", "BMS_AUTH_PASSWORD", "bms_auth_dev"],
  ["tenant", "DATABASE_URL_TENANT", "bms_tenant", "BMS_TENANT_PASSWORD", "bms_tenant_dev"],
  ["fleet", "DATABASE_URL_FLEET", "bms_fleet", "BMS_FLEET_PASSWORD", "bms_fleet_dev"],
] as const;

type PoolName = (typeof ROLE_ENV)[number][0];

describe.skipIf(!connectionString)(
  "F4.173 — DatabaseModule pools against a server-ended client",
  () => {
    const saved = new Map<string, string | undefined>();
    const urls = {} as Record<PoolName, string>;
    let pools: Record<PoolName, pg.Pool>;
    let app: INestApplicationContext;
    let spy: MockInstance<Logger["error"]>;

    beforeAll(async () => {
      for (const [name, envVar, role, passwordVar, fallback] of ROLE_ENV) {
        saved.set(envVar, process.env[envVar]);
        process.env[envVar] ??= asRole(
          connectionString as string,
          role,
          process.env[passwordVar] ?? fallback,
        );
        urls[name] = process.env[envVar] as string;
      }
      app = await NestFactory.createApplicationContext(DatabaseModule, {
        logger: false,
        abortOnError: false,
      });
      pools = {
        auth: app.get<pg.Pool>(AUTH_POOL),
        tenant: app.get<pg.Pool>(TENANT_POOL),
        fleet: app.get<pg.Pool>(FLEET_POOL),
      };
    });

    afterAll(async () => {
      // DatabaseModule has no onModuleDestroy, so the suite ends the pools.
      if (pools) await Promise.all(Object.values(pools).map((pool) => pool.end()));
      await app?.close();
      for (const [envVar, value] of saved) {
        if (value === undefined) delete process.env[envVar];
        else process.env[envVar] = value;
      }
    });

    beforeEach(() => {
      spy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      spy.mockRestore();
    });

    for (const [name] of ROLE_ENV) {
      it(`${name} pool logs the pool name and the terminate reason`, async () => {
        await assertIdleClientLossIsLoggedForPool(name, pools[name], urls[name], spy);
      });

      it(`${name} pool serves the next query after an idle client was ended`, async () => {
        await assertPoolServesTheNextQuery(name, pools[name], urls[name], spy);
      });

      it(`${name} pool logs a checked-out client's loss with the pool name and the reason`, async () => {
        await assertCheckedOutClientLossIsLoggedForPool(name, pools[name], urls[name], spy);
      });

      it(`${name} pool serves the next query after a checked-out client was ended`, async () => {
        await assertPoolServesTheNextQueryAfterACheckout(name, pools[name], urls[name], spy);
      });

      it(`${name} pool leaves no error listener behind after a checkout`, async () => {
        await assertCheckoutLeavesNoListenerBehind(pools[name]);
      });
    }
  },
);
