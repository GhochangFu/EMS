import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "./access-control.service";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { loginBodySchema } from "./login.schema";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown) {
    try {
      const dto = loginBodySchema.parse(body);
      return this.auth.login(dto);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return this.accessControl.currentUser(user);
  }
}
