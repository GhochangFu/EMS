import { Logger, Module } from "@nestjs/common";
import type { Pool } from "pg";

import { FLEET_POOL } from "../database/database.tokens";
import {
  EXISTING_ASSET_IDS_MAX_AGE_MS,
  EXISTING_ASSET_IDS_UNKNOWN_RELOAD_MS,
  ExistingAssetIds,
  loadExistingAssetIds,
} from "./existing-asset-ids";

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
    {
      // F4.159: the gateway's cache of bms.assets ids, read on the fleet pool.
      provide: ExistingAssetIds,
      inject: [FLEET_POOL],
      useFactory: (pool: Pool) => {
        const logger = new Logger(ExistingAssetIds.name);
        return new ExistingAssetIds({
          load: () => loadExistingAssetIds(pool),
          now: Date.now,
          maxAgeMs: EXISTING_ASSET_IDS_MAX_AGE_MS,
          unknownReloadMs: EXISTING_ASSET_IDS_UNKNOWN_RELOAD_MS,
          onLoadError: (err) =>
            logger.warn(`asset id load failed; keeping the last set, or forwarding unfiltered if none has loaded (${err instanceof Error ? err.message : String(err)})`),
        });
      },
    },
  ],
  exports: [TelemetryBroadcastHub],
})
export class TelemetryModule {}
