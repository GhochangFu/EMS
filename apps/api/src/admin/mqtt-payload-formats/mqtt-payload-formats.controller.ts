import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { parseIfMatchHeader } from "../../common/if-match";
import { MqttPayloadFormatsAdminService } from "./mqtt-payload-formats.service";

/**
 * `F4.334` / ADR 0116 decision 5 — the MQTT payload format catalog.
 *
 * Thin by design: the service owns the gate order (403 → body → 404 → 409) and
 * parses the bodies and the `:code` after the gate (its own 400s). `POST test`
 * is declared before `:code` so the literal path is never read as a code.
 */
@Controller("admin/mqtt-payload-formats")
@UseGuards(JwtAuthGuard)
export class MqttPayloadFormatsAdminController {
  constructor(private readonly service: MqttPayloadFormatsAdminService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user);
  }

  @Post("test")
  @HttpCode(HttpStatus.OK)
  async test(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.test(user, body);
  }

  @Get(":code")
  async getByCode(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.service.getByCode(user, code);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.create(user, body);
  }

  @Put(":code")
  async update(
    @Param("code") code: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
    // `F4.334` (ADR 0099 Amendment 17 decision 1): the copilot's Confirm binds the
    // edit to the `updatedAt` its card showed; absent, the write is unconditional.
    @Headers("if-match") ifMatch?: string,
  ) {
    return this.service.update(
      user,
      code,
      body,
      parseIfMatchHeader(ifMatch),
    );
  }

  @Delete(":code")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("code") code: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.service.remove(user, code);
  }
}
