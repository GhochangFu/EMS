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
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { MAX_MIMIC_SYMBOL_SVG_BYTES } from "@bms/shared";
import type {
  JwtPayload,
  MimicLibrarySettingDto,
  MimicOrgSymbolDto,
  MimicOrgSymbolLibraryDto,
  MimicSymbolLibrariesResponse,
} from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { decodeMulterFilename } from "../assets/multer-filename";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  createMimicOrgSymbolLibraryBodySchema,
  mimicLibraryCodeParamSchema,
  mimicOrgSymbolParamsSchema,
  mimicSymbolFilenameSchema,
  mimicSymbolLibrariesQuerySchema,
  mimicSymbolUploadFieldsSchema,
  putMimicLibrarySettingBodySchema,
  updateMimicOrgSymbolBodySchema,
  updateMimicOrgSymbolLibraryBodySchema,
} from "./mimic-symbol-libraries.schema";
import { MimicSymbolLibrariesService } from "./mimic-symbol-libraries.service";

/**
 * What multer hands `@UploadedFile()` — structural, not `Express.Multer.File`, because esbuild
 * emits no `design:paramtypes` (`F4.20`). `undefined` when the form carried no `file` part.
 */
type UploadedSvg = { buffer: Buffer; mimetype: string; originalname: string } | undefined;

/**
 * `/api/v1/mimic-symbol-libraries` — `F3.32f` slice 3, ADR 0086 decisions 4, 6 and 7 (plan D5).
 * Any authenticated role reads the catalog for the organizations it reads; `admin` and
 * `organization_admin` write. The service owns every access decision.
 *
 * **Route order.** `PUT settings/:libraryCode` is declared before the `:id` routes, so a future
 * `PUT :id` cannot swallow `settings`.
 *
 * **The upload's order** (the `asset-images-write.controller.ts` rule): parse the path id, then
 * the service's access gate (404 outside the caller's organizations, 403 for a role or scope
 * that may not author), then `requireFile`, then the fields, then the filename — decoded
 * before it is parsed, so the 255 bound counts characters — then the service. A caller outside
 * the scope never learns whether its file arrived. The multipart limits are written inline in
 * the interceptor's options: `tests/f4.102-file-interceptor-limits.test.ts` reads the text, and
 * it treats every interceptor name followed by a parenthesis as a call, so this docblock never
 * spells one. `fileSize` over the cap is a 413 through Nest's multer map; `files: 1`,
 * `fields: 3` (`name`, `label`, `group`) and `fieldSize: 4096` bound the rest. The service
 * re-checks the byte cap on the buffer.
 *
 * **The multipart route stays out of `openapi-registry.ts`** — the generator hard-codes
 * `application/json`, the asset-images precedent. The four JSON bodies and the query are in it.
 * Every `.parse()` here is a request-path parse; the global `ZodErrorFilter` makes a refusal a 400.
 */
@Controller("mimic-symbol-libraries")
@UseGuards(JwtAuthGuard)
export class MimicSymbolLibrariesController {
  constructor(private readonly service: MimicSymbolLibrariesService) {}

  @Get()
  async list(@Query() query: unknown, @CurrentUser() user: JwtPayload): Promise<MimicSymbolLibrariesResponse> {
    const { organizationId } = mimicSymbolLibrariesQuerySchema.parse(query ?? {});
    return this.service.list(user, organizationId);
  }

  @Put("settings/:libraryCode")
  async putSetting(
    @Param("libraryCode") libraryCode: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<MimicLibrarySettingDto> {
    const code = mimicLibraryCodeParamSchema.parse(libraryCode);
    return this.service.putSetting(user, code, putMimicLibrarySettingBodySchema.parse(body));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<MimicOrgSymbolLibraryDto> {
    return this.service.create(user, createMimicOrgSymbolLibraryBodySchema.parse(body));
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<MimicOrgSymbolLibraryDto> {
    const libraryId = idParamSchema.parse(id);
    return this.service.update(user, libraryId, updateMimicOrgSymbolLibraryBodySchema.parse(body));
  }

  @Post(":id/symbols")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_MIMIC_SYMBOL_SVG_BYTES, files: 1, fields: 3, fieldSize: 4096 },
    }),
  )
  async uploadSymbol(
    @Param("id") id: string,
    @UploadedFile() file: UploadedSvg,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<MimicOrgSymbolDto> {
    const libraryId = idParamSchema.parse(id);
    await this.service.assertCanUploadTo(user, libraryId);
    const svg = requireFile(file);
    const fields = mimicSymbolUploadFieldsSchema.parse(body ?? {});
    // Two statements, not a nested call: the spec's order scan reads the text.
    const decodedName = decodeMulterFilename(svg.originalname);
    const originalFilename = mimicSymbolFilenameSchema.parse(decodedName);
    return this.service.uploadSymbol(user, libraryId, {
      buffer: svg.buffer,
      declaredType: svg.mimetype,
      originalFilename,
      name: fields.name || undefined,
      label: fields.label || undefined,
      group: fields.group || undefined,
    });
  }

  @Patch(":id/symbols/:symbolId")
  async updateSymbol(
    @Param() params: unknown,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<MimicOrgSymbolDto> {
    const { id, symbolId } = mimicOrgSymbolParamsSchema.parse(params);
    return this.service.updateSymbol(user, id, symbolId, updateMimicOrgSymbolBodySchema.parse(body));
  }
}

/** No `file` part, or an empty one, is a 400 — never a 500 from a missing buffer. */
function requireFile(file: UploadedSvg): NonNullable<UploadedSvg> {
  if (!file?.buffer?.length) {
    throw new BadRequestException("Symbol file is required");
  }
  return file;
}
