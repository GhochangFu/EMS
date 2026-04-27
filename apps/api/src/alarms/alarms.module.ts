import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TelemetryModule } from "../telemetry/telemetry.module";

import { AlarmThresholdService } from "./alarm-threshold.service";
import { AlarmsController } from "./alarms.controller";
import { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";

@Module({
  imports: [TelemetryModule],
  controllers: [AlarmsController],
  providers: [
    AlarmsService,
    AlarmsGateway,
    AlarmThresholdService,
    JwtAuthGuard,
  ],
})
export class AlarmsModule {}
