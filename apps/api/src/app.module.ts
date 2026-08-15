import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { AlarmsModule } from "./alarms/alarms.module";
import { AdminModule } from "./admin/admin.module";
import { AssetsModule } from "./assets/assets.module";
import { AuthModule } from "./auth/auth.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { MapModule } from "./map/map.module";
import { ObservabilityModule } from "./observability/observability.module";
import { OpenApiModule } from "./openapi/openapi.module";
import { ReportsModule } from "./reports/reports.module";
import { RulesModule } from "./rules/rules.module";
import { TelemetryModule } from "./telemetry/telemetry.module";
import { WorkOrdersModule } from "./work-orders/work-orders.module";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        transport:
          process.env.NODE_ENV !== "production"
            ? {
                target: "pino-pretty",
                options: { colorize: true, singleLine: true },
              }
            : undefined,
      },
    }),
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
    OpenApiModule,
  ],
})
export class AppModule {}
