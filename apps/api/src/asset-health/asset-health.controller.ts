import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

import { assetHealthQuerySchema, healthSummaryQuerySchema } from "./asset-health.schema";
import { AssetHealthService } from "./asset-health.service";

/**
 * `E1.3` — the asset health score reads (ADR 0050 + Amendment 1).
 *
 * **`asset-health`, not `health`.** `@Controller("health")` already exists and
 * is the liveness endpoint. Two controllers one word apart, one of them
 * unauthenticated, is not a collision worth risking on a route that returns
 * tenant data.
 *
 * **The access check is the security-relevant part of both endpoints**, for the
 * reason ADR 0048's Consequences give about `/telemetry/points/:pointRef/
 * aggregate`: the `telemetry.*` relations carry no Row Level Security, so no
 * pool filters them, and this guard is the only thing between a caller and
 * another organization's data. `0052`'s counter relations are in that schema and
 * inherit exactly that exposure.
 *
 * Both checks run **before** the service, never inside it. A guard that throws
 * after reading has already read — and `AssetHealthService` takes asset ids
 * rather than a user precisely so it cannot be called un-authorized by accident.
 */
@Controller("asset-health")
@UseGuards(JwtAuthGuard)
export class AssetHealthController {
  constructor(
    private readonly health: AssetHealthService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** One asset's score, its band, and the tags behind both. */
  @Get("assets/:assetId")
  async forAsset(
    @CurrentUser() user: JwtPayload,
    @Param("assetId") assetId: string,
    @Query() query: Record<string, unknown>,
  ) {
    if (!(await this.accessControl.canReadAsset(user, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    const parsed = assetHealthQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }

    return this.health.forAsset(assetId, parsed.data.windowMinutes, new Date());
  }

  /**
   * The plant and enterprise donut.
   *
   * **The scope comes from `readableAssetIds`, never from a parameter.** A
   * caller cannot name the organization they want counted; they get the assets
   * they can already read, optionally narrowed to one location. That keeps the
   * boundary an authorization question rather than an input-validation one —
   * there is no id here to forge.
   *
   * `locationId` narrows and cannot widen: an unreadable location simply
   * intersects to nothing and returns an empty donut, which is the correct
   * answer and not an error. Answering 403 instead would confirm the location
   * exists.
   */
  @Get("summary")
  async summary(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    const parsed = healthSummaryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }

    const assetIds = await this.accessControl.readableAssetIds(user);
    return this.health.summary(
      assetIds,
      parsed.data.locationId,
      parsed.data.windowMinutes,
      new Date(),
    );
  }
}
