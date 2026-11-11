import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import {
  createWorkOrderChecklistTemplateBodySchema,
  type JwtPayload,
  updateWorkOrderChecklistTemplateBodySchema,
  type WorkOrderChecklistTemplateDto,
  type WorkOrderChecklistTemplatesResponse,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import { WorkOrderChecklistTemplatesAdminService } from "./work-order-checklist-templates.service";

const ORGANIZATION_REFUSAL = "Checklist templates are managed by an administrator of the organization";
/** One message for a missing template and a foreign one, so a refusal does not confirm the id exists (F4.64). */
const TEMPLATE_NOT_FOUND = "Checklist template not found";

/**
 * `E3.1` (ADR 0122 decision 4.2, plan T3.3) — `GET`, `POST` and `PATCH :id` of
 * `/admin/work-order-checklist-templates`. There is no `DELETE`: a template is retired
 * with `active: false`, never removed.
 *
 * The write gate order is fixed: `assertOperationsWriteRole(user, "configuration")` first
 * (ADR 0017 — an `operator` or `viewer` is refused before the body is read, so a malformed
 * body from one still reads 403), then the strict parse (400, ADR 0060), then the
 * organization check. `tests/e3.1-work-order-write-gates.test.ts` pins the first.
 *
 * **The organization check is `isOrganizationLevelAdmin`, not `canManageOrganization`.**
 * The ADR names the global `admin` and the `organization_admin` of the organization as the
 * only roles that may read or write a template. `canManageOrganization` answers `true` for
 * a `location_admin` in every organization where they hold one node (§4.7), which would
 * let one site's administrator rewrite the checklists every site's tickets copy. The read
 * runs the same check, so the read and the writes admit the same roles.
 *
 * `PATCH` does not name the organization, so it is read off the template first. A missing
 * template and a template outside the caller's organizations answer the same 404.
 */
@Controller("admin/work-order-checklist-templates")
@UseGuards(JwtAuthGuard)
export class WorkOrderChecklistTemplatesAdminController {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly service: WorkOrderChecklistTemplatesAdminService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("organizationId") organizationId: unknown,
  ): Promise<WorkOrderChecklistTemplatesResponse> {
    const id = parse(idParamSchema, organizationId);
    await this.assertOrganizationAdmin(user, id);
    return this.service.list(id);
  }

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() body: unknown): Promise<WorkOrderChecklistTemplateDto> {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    const parsed = parse(createWorkOrderChecklistTemplateBodySchema, body);
    await this.assertOrganizationAdmin(user, parsed.organizationId);
    return this.service.create(user, parsed);
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: JwtPayload,
    @Param("id") rawId: unknown,
    @Body() body: unknown,
  ): Promise<WorkOrderChecklistTemplateDto> {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    const id = parse(idParamSchema, rawId);
    const parsed = parse(updateWorkOrderChecklistTemplateBodySchema, body);
    // A fleet-pool read: the template's organization must be known before any tenant
    // setting exists, because it is the setting the write will run under.
    const organizationId = await this.service.organizationOf(id);
    if (organizationId === null || !(await this.accessControl.isOrganizationLevelAdmin(user, organizationId))) {
      throw new NotFoundException(TEMPLATE_NOT_FOUND);
    }
    return this.service.update(user, id, organizationId, parsed);
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
