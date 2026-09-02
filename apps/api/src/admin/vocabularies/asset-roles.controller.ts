import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { parseActiveFilter } from "../admin.schema";
import {
  assetRoleCodeParamSchema,
  createAssetRoleBodySchema,
  updateAssetRoleBodySchema,
} from "./asset-roles.schema";
import { AssetRolesAdminService } from "./asset-roles.service";

/**
 * `F3.40` / ADR 0051 decision 5 — `/api/v1/admin/vocabularies/asset-roles`.
 *
 * **`admin/vocabularies/…` and not `vocabularies/…`.** `VocabulariesController`
 * serves the read side of all six vocabularies at `GET /api/v1/vocabularies`
 * to every authenticated user, deliberately unscoped. This is the write side of
 * one of them and it is gated to the global `admin` role, so it belongs under
 * the `admin/` prefix where every other master-data route lives.
 *
 * **`:code`, NOT `:id`, and the difference is load-bearing.** `0051` made
 * `code varchar(64)` the primary key of `bms.asset_roles`; there is no `id`
 * column. `admin.schema.ts`'s `idParamSchema` is `z.string().uuid()`, so
 * reusing it here — the obvious copy from `PointKeysAdminController`, whose
 * table does have a uuid — would reject every real code with a 400 that the
 * compiler cannot see. `assetRoleCodeParamSchema` is the same bound the
 * contracts package states, declared in `asset-roles.schema.ts` with THIS
 * package's `zod` so that a failed parse throws a `ZodError` the `catch` below
 * recognises. Under Vitest it did not: `apps/api` loads zod as ESM while
 * `@bms/shared` arrives from its CJS `dist`, so the two `ZodError` classes
 * differed and the error escaped the mapping. The built container is CJS on
 * both sides and returned 400 correctly, so this was a test-environment 500
 * rather than a shipped one — stated precisely, because "it was a 500" would
 * send the next reader looking for a production defect that never existed. See
 * `asset-roles.schema.ts`'s header.
 */
@Controller("admin/vocabularies/asset-roles")
@UseGuards(JwtAuthGuard)
export class AssetRolesAdminController {
  constructor(private readonly service: AssetRolesAdminService) {}

  /**
   * Retired codes included, unlike `GET /api/v1/vocabularies`. Without it an
   * administrator cannot see what they retired, and `PATCH { active: true }`
   * has no way to name its target.
   */
  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query("active") active?: string) {
    return this.service.list(user, parseActiveFilter(active));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.create(user, createAssetRoleBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":code")
  async update(
    @Param("code") code: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.update(
        user,
        assetRoleCodeParamSchema.parse(code),
        updateAssetRoleBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
