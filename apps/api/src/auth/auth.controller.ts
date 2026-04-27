import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { ZodError } from "zod";

import { AuthService } from "./auth.service";
import { loginBodySchema } from "./login.schema";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
}
