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
   * **The scope always comes from the caller's readable set.** They get the
   * assets they can already read, optionally narrowed to one location's
   * subtree (the node and every node under it, ADR 0098 decision 7).
   *
   * `F3.72` (the `F3.66` rule): an optional `organizationId` narrows the same
   * way. When present, `readableAssetIdsInOrganization` replaces
   * `readableAssetIds` — it is that readable set intersected with the
   * organization's assets, so it can only shrink the scope. Nothing here may
   * use `organizationId` in place of the readable set.
   *
   * `locationId` and `organizationId` narrow and cannot widen: an unreadable
   * one simply intersects to nothing and returns an empty donut, which is the
   * correct answer and not an error. Answering 403 instead would confirm the
   * id exists.
   */
  @Get("summary")
  async summary(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    const parsed = healthSummaryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }

    const assetIds = parsed.data.organizationId
      ? await this.accessControl.readableAssetIdsInOrganization(user, parsed.data.organizationId)
      : await this.accessControl.readableAssetIds(user);
    return this.health.summary(
      assetIds,
      parsed.data.locationId,
      parsed.data.windowMinutes,
      new Date(),
    );
  }
}
