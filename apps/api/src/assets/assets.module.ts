import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AssetImagesController } from "./asset-images.controller";
import { AssetImagesService } from "./asset-images.service";
import { AssetImagesWriteController } from "./asset-images-write.controller";
import { AssetImagesWriteService } from "./asset-images-write.service";
import { AssetRoleSummaryService } from "./asset-role-summary.service";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";

/**
 * `AccessControlService` resolves through the `@Global()` `AccessControlModule`,
 * the pool tokens through the global database module, and `STORAGE_CLIENT`
 * through the `@Global()` `StorageModule` (`F3.3`, ADR 0066 decision 6) — so
 * no `imports:` here.
 *
 * `MasterDataAuditService` is provided here rather than imported (`F3.4`,
 * ADR 0066 decision 7) — it is stateless (reads its Drizzle handles from the
 * database module's tokens on each call), so a second instance is not a
 * second copy of anything, matching how `AdminModule`, `NotificationsModule`
 * and `DashboardBuilderModule` each provide their own instance rather than
 * sharing one; `AdminModule` does not export it.
 */
@Module({
  controllers: [AssetsController, AssetImagesController, AssetImagesWriteController],
  providers: [
    AssetsService,
    AssetImagesService,
    AssetImagesWriteService,
    AssetRoleSummaryService,
    MasterDataAuditService,
  ],
})
export class AssetsModule {}
