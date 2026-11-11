import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import type {
  CreateServiceTokenResponse,
  JwtPayload,
  ServiceAccountResponse,
  ServiceAccountsListResponse,
} from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ServiceAccountsAdminService } from "./service-accounts-admin.service";

/**
 * `F4.17` / ADR 0125 decision 14 — service accounts and their tokens. Thin:
 * every rule (who may manage, the two-live-token cap, revocation, audit) is
 * in `ServiceAccountsAdminService`. Bodies are parsed there against the
 * `@bms/shared` contracts (ADR 0029: no schema in a controller).
 */
@Controller("admin/service-accounts")
@UseGuards(JwtAuthGuard)
export class ServiceAccountsAdminController {
  constructor(private readonly service: ServiceAccountsAdminService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload): Promise<ServiceAccountsListResponse> {
    return this.service.list(user);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<ServiceAccountResponse> {
    return this.service.create(user, body);
  }

  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<ServiceAccountResponse> {
    return this.service.get(user, parseId(id));
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<ServiceAccountResponse> {
    return this.service.update(user, parseId(id), body);
  }

  // The one response that carries a secret: no cache may keep it (security review of PR 5, L1;
  // the edge-gateway token route's rule).
  @Post(":id/tokens")
  @Header("Cache-Control", "no-store")
  async createToken(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<CreateServiceTokenResponse> {
    return this.service.createToken(user, parseId(id), body);
  }

  @Post(":id/tokens/:tokenId/revoke")
  @HttpCode(200)
  async revokeToken(
    @Param("id") id: string,
    @Param("tokenId") tokenId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ServiceAccountResponse> {
    return this.service.revokeToken(user, parseId(id), parseId(tokenId));
  }

  @Post(":id/grants")
  async addGrant(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<ServiceAccountResponse> {
    return this.service.addGrant(user, parseId(id), body);
  }

  @Delete(":id/grants/:kind/:grantId")
  async removeGrant(
    @Param("id") id: string,
    @Param("kind") kind: string,
    @Param("grantId") grantId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ServiceAccountResponse> {
    return this.service.removeGrant(user, parseId(id), kind, parseId(grantId));
  }
}

function parseId(id: string): string {
  const parsed = idParamSchema.safeParse(id);
  if (!parsed.success) {
    throw new BadRequestException("id must be a uuid");
  }
  return parsed.data;
}
