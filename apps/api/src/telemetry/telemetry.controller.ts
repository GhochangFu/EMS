import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  decodePointRefParam,
  type JwtPayload,
  type PointValuesAtInstantResponse,
} from "@bms/shared";
import { z } from "zod";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { pointAggregateQuerySchema, pointValuesAtQuerySchema } from "./telemetry.schema";
import { TelemetryService } from "./telemetry.service";

const assetIdSchema = z.string().uuid();

@Controller("telemetry")
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * `F3.28` (ADR 0074 decision 2 / plan decision 2) — the latest sample at or
   * before `at` for up to `MAX_AT_INSTANT_REFS` points, one item per requested
   * ref, in request order.
   *
   * **Declared before the `points/:pointRef/...` routes.** Today both of those
   * are three segments and this is two, so no collision exists; the order keeps
   * it that way if a two-segment `points/:pointRef` read is ever added.
   *
   * Every step that can refuse runs **before** the read, in this order: the
   * query contract (400), each ref's decode and its asset id's UUID shape (400
   * — an unchecked non-UUID reaches the `::uuid` cast and becomes a 500), then
   * the scope (403 for the whole request if any one ref is foreign, the answer
   * `aggregate` gives). `telemetry.point_values` carries no Row Level Security,
   * so this guard is the only containment — the reason the `aggregate`
   * docblock gives, and a guard that throws after reading has already read.
   *
   * Scope is resolved once (`readableAssetIds`, `null` = unrestricted admin)
   * rather than per ref: `canReadAsset` re-resolves the user and the scope on
   * every call, which would be up to 50 repeat round trips.
   */
  @Get("points/at-instant")
  async atInstant(
    @CurrentUser() user: JwtPayload,
    @Query() query: Record<string, unknown>,
  ): Promise<PointValuesAtInstantResponse> {
    const parsed = pointValuesAtQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const { at, refs } = parsed.data;

    const points = refs.map((ref) => {
      let point: { assetId: string; pointKey: string };
      try {
        point = decodePointRefParam(ref);
      } catch {
        // No separator, or a `%` sequence `decodeURIComponent` cannot read.
        throw new BadRequestException("Invalid point reference");
      }
      if (!assetIdSchema.safeParse(point.assetId).success) {
        throw new BadRequestException("Invalid point reference: the asset id is not a UUID");
      }
      return point;
    });

    const readable = await this.accessControl.readableAssetIds(user);
    if (readable !== null && points.some((p) => !readable.includes(p.assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    // The decoded pairs go to the service — the ids the guard approved are the
    // ids the query binds (the `aggregate` security-review reasoning).
    const values = await this.telemetry.pointValuesAt(points, new Date(at));
    return {
      at,
      // Echoed as the caller sent each ref, zipped by position: the service
      // answers in request order, one row per requested point.
      items: refs.map((pointRef, i) => ({
        pointRef,
        time: values[i]?.time ?? null,
        value: values[i]?.value ?? null,
        unit: values[i]?.unit ?? null,
      })),
    };
  }

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
    let point: { assetId: string; pointKey: string };
    try {
      point = decodePointRefParam(pointRef);
    } catch {
      // A 400, not a 500. A malformed reference is a caller error, and letting
      // the decode throw raw would answer it with a stack trace.
      throw new BadRequestException("Invalid point reference");
    }
    if (!(await this.accessControl.canReadAsset(user, point.assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }

    const parsed = pointAggregateQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const { windowMinutes, compare, bucketFunction } = parsed.data;

    // **The DECODED pair goes to the service, not the raw string** (security
    // review, LOW). `recent` above hands over the string and the service
    // decodes it a second time; the id the guard approved is then the id the
    // query binds only because both sides happen to call the same pure
    // function on the same input. With no Row Level Security on
    // `telemetry.point_values_*` there is no database backstop, so a
    // divergence — a normalisation added on one side, or a second caller
    // reaching the service directly — would be a silent cross-organization
    // read rather than a refusal. Passing the decoded pair makes the guarded
    // id and the bound id the same value structurally, and leaves no way to
    // call the service without holding one.
    return this.telemetry.pointAggregate(point, { windowMinutes, compare, bucketFunction });
  }
}
