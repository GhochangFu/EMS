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
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema, parseActiveFilter } from "../admin.schema";
import {
  createAssetPointBodySchema,
  mappingSheetQuerySchema,
  updateAssetPointBodySchema,
} from "./asset-points.schema";
import { AssetPointsAdminService } from "./asset-points.service";
import { MAX_IMPORT_FILE_BYTES } from "./mapping-sheet-rows";
import { MappingSheetService } from "./mapping-sheet.service";

/** The `file` part Multer hands over, or nothing when the caller sent none. */
type UploadedMappingSheet = { buffer: Buffer } | undefined;

@Controller("admin/asset-points")
@UseGuards(JwtAuthGuard)
export class AssetPointsAdminController {
  constructor(
    private readonly service: AssetPointsAdminService,
    private readonly mappingSheet: MappingSheetService,
  ) {}

  /**
   * `F2.7` / ADR 0056 decisions 6 and 7 — the three mapping-sheet routes,
   * declared **before** the `:id` routes below. A static segment must precede
   * the parameterised one it could be swallowed by; `mapping-sheet/preview`
   * against `:id/deactivate` is the pair that would bite first.
   */
  @Get("mapping-sheet.xlsx")
  async exportMappingSheet(
    @CurrentUser() user: JwtPayload,
    @Query("locationId") locationId: string,
    @Res() res: Response,
  ) {
    const query = this.parseQuery(locationId);
    const { buffer, filename } = await this.mappingSheet.exportSheet(user, query.locationId);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post("mapping-sheet/preview")
  @HttpCode(HttpStatus.OK)
  // `files: 1` caps the multipart part count for the file field; `fields: 1`
  // caps the non-file fields, which this route has none of (`locationId` rides
  // in the query string) — Multer defaults `fields` to Infinity at 1 MB each,
  // otherwise unbounded regardless of `fileSize`.
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1, fields: 1 } }))
  async previewMappingSheet(
    @UploadedFile() file: UploadedMappingSheet,
    @CurrentUser() user: JwtPayload,
    @Query("locationId") locationId: string,
  ) {
    const query = this.parseQuery(locationId);
    return this.mappingSheet.preview(user, query.locationId, this.requireFile(file));
  }

  @Post("mapping-sheet/commit")
  @HttpCode(HttpStatus.OK)
  // See `previewMappingSheet` above for the two limits.
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1, fields: 1 } }))
  async commitMappingSheet(
    @UploadedFile() file: UploadedMappingSheet,
    @CurrentUser() user: JwtPayload,
    @Query("locationId") locationId: string,
  ) {
    const query = this.parseQuery(locationId);
    return this.mappingSheet.commit(user, query.locationId, this.requireFile(file));
  }

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("assetId") assetId?: string,
    @Query("locationId") locationId?: string,
    @Query("active") active?: string,
  ) {
    return this.service.list(
      user,
      assetId ? idParamSchema.parse(assetId) : undefined,
      locationId ? idParamSchema.parse(locationId) : undefined,
      parseActiveFilter(active),
    );
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.create(user, createAssetPointBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.update(
        user,
        idParamSchema.parse(id),
        updateAssetPointBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/deactivate")
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.deactivate(user, idParamSchema.parse(id));
  }

  @Post(":id/reactivate")
  @HttpCode(HttpStatus.OK)
  async reactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.reactivate(user, idParamSchema.parse(id));
  }

  /** `mappingSheetQuerySchema` is `.strict()`, so a missing or misspelt `locationId` is a 400, not a whole-fleet export. */
  private parseQuery(locationId: string) {
    try {
      return mappingSheetQuerySchema.parse({ locationId });
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * The uploaded sheet, or a 400 in the same one-error-DTO shape every other
   * file-level refusal takes (design decision 7), so the web renders one table.
   */
  private requireFile(file: UploadedMappingSheet): Buffer {
    if (!file?.buffer?.length) {
      throw new BadRequestException({
        row: null,
        column: null,
        code: "file_unreadable",
        message: "A mapping sheet file is required",
      });
    }
    return file.buffer;
  }
}
