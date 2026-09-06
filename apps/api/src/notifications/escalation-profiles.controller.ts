import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError, z } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  createEscalationProfileBodySchema,
  escalationDefaultsQuerySchema,
  setEscalationDefaultsBodySchema,
  updateEscalationProfileBodySchema,
} from "./escalation-profiles.schema";
import { EscalationProfilesService } from "./escalation-profiles.service";

const idParamSchema = z.string().uuid();

/**
 * `F3.10` — escalation-profile administration (ADR 0057 decision 7, plan D8).
 *
 * **Two controllers in one file**, the `asset-groups.controller.ts` precedent.
 * The severity map is addressed by *organization* and not by profile id, so
 * hanging it under `/admin/escalation-profiles/:id/...` would put an
 * identifier in the path that the server must either ignore or check — a
 * second identity for one resource.
 *
 * Every gate is the service's, not this file's. `JwtAuthGuard` establishes who
 * the caller is; `EscalationProfilesService` resolves the database role and the
 * target organization itself through `AccessControlService`, which is the
 * "never trust the token's role claim" property `notifications.controller.ts`
 * records — a demoted admin's token otherwise keeps administration for the rest
 * of `JWT_TTL`.
 */
@Controller("admin/escalation-profiles")
@UseGuards(JwtAuthGuard)
export class EscalationProfilesController {
  constructor(private readonly profiles: EscalationProfilesService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return { items: await this.profiles.list(user) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.profiles.create(user, parse(createEscalationProfileBodySchema, body));
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const profileId = parse(idParamSchema, id);
    const dto = parse(updateEscalationProfileBodySchema, body);
    const updated = await this.profiles.update(user, profileId, dto);
    if (updated === null) throw new NotFoundException("Escalation profile not found");
    return updated;
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    const removed = await this.profiles.remove(user, parse(idParamSchema, id));
    if (!removed) throw new NotFoundException("Escalation profile not found");
    return { deleted: true as const };
  }
}

/**
 * `GET` / `PUT /api/v1/admin/escalation-defaults` — one organization's
 * severity → profile map, whole rather than by delta.
 */
@Controller("admin/escalation-defaults")
@UseGuards(JwtAuthGuard)
export class EscalationDefaultsController {
  constructor(private readonly profiles: EscalationProfilesService) {}

  @Get()
  async get(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    const { organizationId } = parse(escalationDefaultsQuerySchema, query);
    return this.profiles.getDefaults(user, organizationId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async set(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.profiles.setDefaults(user, parse(setEscalationDefaultsBodySchema, body));
  }
}

/**
 * `.parse()` with the repo's `ZodError → BadRequestException(flatten())`
 * shape.
 *
 * Duplicated from `notifications.controller.ts:143-152` rather than lifted:
 * six lines, and the alternative is a shared module-scope helper that every
 * controller in the repo would then be expected to import instead of its own
 * (`rules.controller.ts` has the same six). Extracting it is a sweep, not a
 * change to smuggle into this row.
 */
function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.flatten());
    }
    throw err;
  }
}
