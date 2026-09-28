import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { MimicLayoutsController } from "./mimic-layouts.controller";
import { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F3.32c` / ADR 0081 decision 3 — the mimic layout library.
 *
 * The `ControlRoomModule` shape: `DatabaseModule` for the tenant and fleet
 * Drizzle tokens, `AuthModule` for `AccessControlService`, and its own
 * `MasterDataAuditService` (stateless — it reads its Drizzle handles from
 * `DatabaseModule`'s tokens). Nothing is exported: the resolver reads the
 * layout tables itself, on its own pool.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MimicLayoutsController],
  providers: [MimicLayoutsService, MasterDataAuditService],
})
export class MimicLayoutsModule {}
