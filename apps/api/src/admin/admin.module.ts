import { Module } from "@nestjs/common";

import { CredentialCryptoService } from "../security/credential-crypto.service";
import { AssetPointsAdminController } from "./asset-points/asset-points.controller";
import { AssetPointsAdminService } from "./asset-points/asset-points.service";
import { AssetsAdminController } from "./assets/assets.controller";
import { AssetsAdminService } from "./assets/assets.service";
import { LocationsAdminController } from "./locations/locations.controller";
import { LocationsAdminService } from "./locations/locations.service";
import { PointKeysAdminController } from "./point-keys/point-keys.controller";
import { PointKeysAdminService } from "./point-keys/point-keys.service";
import { MasterDataAuditService } from "./master-data-audit.service";
import { OnboardingController } from "./onboarding/onboarding.controller";
import { OnboardingCatalogService } from "./onboarding/onboarding-catalog.service";
import { OnboardingChatService } from "./onboarding/onboarding-chat.service";
import { OnboardingCommitService } from "./onboarding/onboarding-commit.service";
import { OnboardingExcelService } from "./onboarding/onboarding-excel.service";
import { OnboardingProtocolService } from "./onboarding/onboarding-protocol.service";
import { OnboardingService } from "./onboarding/onboarding.service";
import { OnboardingValidateService } from "./onboarding/onboarding-validate.service";
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
    OnboardingController,
  ],
  providers: [
    MasterDataAuditService,
    CredentialCryptoService,
    OnboardingValidateService,
    OnboardingProtocolService,
    OnboardingCatalogService,
    OnboardingExcelService,
    OnboardingChatService,
    OnboardingCommitService,
    OnboardingService,
    OrganizationsAdminService,
    LocationsAdminService,
    RtusAdminService,
    AssetsAdminService,
    AssetPointsAdminService,
    PointKeysAdminService,
  ],
})
export class AdminModule {}
