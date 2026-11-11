import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { EdgeGatewaysAdminService } from "./edge-gateways.service";

/**
 * `E7.2` / ADR 0123 decision 12 (plan T6.2) — the edge gateways, global `admin`
 * only. Thin by design: the service owns the gate order (403 → 400 → 404 → 409)
 * and parses the bodies and the `:id` after the role gate.
 *
 * `POST :id/token` answers the token once, with `Cache-Control: no-store`
 * (builder call C13), so no cache between the browser and the API keeps it.
 * Not in the copilot catalog (C13), and this controller is not one
 * `tests/f3.85-catalog-coverage.test.ts` covers.
 */
@Controller("admin/edge-gateways")
@UseGuards(JwtAuthGuard)
export class EdgeGatewaysAdminController {
  constructor(private readonly service: EdgeGatewaysAdminService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.create(user, body);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.update(user, id, body);
  }

  @Post(":id/revoke")
  @HttpCode(HttpStatus.OK)
  async revoke(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.revoke(user, id);
  }

  @Post(":id/token")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async mintToken(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.mintToken(user, id);
  }

  @Put(":id/rtus")
  async replaceRtus(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.replaceRtus(user, id, body);
  }
}
