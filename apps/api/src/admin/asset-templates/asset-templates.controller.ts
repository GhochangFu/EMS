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
import { idParamSchema, stockCodeParamSchema } from "../admin.schema";
// Reused by identity, not moved: `tests/adr-0029-openapi-contract.test.ts`
// forbids DECLARING a body schema in a controller, not importing one.
import { importStockTemplateBodySchema } from "../dashboard-templates/dashboard-templates.schema";
import {
  createAssetTemplateBodySchema,
  instantiateAssetsBodySchema,
  templateStatusQuerySchema,
  updateAssetTemplateBodySchema,
} from "./asset-templates.schema";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import { migrateAssetsBodySchema } from "./asset-templates-migrate.schema";
import { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import { AssetTemplatesStockService } from "./asset-templates-stock.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * The asset template admin surface — `F2.1`, ADR 0015; the stock routes are
 * `F2.13`, ADR 0052 decision 4.
 *
 * ---
 *
 * **`@Get("stock")` IS DECLARED BEFORE `@Get(":id")`, AND THE ORDER IS
 * LOAD-BEARING.**
 *
 * Nest matches routes in declaration order. Declared after `:id`, the literal
 * `/stock` is swallowed by the parameterised route and arrives at `getById` as
 * the string `"stock"`, where `idParamSchema` refuses it — so the catalog
 * endpoint fails as *"invalid uuid"*, which reads like a client bug and is not
 * one. `asset-templates.controller.spec.ts` asserts the order rather than
 * trusting it, because nothing else in the file makes it visible.
 * `dashboard-templates.controller.ts` carries the same paragraph for the same
 * trap.
 */
@Controller("admin/asset-templates")
@UseGuards(JwtAuthGuard)
export class AssetTemplatesAdminController {
  constructor(
    private readonly service: AssetTemplatesAdminService,
    private readonly instantiation: AssetTemplateInstantiationService,
    private readonly migration: AssetTemplateMigrationService,
    private readonly stock: AssetTemplatesStockService,
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

  /**
   * BEFORE `@Get(":id")` — see the class docblock.
   *
   * **The role check is not decorative.** Every other route here reaches
   * `requireMasterDataUser` or `assertCanAuthor` through its service; this one
   * reads a constant, so without the guard any authenticated principal — a
   * `viewer` included — could enumerate the shipped catalog.
   */
  @Get("stock")
  async listStock(@CurrentUser() user: JwtPayload) {
    await this.stock.assertCanList(user);
    return this.stock.list();
  }

  @Get(":id")
  async getById(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getById(user, idParamSchema.parse(id));
  }

  /**
   * `F2.13` — imports one stock entry into `organizationId` as a stamped
   * draft. Three segments, so no collision with the two-segment
   * `@Post(":id/…")` routes below.
   *
   * `:code` is parsed like `:id` is — inside the `try`, so a malformed segment
   * is a 400 rather than an echo of whatever arrived (`stockCodeParamSchema`).
   */
  @Post("stock/:code/import")
  async importStock(
    @Param("code") code: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const stockCode = stockCodeParamSchema.parse(code);
      const parsed = importStockTemplateBodySchema.parse(body);
      return await this.stock.import(user, stockCode, parsed.organizationId);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
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
