import { Module } from "@nestjs/common";

import { CredentialCryptoService } from "../security/credential-crypto.service";
import { VocabulariesModule } from "../vocabularies/vocabularies.module";
import { AssetPointCalcOverrideController } from "./asset-points/asset-point-calc-override.controller";
import { AssetPointCalcOverrideService } from "./asset-points/asset-point-calc-override.service";
import { AssetPointsAdminController } from "./asset-points/asset-points.controller";
import { AssetPointsAdminService } from "./asset-points/asset-points.service";
import { AssetTemplateInstantiationService } from "./asset-templates/asset-templates-instantiate.service";
import { AssetTemplateMigrationService } from "./asset-templates/asset-templates-migrate.service";
import { AssetTemplatesAdminController } from "./asset-templates/asset-templates.controller";
import { AssetTemplatesAdminService } from "./asset-templates/asset-templates.service";
import { DashboardTemplatesInstantiateService } from "./dashboard-templates/dashboard-templates-instantiate.service";
import { DashboardTemplatesStockService } from "./dashboard-templates/dashboard-templates-stock.service";
import { DashboardTemplatesController } from "./dashboard-templates/dashboard-templates.controller";
import { DashboardTemplatesService } from "./dashboard-templates/dashboard-templates.service";
import {
  AssetGroupMembersAdminController,
  AssetGroupsAdminController,
} from "./asset-groups/asset-groups.controller";
import { AssetGroupsAdminService } from "./asset-groups/asset-groups.service";
import { AssetsAdminController } from "./assets/assets.controller";
import { AssetsAdminService } from "./assets/assets.service";
import { AuditAdminController } from "./audit/audit.controller";
import { AuditAdminService } from "./audit/audit.service";
import { LocationsAdminController } from "./locations/locations.controller";
import { LocationsAdminService } from "./locations/locations.service";
import { PointKeysAdminController } from "./point-keys/point-keys.controller";
import { PointKeysAdminService } from "./point-keys/point-keys.service";
import { AssetRolesAdminController } from "./vocabularies/asset-roles.controller";
import { AssetRolesAdminService } from "./vocabularies/asset-roles.service";
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
import { ManualReadingsController } from "./telemetry-entry/manual-readings.controller";
import { TelemetryWriteService } from "./telemetry-entry/telemetry-write.service";
import { TelemetryImportController } from "./telemetry-import/telemetry-import.controller";
import { TelemetryImportService } from "./telemetry-import/telemetry-import.service";

@Module({
  imports: [VocabulariesModule],
  controllers: [
    OrganizationsAdminController,
    LocationsAdminController,
    RtusAdminController,
    AssetGroupsAdminController,
    AssetGroupMembersAdminController,
    AssetsAdminController,
    AssetPointsAdminController,
    AssetPointCalcOverrideController,
    PointKeysAdminController,
    AssetRolesAdminController,
    AssetTemplatesAdminController,
    DashboardTemplatesController,
    AuditAdminController,
    OnboardingController,
    ManualReadingsController,
    TelemetryImportController,
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
    AssetGroupsAdminService,
    AssetsAdminService,
    AssetPointsAdminService,
    AssetPointCalcOverrideService,
    PointKeysAdminService,
    AssetRolesAdminService,
    AssetTemplatesAdminService,
    AssetTemplateInstantiationService,
    AssetTemplateMigrationService,
    DashboardTemplatesService,
    DashboardTemplatesStockService,
    DashboardTemplatesInstantiateService,
    AuditAdminService,
    TelemetryWriteService,
    TelemetryImportService,
  ],
})
export class AdminModule {}
