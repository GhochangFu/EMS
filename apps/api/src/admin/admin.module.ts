import { Module } from "@nestjs/common";

import { AssetPointsAdminController } from "./asset-points/asset-points.controller";
import { AssetPointsAdminService } from "./asset-points/asset-points.service";
import { AssetsAdminController } from "./assets/assets.controller";
import { AssetsAdminService } from "./assets/assets.service";
import { LocationsAdminController } from "./locations/locations.controller";
import { LocationsAdminService } from "./locations/locations.service";
import { PointKeysAdminController } from "./point-keys/point-keys.controller";
import { PointKeysAdminService } from "./point-keys/point-keys.service";
import { MasterDataAuditService } from "./master-data-audit.service";
import { OrganizationsAdminController } from "./organizations/organizations.controller";
import { OrganizationsAdminService } from "./organizations/organizations.service";
import { RtusAdminController } from "./rtus/rtus.controller";
import { RtusAdminService } from "./rtus/rtus.service";

@Module({
  controllers: [
    OrganizationsAdminController,
    LocationsAdminController,
    RtusAdminController,
    AssetsAdminController,
    AssetPointsAdminController,
    PointKeysAdminController,
  ],
  providers: [
    MasterDataAuditService,
    OrganizationsAdminService,
    LocationsAdminService,
    RtusAdminService,
    AssetsAdminService,
    AssetPointsAdminService,
    PointKeysAdminService,
  ],
})
export class AdminModule {}
