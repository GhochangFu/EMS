import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TelemetryModule } from "../telemetry/telemetry.module";

import { AlarmEngineService } from "./alarm-engine.service";
import { AlarmRaiser } from "./alarm-raise.service";
import { AlarmsController } from "./alarms.controller";
import { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";

@Module({
  imports: [TelemetryModule],
  controllers: [AlarmsController],
  providers: [
    AlarmsService,
    AlarmsGateway,
    AlarmEngineService,
    AlarmRaiser,
    JwtAuthGuard,
  ],
  // `RulesModule` (F3.6 task 5) needs `AlarmRaiser` so the on-demand evaluator
  // raises through the same engine as the streaming path.
  exports: [AlarmRaiser],
})
export class AlarmsModule {}
