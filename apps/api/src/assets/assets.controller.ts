import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z, ZodError } from "zod";
import type { AssetPointPickerListResponse, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AssetsService } from "./assets.service";

/** Same shape as `idParamSchema` (`admin/admin.schema.ts`), kept local rather
 * than reached for across the admin/non-admin module boundary. */
const organizationIdParamSchema = z.string().uuid();

/** `:assetId` on the points route — the same local-schema rule. */
const assetIdParamSchema = z.string().uuid();

/**
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 3) adds `GET /assets/:assetId/points`
 * beside the list: the point read that is **not** master-data administration.
 * `GET /admin/asset-points` keeps refusing `asset_group_admin`
 * (`requireMasterDataUser`); this route is gated on `canReadAsset`, the same
 * predicate as asset health, asset images and `GET /telemetry/points/…/recent`.
 *
 * Order in the handler: parse, then guard, then service — a guard that throws
 * after reading has already read (the `asset-images.controller.ts` rule). A
 * non-uuid segment is a `ZodError` for the global `ZodErrorFilter` (400)
 * before any pool. For a non-admin an unknown id and an out-of-scope id are
 * both a 403, so the route is no existence oracle; the 404 is the service's,
 * reached by `admin` (`readableAssetIds` is `null`) or by any caller the guard
 * admits. The service reads on `fleetDb` because the guard is the isolation
 * control (ADR 0043's `listAll` shape).
 */
@Controller("assets")
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * Lists seeded / configured assets for telemetry binding, and for the
   * alarm-enrichment affected-asset picker (ADR 0034 decision 4). Optional
   * `organizationId` narrows the list — found missing in review: a picker
   * built on the unscoped list mixed assets from every organization the
   * caller could see, which is confusing and not what "affected assets"
   * means for one alarm.
   *
   * `F3.31` / ADR 0068 — the same list also feeds the operator `/asset-browser`
   * browser beside the picker. Each row carries `locationName`, `rtuId`,
   * `rtuDisplayName`, `telemetrySource`, `active` and `templateId`
   * (`assetListRowSchema`); the route, the guard and the `readableAssetIds`
   * scope are unchanged.
   */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("organizationId") organizationId?: string,
  ) {
    try {
      const orgId = organizationId
        ? organizationIdParamSchema.parse(organizationId)
        : undefined;
      return this.assets.listAll(await this.accessControl.readableAssetIds(user), orgId);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /** `GET /api/v1/assets/:assetId/points` — the asset's active points, five fields each
   * (`AssetPointPickerRow`, not the admin DTO — see `AssetsService.listPoints`). */
  @Get(":assetId/points")
  async listPoints(
    @CurrentUser() user: JwtPayload,
    @Param("assetId") assetId: string,
  ): Promise<AssetPointPickerListResponse> {
    const id = assetIdParamSchema.parse(assetId);
    if (!(await this.accessControl.canReadAsset(user, id))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    return this.assets.listPoints(id);
  }
}
