import { Module } from "@nestjs/common";

import { AssetImagesController } from "./asset-images.controller";
import { AssetImagesService } from "./asset-images.service";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";

/**
 * `AccessControlService` resolves through the `@Global()` `AccessControlModule`,
 * the pool tokens through the global database module, and `STORAGE_CLIENT`
 * through the `@Global()` `StorageModule` (`F3.3`, ADR 0066 decision 6) — so
 * no `imports:` here.
 */
@Module({
  controllers: [AssetsController, AssetImagesController],
  providers: [AssetsService, AssetImagesService],
})
export class AssetsModule {}
