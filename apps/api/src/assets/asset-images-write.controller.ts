import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { MAX_ASSET_IMAGE_BYTES } from "@bms/shared";
import type { AssetImageDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

import { assetIdParamSchema, assetImageFilenameSchema, assetImageParamsSchema, assetImageUploadFieldsSchema } from "./asset-images.schema";
import { AssetImagesWriteService } from "./asset-images-write.service";
import { decodeMulterFilename } from "./multer-filename";

/**
 * What multer hands `@UploadedFile()` — structural, not `Express.Multer.File`,
 * because esbuild emits no `design:paramtypes` (`F4.20`) and the handler
 * reads only these three fields. `undefined` when the form carried no
 * `file` part (the `telemetry-import.controller.ts` precedent).
 */
type UploadedImage = { buffer: Buffer; mimetype: string; originalname: string } | undefined;

/**
 * `F3.4` (ADR 0066 decision 7; Amendment 3 R-8, R-9) — the two asset-image
 * write routes, a **second class on the same prefix** as `AssetImagesController`.
 *
 * **R-9 — why a second class.** `asset-images.controller.spec.ts` reads the
 * F3.3 file as text: its `contentBody()` runs from `async content(` to the
 * end of the file and `listBody()` stops at `@Get(":imageId/content")`, so a
 * handler added to that class before or after `content` changes what those
 * scans measure. Two classes on `assets/:assetId/images` cost Nest nothing
 * and leave the F3.3 spec byte-identical; `asset-images-write.controller.
 * spec.ts` scans this file the same way.
 *
 * **The access check runs before the service, in both handlers** — the
 * `asset-images.controller.ts` rule, and here also **before `requireFile`**:
 * a caller outside the asset's scope learns nothing about whether its file
 * arrived, and a 403 is never reachable only after a 400. The parse comes
 * first (a non-uuid segment is a 400 from the global `ZodErrorFilter`,
 * before any pool), then `canManageAsset` (403 with the same message as
 * asset health and the read routes), then the request-shape parses, then
 * the service. Every `.parse()` here is a request-path parse — the class-wide
 * controller allowance `tests/f4.108-service-parses-are-guarded.test.ts`
 * records — and the filter turns each `ZodError` into a 400.
 *
 * **Buffering and the guard.** Nest runs guards before interceptors, so
 * `JwtAuthGuard` refuses an unauthenticated body before multer buffers a
 * byte. `canManageAsset` runs in the handler, **after** the ≤ `MAX_ASSET_
 * IMAGE_BYTES` buffer — a scoped-out but authenticated caller can cost one
 * 10 MiB read. Accepted and recorded in the plan (§1); moving the scope
 * check into a guard would need the asset id resolved before the pipe and
 * is not worth the second read path.
 *
 * **Decision 7's limits are written inline in the interceptor's options.**
 * `tests/f4.102-file-interceptor-limits.test.ts` reads text and a hoisted
 * constant is invisible to it — and it treats every `FileInterceptor` name
 * followed by a parenthesis as a call, so this docblock never spells the
 * call. `fileSize` over the cap is `LIMIT_FILE_SIZE`,
 * which Nest's multer map turns into a 413; `files`, `fields` and an
 * unexpected part are 400s (`@nestjs/platform-express` `multer.utils`). The
 * service re-checks the byte cap on the buffer as well (R-4) — each parser
 * keeps its own cap. `fieldSize` is there because multer bounds the non-file
 * fields at 1 MB **each** by default: the field *count* was capped and the
 * field *bytes* were not.
 *
 * **Recorded, not fixed (review finding Sec L-2).** `canManageAsset` reaches
 * `assertMasterDataRole`, which **throws** rather than answering false, so a
 * viewer or operator is refused with a 403 from that helper — after multer
 * has already buffered up to `MAX_ASSET_IMAGE_BYTES`. The cost is the same
 * one the paragraph above accepts for a scoped-out admin, and it is paid by
 * every authenticated role. `apps/api/src` has no throttler of any kind, so
 * nothing else bounds the repetition rate either. Accepted for F3.4: a fix
 * needs the asset id resolved before the interceptor runs, which is the same
 * second read path the paragraph above declined.
 *
 * **No handler argument is a key** (decision 4): the path parameters are
 * `assetId` and `imageId`, the body carries only `caption`
 * (`assetImageUploadFieldsSchema` is `.strict()`), and the object key is
 * built from ids by the service. `tests/f3.3-object-storage-invariants.
 * test.ts` scans this file for a `key`/`objectKey` argument.
 *
 * **Nothing enters `openapi-registry.ts`** (R-8): `upload` is multipart and
 * the generator hard-codes `application/json`; `remove` takes no body and
 * no query. The registry's docblock names both.
 */
@Controller("assets/:assetId/images")
@UseGuards(JwtAuthGuard)
export class AssetImagesWriteController {
  constructor(
    private readonly writes: AssetImagesWriteService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** `POST /api/v1/assets/:assetId/images` — multipart `file` plus an optional `caption`; 201 with the new row's DTO. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // `files: 1` caps the multipart part count for the file field itself;
  // `fields: 2` caps the non-file fields (`caption`, with one of headroom) —
  // Multer defaults `fields` to Infinity at 1 MB each, otherwise unbounded
  // regardless of `fileSize`. A third non-file field is a 400 from multer;
  // a part over `fileSize` is a 413 through Nest's multer error map.
  // `fieldSize: 4096` caps each of those two fields: multer's default is
  // 1 MB **per field**, so `fields: 2` alone still admitted 2 MB of caption
  // to be buffered and handed to a `.max(1000)` parse that then refused it.
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_ASSET_IMAGE_BYTES, files: 1, fields: 2, fieldSize: 4096 },
    }),
  )
  async upload(
    @CurrentUser() user: JwtPayload,
    @Param("assetId") assetId: string,
    @UploadedFile() file: UploadedImage,
    @Body() body: unknown,
  ): Promise<AssetImageDto> {
    const id = assetIdParamSchema.parse(assetId);
    if (!(await this.accessControl.canManageAsset(user, id))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    const image = requireFile(file);
    const { caption } = assetImageUploadFieldsSchema.parse(body ?? {});
    // Post-merge sweep C1: busboy hands the filename over as latin1 code
    // units, so the decode runs BEFORE the parse — the `.max(255)` bound must
    // count characters, not UTF-8 bytes. Two statements, not a nested call:
    // the spec's order scan reads the text and a nested `parse(decode(...))`
    // spells `parse` first.
    const decodedName = decodeMulterFilename(image.originalname);
    const originalFilename = assetImageFilenameSchema.parse(decodedName);
    return this.writes.upload(user, id, {
      buffer: image.buffer,
      declaredType: image.mimetype,
      originalFilename,
      caption: caption === undefined || caption === "" ? null : caption,
    });
  }

  /** `DELETE /api/v1/assets/:assetId/images/:imageId` — row, commit, then object (decision 11); 204. */
  @Delete(":imageId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param() params: unknown): Promise<void> {
    const { assetId, imageId } = assetImageParamsSchema.parse(params);
    if (!(await this.accessControl.canManageAsset(user, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    await this.writes.remove(user, assetId, imageId);
  }
}

/** The `telemetry-import.controller.ts` shape: no part, or an empty one, is 400 — never a 500 from a missing buffer. */
function requireFile(file: UploadedImage): NonNullable<UploadedImage> {
  if (!file?.buffer?.length) {
    throw new BadRequestException("Image file is required");
  }
  return file;
}
