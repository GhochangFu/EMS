import {
  BadRequestException,
  Body,
  Controller,
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
import {
  createLocationTypeBodySchema,
  locationTypeCodeParamSchema,
  updateLocationTypeBodySchema,
} from "./location-types.schema";
import { LocationTypesVocabularyAdminService } from "./location-types.service";

/**
 * `F4.162` (ADR 0077 Amendment 1, plan D1) —
 * `/api/v1/admin/vocabularies/location-types`, the global-admin catalog of
 * `bms.location_types`.
 *
 * **Not `admin/location-types` and not `admin/locations/…`.**
 * `LocationTypesAdminController` already serves `GET admin/location-types`
 * (active `{ code, label }` rows for the locations form) and must keep its
 * shape; `LocationsAdminController` owns `admin/locations/:id`. The class name
 * differs from that controller's because the OpenAPI registry keys on it.
 *
 * **`:code`, parsed by a locally declared schema, inside the `try`** on every
 * route, so a bad code is a 400 rather than a raw `ZodError` (the
 * `asset-roles.schema.ts` measurement).
 */
@Controller("admin/vocabularies/location-types")
@UseGuards(JwtAuthGuard)
export class LocationTypesVocabularyAdminController {
  constructor(private readonly service: LocationTypesVocabularyAdminService) {}

  /** Active and retired types with their fleet-wide counts. No query: the page filters. */
  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.create(user, createLocationTypeBodySchema.parse(body));
    } catch (err) {
      throw toBadRequest(err);
    }
  }

  @Patch(":code")
  async update(
    @Param("code") code: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.update(
        user,
        locationTypeCodeParamSchema.parse(code),
        updateLocationTypeBodySchema.parse(body),
      );
    } catch (err) {
      throw toBadRequest(err);
    }
  }

  @Post(":code/deactivate")
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.deactivate(user, locationTypeCodeParamSchema.parse(code));
    } catch (err) {
      throw toBadRequest(err);
    }
  }

  @Post(":code/reactivate")
  @HttpCode(HttpStatus.OK)
  async reactivate(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.reactivate(user, locationTypeCodeParamSchema.parse(code));
    } catch (err) {
      throw toBadRequest(err);
    }
  }
}

/** A `ZodError` becomes a 400 with its flattened issues; anything else passes through. */
function toBadRequest(err: unknown): unknown {
  return err instanceof ZodError ? new BadRequestException(err.flatten()) : err;
}
