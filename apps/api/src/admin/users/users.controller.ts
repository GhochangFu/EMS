import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";

import type { AdminUsersListResponse, JwtPayload, UserWriteResponse } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import { UsersService } from "./users.service";

/**
 * `F3.78` (ADR 0089 decision 1) — `/api/v1/admin/users`, every route behind
 * `JwtAuthGuard` at class level (`users.controller.spec.ts` reads it).
 *
 * The bodies go to the service raw: it parses them against the shared
 * contracts after the manager check, so a bad body is a 400 before any
 * Keycloak call and a non-manager learns nothing from the body's shape.
 */
@Controller("admin/users")
@UseGuards(JwtAuthGuard)
export class UsersAdminController {
  constructor(private readonly service: UsersService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload): Promise<AdminUsersListResponse> {
    return this.service.list(user);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<UserWriteResponse> {
    return this.service.create(user, body);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<UserWriteResponse> {
    return this.service.update(user, parseId(id), body);
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  async deactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<UserWriteResponse> {
    return this.service.deactivate(user, parseId(id));
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  async reactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<UserWriteResponse> {
    return this.service.reactivate(user, parseId(id));
  }

  @Post(":id/temporary-password")
  @HttpCode(200)
  async temporaryPassword(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<UserWriteResponse> {
    return this.service.temporaryPassword(user, parseId(id), body);
  }
}

/** A malformed `:id` is a 400, not a `22P02` from the uuid cast. */
function parseId(id: string): string {
  const parsed = idParamSchema.safeParse(id);
  if (!parsed.success) {
    throw new BadRequestException("id must be a uuid");
  }
  return parsed.data;
}
