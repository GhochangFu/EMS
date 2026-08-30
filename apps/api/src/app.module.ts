import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { AlarmsModule } from "./alarms/alarms.module";
import { AdminModule } from "./admin/admin.module";
import { AssetsModule } from "./assets/assets.module";
import { AuthModule } from "./auth/auth.module";
import { CalcModule } from "./calc/calc.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DashboardBuilderModule } from "./dashboard-builder/dashboard-builder.module";
import { DatabaseModule } from "./database/database.module";
import { AssetHealthModule } from "./asset-health/asset-health.module";
import { HealthModule } from "./health/health.module";
import { pinoHttpOptions } from "./logger.options";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { MapModule } from "./map/map.module";
import { NotificationsModule } from "./notifications/notifications.module";
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
    DashboardBuilderModule,
    AlarmsModule,
    CalcModule,
    AssetHealthModule,
    WorkOrdersModule,
    MaintenanceModule,
    RulesModule,
    ReportsModule,
    MapModule,
    VocabulariesModule,
    NotificationsModule,
  ],
})
export class AppModule {}
