import { BadRequestException, Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";

import { updateAssetDomainBodySchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { assetDomainCodeParamSchema } from "./asset-domains.schema";
import { AssetDomainsAdminService } from "./asset-domains.service";

/**
 * `E3.1` (ADR 0122 decision 2.4, rulings P8 and R4) —
 * `/api/v1/admin/vocabularies/asset-domains`: the global admin reads the asset domains
 * and sets one domain's work-order reference prefix.
 *
 * The path follows the vocabulary admin convention (`…/vocabularies/location-types`,
 * ruling R4). `GET /vocabularies` keeps serving the domains to every signed-in user,
 * with its own shape: this controller is the prefix screen's read and write only.
 *
 * `:code` and the body are parsed inside the `try`, so a bad one is a 400. The role
 * gate is the service's first step, on both routes.
 */
@Controller("admin/vocabularies/asset-domains")
@UseGuards(JwtAuthGuard)
export class AssetDomainsAdminController {
  constructor(private readonly service: AssetDomainsAdminService) {}

  /** Every domain, active and retired, with its prefix. */
  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user);
  }

  /** Sets or clears one domain's prefix. Only later work orders take it. */
  @Patch(":code")
  async update(@Param("code") code: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.update(user, assetDomainCodeParamSchema.parse(code), updateAssetDomainBodySchema.parse(body));
    } catch (err) {
      throw err instanceof ZodError ? new BadRequestException(err.flatten()) : err;
    }
  }
}
