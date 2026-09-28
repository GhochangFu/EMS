import { Module } from "@nestjs/common";

import { DatabaseHealthService } from "./database-health.service";
import { HealthController } from "./health.controller";

@Module({
  controllers: [HealthController],
  // `F4.175` — `FLEET_POOL` comes from the global `DatabaseModule`, which both
  // `AppModule` and `WorkerModule` import.
  providers: [DatabaseHealthService],
})
export class HealthModule {}
