import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { MimicSymbolLibrariesController } from "./mimic-symbol-libraries.controller";
import { MimicSymbolLibrariesService } from "./mimic-symbol-libraries.service";

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 4, 6 and 7 — organization symbol libraries, the upload
 * and the per-organization switch.
 *
 * The `MimicLayoutsModule` shape: `DatabaseModule` for the tenant and fleet Drizzle tokens,
 * `AuthModule` for `AccessControlService`, and its own `MasterDataAuditService`. Nothing is
 * exported (plan D5): the layouts service's live checks read the three tables themselves.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MimicSymbolLibrariesController],
  providers: [MimicSymbolLibrariesService, MasterDataAuditService],
})
export class MimicSymbolLibrariesModule {}
