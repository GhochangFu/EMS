import {
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { pipeline } from "node:stream";

import type { AssetImageDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

import { assetIdParamSchema, assetImageParamsSchema } from "./asset-images.schema";
import { AssetImagesService } from "./asset-images.service";

/**
 * `F3.3` (ADR 0066 decisions 4, 6) — the two asset-image read routes, beside
 * `@Controller("assets")`.
 *
 * **The access check runs before the service, in both handlers**, the
 * `asset-health.controller.ts` rule: a guard that throws after reading has
 * already read. The parse comes first (a non-uuid segment is a 400 from the
 * global `ZodErrorFilter`, before any pool), then `canReadAsset` (403 with
 * the same message as asset health), then the service, whose `withReadScope`
 * read is the RLS backstop rather than the gate.
 *
 * **`content` streams through `@Res()`** — the `audit.controller.ts`
 * precedent — because the body is a `Readable` from the bucket, not a JSON
 * value for Nest to serialise. Decision 6's headers, from the row and never
 * from the object: `Content-Type` is the stored `content_type`, `ETag` is
 * the stored `sha256` quoted, `Cache-Control: private, max-age=0,
 * must-revalidate`, `Content-Disposition: inline`, `Content-Length` is
 * the stored `byte_size` (the row is the authority, decision 4), and
 * `X-Content-Type-Options: nosniff` so a browser cannot sniff the stored
 * bytes into another type. Every header is set **before** the body is
 * handed to `pipeline` — a header after the first chunk is a throw — and
 * the spec pins that order.
 *
 * **`pipeline`, never `body.pipe(res)`.** `pipe` does not destroy its
 * source when the destination goes away, so a client that disconnected
 * mid-download left the object stream's socket to MinIO open until the SDK
 * timed it out. `pipeline` tears down both ends on either side's failure:
 * a body error after the headers have gone cannot become a status, so the
 * response is destroyed — the client sees a truncated body, never a 200
 * that lies — and a client abort destroys the body. Either way one `warn`
 * names the image id and the error's `code`/`name`, never its message
 * (§9.6).
 *
 * **No `If-None-Match` handling.** The `ETag` is sent so a browser cache
 * can revalidate; answering 304 to a matching tag is a possible `F3.4`
 * follow-up when the UI gives the route a caller, not a YAGNI guess here.
 *
 * **No handler argument is a key** (decision 4): the only path parameters
 * are `assetId` and `imageId`, and the object key is built from the row by
 * the service. A source scan (`asset-images.controller.spec.ts`) pins the
 * guard order, `@Res()`, the header strings and the absence of a `key`
 * parameter, because `F4.20` records that esbuild emits no
 * `design:paramtypes` and the module cannot be booted in a unit test.
 */
@Controller("assets/:assetId/images")
@UseGuards(JwtAuthGuard)
export class AssetImagesController {
  private readonly logger = new Logger(AssetImagesController.name);

  constructor(
    private readonly images: AssetImagesService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** `GET /api/v1/assets/:assetId/images` — the asset's rows, newest first, without `objectKey`. */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Param("assetId") assetId: string,
  ): Promise<AssetImageDto[]> {
    const id = assetIdParamSchema.parse(assetId);
    if (!(await this.accessControl.canReadAsset(user, id))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    return this.images.list(id);
  }

  /** `GET /api/v1/assets/:assetId/images/:imageId/content` — the bytes, streamed. */
  @Get(":imageId/content")
  async content(
    @CurrentUser() user: JwtPayload,
    @Param() params: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const { assetId, imageId } = assetImageParamsSchema.parse(params);
    if (!(await this.accessControl.canReadAsset(user, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    const { row, body } = await this.images.content(assetId, imageId);

    res.setHeader("Content-Type", row.contentType);
    res.setHeader("ETag", `"${row.sha256}"`);
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Content-Length", String(row.byteSize));
    res.setHeader("X-Content-Type-Options", "nosniff");

    pipeline(body, res, (err) => {
      if (err) {
        // Headers may already be on the wire: a status cannot change.
        // `pipeline` has destroyed both streams — the object socket is
        // released whichever side failed, including a client that went away.
        this.logger.warn(
          `asset image ${imageId}: stream ended early after headers were sent (${errorCodeOrName(err)})`,
        );
      }
    });
  }
}

/** `err.code` (e.g. `ERR_STREAM_PREMATURE_CLOSE`) or `err.name` — never `err.message` (§9.6). */
function errorCodeOrName(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return "Error";
  }
  const { code, name } = err as { code?: unknown; name?: unknown };
  return typeof code === "string" ? code : typeof name === "string" ? name : "Error";
}
