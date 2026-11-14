import { Module } from "@nestjs/common";
import type { Pool } from "pg";

import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE, FLEET_POOL } from "../database/database.tokens";
import { EnergyBillService } from "./energy-bill.service";
import { createEnergyRateResolver, EnergyRateResolver } from "./energy-rate-resolver";

/**
 * `F4.365` (ADR 0134) — provider-only and loop-free, so the cost reads
 * (`ReportsCoreModule`, `DashboardModule`) and the tariff routes can import it
 * without importing each other. `DatabaseModule` is global.
 *
 * `EnergyRateResolver` (U7) is the cost reads' tariff token: it builds its own
 * stateless `CalcParametersService` over `FLEET_DRIZZLE` rather than importing
 * `CalcModule`, which carries loops the worker must not start
 * (`ReportsCoreModule`'s docblock gives the reason).
 */
@Module({
  providers: [
    {
      provide: EnergyBillService,
      useFactory: (pool: Pool) => new EnergyBillService(pool),
      inject: [FLEET_POOL],
    },
    {
      provide: EnergyRateResolver,
      useFactory: (fleetDb: BmsDb, pool: Pool) => createEnergyRateResolver(fleetDb, pool),
      inject: [FLEET_DRIZZLE, FLEET_POOL],
    },
  ],
  exports: [EnergyBillService, EnergyRateResolver],
})
export class TariffRatesModule {}
