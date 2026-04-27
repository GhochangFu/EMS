import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { AlarmsModule } from "./alarms/alarms.module";
import { AssetsModule } from "./assets/assets.module";
import { AuthModule } from "./auth/auth.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { MapModule } from "./map/map.module";
import { TelemetryModule } from "./telemetry/telemetry.module";

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
    HealthModule,
    AuthModule,
    AssetsModule,
    TelemetryModule,
    DashboardModule,
    AlarmsModule,
    MapModule,
  ],
})
export class AppModule {}
