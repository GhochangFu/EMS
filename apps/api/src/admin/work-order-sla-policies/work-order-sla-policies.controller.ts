import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import {
  type JwtPayload,
  putWorkOrderSlaPoliciesBodySchema,
  type WorkOrderSlaPoliciesResponse,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import { WorkOrderSlaPoliciesAdminService } from "./work-order-sla-policies.service";

const ORGANIZATION_REFUSAL = "Work-order SLA policies are managed by an administrator of the organization";

/**
 * `E3.1` (ADR 0122 decision 3.2, plan T1.6) — `GET` and `PUT /admin/work-order-sla-policies`.
 *
 * The `PUT` gate order is fixed: `assertOperationsWriteRole(user, "configuration")` first
 * (ADR 0017 — an `operator` or `viewer` is refused before the body is read, so a malformed
 * body from one still reads 403), then the strict body parse (400, ADR 0060), then the
 * organization check (403). `tests/e3.1-work-order-write-gates.test.ts` pins the first.
 *
 * **The organization check is `isOrganizationLevelAdmin`, not `canManageOrganization`.**
 * The ADR names the global `admin` and the `organization_admin` of the organization as the
 * only roles that may read or write a policy. `canManageOrganization` answers `true` for a
 * `location_admin` in every organization where they hold one node (§4.7), which would let
 * one site's administrator set every site's SLA; `isOrganizationLevelAdmin` answers for
 * exactly the two roles. The `GET` runs the same check: a policy is organization
 * configuration, not a read every scoped admin needs.
 */
@Controller("admin/work-order-sla-policies")
@UseGuards(JwtAuthGuard)
export class WorkOrderSlaPoliciesAdminController {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly service: WorkOrderSlaPoliciesAdminService,
  ) {}

  @Get()
  async get(
    @CurrentUser() user: JwtPayload,
    @Query("organizationId") organizationId: unknown,
  ): Promise<WorkOrderSlaPoliciesResponse> {
    const id = parse(idParamSchema, organizationId);
    await this.assertOrganizationAdmin(user, id);
    return this.service.get(id);
  }

  @Put()
  async put(@CurrentUser() user: JwtPayload, @Body() body: unknown): Promise<WorkOrderSlaPoliciesResponse> {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    const parsed = parse(putWorkOrderSlaPoliciesBodySchema, body);
    await this.assertOrganizationAdmin(user, parsed.organizationId);
    return this.service.put(user, parsed);
  }

  private async assertOrganizationAdmin(user: JwtPayload, organizationId: string): Promise<void> {
    if (!(await this.accessControl.isOrganizationLevelAdmin(user, organizationId))) {
      throw new ForbiddenException(ORGANIZATION_REFUSAL);
    }
  }
}

function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.flatten());
    }
    throw err;
  }
}
