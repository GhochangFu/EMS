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
import { DashboardTemplatesInstantiateService } from "./dashboard-templates-instantiate.service";
import { DashboardTemplatesStockService } from "./dashboard-templates-stock.service";
import {
  createDashboardTemplateBodySchema,
  importStockTemplateBodySchema,
  instantiateSectionTemplateBodySchema,
  listDashboardTemplatesQuerySchema,
  updateDashboardTemplateBodySchema,
} from "./dashboard-templates.schema";
import { DashboardTemplatesService } from "./dashboard-templates.service";

/**
 * The section dashboard template admin surface — `F3.36`, ADR 0049.
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
 * one. `dashboard-templates.controller.spec.ts` asserts the order rather than
 * trusting it, because nothing else in the file makes it visible.
 */
@Controller("admin/dashboard-templates")
@UseGuards(JwtAuthGuard)
export class DashboardTemplatesController {
  constructor(
    private readonly service: DashboardTemplatesService,
    private readonly stock: DashboardTemplatesStockService,
    private readonly instantiate: DashboardTemplatesInstantiateService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("organizationId") organizationId?: string,
    @Query("status") status?: string,
    @Query("section") section?: string,
  ) {
    try {
      return await this.service.list(
        user,
        listDashboardTemplatesQuerySchema.parse({
          ...(organizationId ? { organizationId } : {}),
          ...(status ? { status } : {}),
          ...(section ? { section } : {}),
        }),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * BEFORE `@Get(":id")` — see the class docblock.
   *
   * **The role check is not decorative.** Every other route on this controller
   * reaches `requireMasterDataUser` or `assertCanAuthor` through its service;
   * this one reads a constant, so without the guard any authenticated
   * principal — a `viewer` included — could enumerate the shipped catalog:
   * widget layouts, metric-catalog keys and asset-role codes. Found by the
   * `F3.36` security review.
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
   * Declared before every `@Post(":id/…")`, like its `@Get` twin above: three
   * segments against two is safe by count today, and the order keeps it safe
   * against a future three-segment `@Post(":id/:verb/:x")`. The spec asserts
   * the order. Moved here from below `draft` in `F2.13`.
   */
  @Post("stock/:code/import")
  async importStock(
    @Param("code") code: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      // `:code` is bounded before it reaches the lookup or the 400 message —
      // the `F2.13` security review found the gap on the asset-template
      // sibling, and AGENTS.md §4.5 fixes the class, not the instance.
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
      return await this.service.create(user, createDashboardTemplateBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.update(
        user,
        idParamSchema.parse(id),
        updateDashboardTemplateBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    await this.service.deleteDraft(user, idParamSchema.parse(id));
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

  @Post(":id/draft")
  async draft(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.createDraftFrom(user, idParamSchema.parse(id));
  }

  @Post(":id/instantiate")
  async instantiateTemplate(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.instantiate.instantiate(
        user,
        idParamSchema.parse(id),
        instantiateSectionTemplateBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
