import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { TelemetryImportService } from "./telemetry-import.service";
import { MAX_IMPORT_FILE_BYTES, telemetryImportOptionsBodySchema } from "./telemetry-import.schema";

type UploadedImportFile = { buffer: Buffer } | undefined;

/** CSV/Excel telemetry bulk import (`F1.9`) — master-data write, preview then commit. */
@Controller("admin/telemetry/import")
@UseGuards(JwtAuthGuard)
export class TelemetryImportController {
  constructor(private readonly service: TelemetryImportService) {}

  @Post("preview")
  @HttpCode(HttpStatus.OK)
  // `files: 1` caps the multipart part count for the file field itself;
  // `fields: 4` caps the non-file fields (`sourceKind`, `conflictPolicy`,
  // with headroom) — Multer defaults `fields` to Infinity at 1 MB each,
  // otherwise unbounded regardless of `fileSize`.
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1, fields: 4 } }),
  )
  async preview(
    @UploadedFile() file: UploadedImportFile,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.preview(user, this.requireFile(file), this.parseOptions(body));
  }

  @Post("commit")
  @HttpCode(HttpStatus.OK)
  // `files: 1` caps the multipart part count for the file field itself;
  // `fields: 4` caps the non-file fields (`sourceKind`, `conflictPolicy`,
  // with headroom) — Multer defaults `fields` to Infinity at 1 MB each,
  // otherwise unbounded regardless of `fileSize`.
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1, fields: 4 } }),
  )
  async commit(
    @UploadedFile() file: UploadedImportFile,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.commit(user, this.requireFile(file), this.parseOptions(body));
  }

  private requireFile(file: UploadedImportFile): Buffer {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Import file is required");
    }
    return file.buffer;
  }

  private parseOptions(body: unknown) {
    try {
      return telemetryImportOptionsBodySchema.parse(body ?? {});
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
