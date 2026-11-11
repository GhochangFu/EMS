import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { WorkOrderTaskAddService } from "./work-order-task-add.service";
import { WorkOrderTasksService } from "./work-order-tasks.service";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";

@Module({
  controllers: [WorkOrdersController],
  // `F4.284` (ADR 0106): the writes audit through `MasterDataAuditService`; `WorkOrdersService`
  // is exported for the copilot's `list_work_orders` read tool.
  // `E3.1` (ADR 0122 decision 4): the two checklist services, one per write route.
  providers: [WorkOrdersService, WorkOrderTasksService, WorkOrderTaskAddService, MasterDataAuditService, JwtAuthGuard],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
