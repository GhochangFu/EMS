import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { decodePointRefParam, type JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { pointAggregateQuerySchema } from "./telemetry.schema";
import { TelemetryService } from "./telemetry.service";

@Controller("telemetry")
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Historical window for charts and TanStack Query seed data. */
  @Get("points/:pointRef/recent")
  async recent(
    @CurrentUser() user: JwtPayload,
    @Param("pointRef") pointRef: string,
    @Query("window") window?: string,
  ) {
    const { assetId } = decodePointRefParam(pointRef);
    if (!(await this.accessControl.canReadAsset(user, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    return this.telemetry.recentForPoint(pointRef, window);
  }

  /**
   * `F3.35` Stage A (ADR 0048 decision 3) — one aggregate over a window, and
   * optionally the buckets behind it.
   *
   * **The access check is the security-relevant part of this endpoint**, and ADR
   * 0048's Consequences say so: the `telemetry.*` relations carry no Row Level
   * Security, so no pool filters them, and this guard is the only thing between
   * a caller and another organization's telemetry. It is also the first
   * *general* read here — the four on `@Controller("dashboard")` are fixed
   * shapes — which is a wider surface than any of them.
   *
   * It runs **before** `pointAggregate`, not inside it. A guard that throws after
   * reading has already read.
   */
  @Get("points/:pointRef/aggregate")
  async aggregate(
    @CurrentUser() user: JwtPayload,
    @Param("pointRef") pointRef: string,
    @Query() query: Record<string, unknown>,
  ) {
    let assetId: string;
    try {
      ({ assetId } = decodePointRefParam(pointRef));
    } catch {
      // A 400, not a 500. A malformed reference is a caller error, and letting
      // the decode throw raw would answer it with a stack trace.
      throw new BadRequestException("Invalid point reference");
    }
    if (!(await this.accessControl.canReadAsset(user, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    const parsed = pointAggregateQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const { windowMinutes, compare, bucketFunction } = parsed.data;

    return this.telemetry.pointAggregate(pointRef, { windowMinutes, compare, bucketFunction });
  }
}
