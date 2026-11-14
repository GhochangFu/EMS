import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AdminTariffVersionsController } from "./admin-tariff-versions.controller";
import { LocationEnergyBillController } from "./location-energy-bill.controller";
import { LocationEnergyBillService } from "./location-energy-bill.service";
import { LocationTariffsController } from "./location-tariffs.controller";
import { LocationTariffsService } from "./location-tariffs.service";
import { OrgTariffVersionsService } from "./org-tariff-versions.service";
import { TariffLinesService } from "./tariff-lines.service";
import { TariffRatesModule } from "./tariff-rates.module";
import { TariffsController } from "./tariffs.controller";

/**
 * `F4.365` (ADR 0134) — the tariff routes. `EnergyBillService` comes from the
 * provider-only `TariffRatesModule` (the cost reads import that module, never
 * this one); `AccessControlService` from the `@Global()` `AccessControlModule`;
 * the audit funnel is provided here, the `MaintenanceWindowsModule` precedent.
 */
@Module({
  imports: [TariffRatesModule],
  controllers: [TariffsController, LocationEnergyBillController, LocationTariffsController, AdminTariffVersionsController],
  providers: [TariffLinesService, LocationEnergyBillService, LocationTariffsService, OrgTariffVersionsService, MasterDataAuditService],
})
export class TariffsModule {}
