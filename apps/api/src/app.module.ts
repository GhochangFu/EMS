import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { AlarmsModule } from "./alarms/alarms.module";
import { AdminModule } from "./admin/admin.module";
import { AssetsModule } from "./assets/assets.module";
import { AuthModule } from "./auth/auth.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { pinoHttpOptions } from "./logger.options";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { MapModule } from "./map/map.module";
import { ObservabilityModule } from "./observability/observability.module";
import { ReportsModule } from "./reports/reports.module";
import { RulesModule } from "./rules/rules.module";
import { TelemetryModule } from "./telemetry/telemetry.module";
import { VocabulariesModule } from "./vocabularies/vocabularies.module";
import { WorkOrdersModule } from "./work-orders/work-orders.module";

@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions }),
    DatabaseModule,
    ObservabilityModule,
    HealthModule,
    AuthModule,
    AdminModule,
    AssetsModule,
    TelemetryModule,
    DashboardModule,
    AlarmsModule,
    WorkOrdersModule,
    MaintenanceModule,
    RulesModule,
    ReportsModule,
    MapModule,
    VocabulariesModule,
  ],
})
export class AppModule {}
