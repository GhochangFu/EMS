import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";

import type { JwtPayload, UserGrantsResponse } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import { UserGrantsService } from "./user-grants.service";

/**
 * `F3.78` (ADR 0089 decision 12) — `/api/v1/admin/users/:id/grants`, every
 * route behind `JwtAuthGuard` at class level
 * (`user-grants.controller.spec.ts` reads it). The body and `:kind` go to the
 * service raw: it parses them after the manager check.
 */
@Controller("admin/users")
@UseGuards(JwtAuthGuard)
export class UserGrantsAdminController {
  constructor(private readonly service: UserGrantsService) {}

  @Get(":id/grants")
  async list(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<UserGrantsResponse> {
    return this.service.list(user, parseUuid(id, "id"));
  }

  @Post(":id/grants")
  async add(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<UserGrantsResponse> {
    return this.service.add(user, parseUuid(id, "id"), body);
  }

  @Delete(":id/grants/:kind/:grantId")
  async remove(
    @Param("id") id: string,
    @Param("kind") kind: string,
    @Param("grantId") grantId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<UserGrantsResponse> {
    return this.service.remove(user, parseUuid(id, "id"), kind, parseUuid(grantId, "grantId"));
  }
}

/** A malformed uuid parameter is a 400, not a `22P02` from the uuid cast. */
function parseUuid(value: string, name: string): string {
  const parsed = idParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`${name} must be a uuid`);
  }
  return parsed.data;
}
