import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import {
  setOrganizationAppearanceBodySchema,
  setOrganizationColourProfileBodySchema,
  setOrganizationIngestBodySchema,
} from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema, parseActiveFilter } from "../admin.schema";
import {
  createOrganizationBodySchema,
  updateOrganizationBodySchema,
} from "./organizations.schema";
import { OrganizationsAdminService } from "./organizations.service";

@Controller("admin/organizations")
@UseGuards(JwtAuthGuard)
export class OrganizationsAdminController {
  constructor(private readonly service: OrganizationsAdminService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query("active") active?: string) {
    return this.service.list(user, parseActiveFilter(active));
  }

  @Get(":id")
  async getById(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getById(user, idParamSchema.parse(id));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.create(user, createOrganizationBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.update(
        user,
        idParamSchema.parse(id),
        updateOrganizationBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * `F4.341` (ADR 0118 decision 10) — the organization's design system and colour profile, each
   * nullable (`null` inherits the portal default). Its own route, not a `PATCH` field: an
   * `organization_admin` may make this write for their own organization and no other organization
   * write. A body other than the strict two-key shape is a 400.
   */
  @Put(":id/appearance")
  async setAppearance(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      const parsed = setOrganizationAppearanceBodySchema.parse(body);
      return await this.service.setAppearance(user, idParamSchema.parse(id), parsed);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * `F4.310` (ADR 0110 decision 7) — the organization's colour profile. Since `F4.341` an alias of
   * `PUT :id/appearance` for the profile alone; `F4.342` removes it after the next release tag
   * (ADR 0118 Amendment 2 P5). Its own route, not a
   * `PATCH` field: an `organization_admin` may make this one write and no other organization
   * write (`PATCH`'s strict body refuses `colourProfile`).
   */
  @Put(":id/colour-profile")
  async setColourProfile(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const parsed = setOrganizationColourProfileBodySchema.parse(body);
      return await this.service.setColourProfile(user, idParamSchema.parse(id), parsed.colourProfile);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * `F4.330` (ADR 0115 decision 3) — `PUT /api/v1/admin/organizations/:id/ingest`, the
   * organization's ingest switch. Global admin only (the service's `assertAdminRole`); its own
   * route, not a `PATCH` field (`PATCH`'s strict body refuses `ingestEnabled`). The ingest host
   * applies the value at its next reload. A body other than `{ ingestEnabled: boolean }` is a 400.
   */
  @Put(":id/ingest")
  async setIngestEnabled(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const parsed = setOrganizationIngestBodySchema.parse(body);
      return await this.service.setIngestEnabled(user, idParamSchema.parse(id), parsed.ingestEnabled);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/deactivate")
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.deactivate(user, idParamSchema.parse(id));
  }

  @Post(":id/reactivate")
  @HttpCode(HttpStatus.OK)
  async reactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.reactivate(user, idParamSchema.parse(id));
  }
}
