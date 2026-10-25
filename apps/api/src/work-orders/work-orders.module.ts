import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";

@Module({
  controllers: [WorkOrdersController],
  // `F4.284` (ADR 0106): the writes audit through `MasterDataAuditService`; `WorkOrdersService`
  // is exported for the copilot's `list_work_orders` read tool.
  providers: [WorkOrdersService, MasterDataAuditService, JwtAuthGuard],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
