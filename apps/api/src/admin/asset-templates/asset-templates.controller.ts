import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import {
  createAssetTemplateBodySchema,
  instantiateAssetsBodySchema,
  templateStatusQuerySchema,
  updateAssetTemplateBodySchema,
} from "./asset-templates.schema";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import { migrateAssetsBodySchema } from "./asset-templates-migrate.schema";
import { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";

@Controller("admin/asset-templates")
@UseGuards(JwtAuthGuard)
export class AssetTemplatesAdminController {
  constructor(
    private readonly service: AssetTemplatesAdminService,
    private readonly instantiation: AssetTemplateInstantiationService,
    private readonly migration: AssetTemplateMigrationService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("organizationId") organizationId?: string,
    @Query("status") status?: string,
  ) {
    return this.service.list(
      user,
      organizationId ? idParamSchema.parse(organizationId) : undefined,
      status ? templateStatusQuerySchema.parse(status) : undefined,
    );
  }

  @Get(":id")
  async getById(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getById(user, idParamSchema.parse(id));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.create(user, createAssetTemplateBodySchema.parse(body));
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
        updateAssetTemplateBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/publish")
  @HttpCode(HttpStatus.OK)
  async publish(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.publish(user, idParamSchema.parse(id));
  }

  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  async archive(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.archive(user, idParamSchema.parse(id));
  }

  /**
   * `F2.2` — builds assets from this published version (model-once-deploy-many).
   *
   * `201` rather than `200`: this creates rows, unlike the other `@Post`s here,
   * which are state transitions on an existing template.
   */
  @Post(":id/instantiate")
  @HttpCode(HttpStatus.CREATED)
  async instantiate(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.instantiation.instantiate(
        user,
        idParamSchema.parse(id),
        instantiateAssetsBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * `F2.6` — every version of this template's code, with how much of the
   * estate sits on each (ADR 0039 decision 8).
   */
  @Get(":id/versions")
  async listVersions(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.migration.listVersions(user, idParamSchema.parse(id));
  }

  /**
   * `F2.6` — decision 2's "no blind apply". `:id` is the **target** version.
   *
   * `POST` rather than `GET` because the asset selection is a body, not a
   * query; `200` rather than `201` because it writes nothing at all.
   */
  @Post(":id/migration-preview")
  @HttpCode(HttpStatus.OK)
  async previewMigration(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.migration.previewMigration(
        user,
        idParamSchema.parse(id),
        migrateAssetsBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * `F2.6` — decision 1's explicit, audited act. `:id` is the **target** version.
   *
   * `200` rather than `201`, unlike `instantiate`: this may create
   * `asset_points` rows, but its subject is a state change on assets that
   * already exist.
   */
  @Post(":id/migrate")
  @HttpCode(HttpStatus.OK)
  async migrate(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.migration.migrate(
        user,
        idParamSchema.parse(id),
        migrateAssetsBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /** "Edit this published version" — creates the next draft from it. */
  @Post(":id/draft")
  @HttpCode(HttpStatus.CREATED)
  async createDraftFrom(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.createDraftFrom(user, idParamSchema.parse(id));
  }

  /**
   * The only hard delete in this module, and it is restricted to drafts by the
   * service. A published version stays resolvable forever because assets pin it.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async deleteDraft(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.deleteDraft(user, idParamSchema.parse(id));
  }
}
