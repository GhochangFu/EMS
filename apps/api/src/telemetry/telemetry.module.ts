import { Module } from "@nestjs/common";

import { TelemetryBroadcastHub } from "./telemetry-broadcast.hub";
import { TelemetryController } from "./telemetry.controller";
import { TelemetryGateway } from "./telemetry.gateway";
import { TelemetryNotifyService } from "./telemetry-notify.service";
import { TelemetryService } from "./telemetry.service";

@Module({
  controllers: [TelemetryController],
  providers: [
    TelemetryService,
    TelemetryBroadcastHub,
    TelemetryNotifyService,
    TelemetryGateway,
  ],
  exports: [TelemetryBroadcastHub],
})
export class TelemetryModule {}
