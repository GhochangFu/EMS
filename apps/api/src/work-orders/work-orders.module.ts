import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";

@Module({
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService, JwtAuthGuard],
})
export class WorkOrdersModule {}
