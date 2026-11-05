import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import { PointKeyStatesAdminService } from "./point-key-states.service";

/**
 * `F4.309` / ADR 0088 Amendment 3 decision 1 — the state labels of switching points.
 *
 * Thin by design: the service owns the gate order (403 → body → 404 → 409, plan C7), so the
 * write bodies go to it raw and it parses them after the global-admin gate (a 400 of its own,
 * via `safeParse`). The one `ZodError` left is a malformed `:id`, a 400 here.
 */
@Controller("admin/point-key-states")
@UseGuards(JwtAuthGuard)
export class PointKeyStatesAdminController {
  constructor(private readonly service: PointKeyStatesAdminService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    // No `:id`, and the service answers a refused body with its own 400: nothing to map here.
    return this.service.create(user, body);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return badRequestOnZodError(() => this.service.update(user, idParamSchema.parse(id), body));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await badRequestOnZodError(() => this.service.remove(user, idParamSchema.parse(id)));
  }
}

/** Runs `call`, turning a `ZodError` (a malformed `:id`) into a 400 with its flattened issues. */
async function badRequestOnZodError<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.flatten());
    }
    throw err;
  }
}
