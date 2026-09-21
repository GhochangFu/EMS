import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { pipeline } from "node:stream";
import { ZodError } from "zod";

import type { JwtPayload, ReportFileDto } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  listReportFilesQuerySchema,
  reportFileIdParamSchema,
  saveEnergyReportFileBodySchema,
} from "./report-files.schema";
import { ReportFilesService } from "./report-files.service";

/**
 * `F3.5a` (ADR 0071 decision 11; Amendment 1 items 1–3) — the four
 * report-file routes, a **second class on the `reports` prefix** beside
 * `ReportsController`.
 *
 * **Why a second class** (the F3.4 R-9 reasoning). `reports.controller.spec.ts`
 * reads `ReportsController`'s prototype by name and `tests/` scans that file
 * as text; a handler added to that class changes what those measure. Two
 * classes on one prefix cost Nest nothing and leave the F4.30/F4.51 spec
 * byte-identical.
 *
 * **The access verdict lives in the service here, not in the handler** —
 * unlike `asset-images.controller.ts`, whose handlers call `canReadAsset`
 * before the service. Decision 6's verdict for a file needs the row's
 * `organization_id` and `location_ids` (R-6: a location admin may read a file
 * only when every stamped location is theirs), so there is nothing to decide
 * until the row is read, and the row is read by `ReportFilesService`. It
 * reads the row on the fleet handle by id (404), asks `canReadReportFile`
 * (403 with `OUT_OF_SCOPE_SENTENCE`), and only then opens the object; for
 * `save` the same service resolves the organization from the actor's own
 * grants (Amendment 1 item 1) before any render. Both refusals happen before
 * this handler touches `@Res()`, so the global filter can still write the
 * status — a verdict after the first chunk could not.
 *
 * **Parses are request-path parses.** Each `.parse()` here validates what the
 * client sent — the class-wide controller allowance
 * `tests/f4.108-service-parses-are-guarded.test.ts` records — and each
 * `ZodError` becomes a 400 carrying `err.flatten()`, as the sibling class does.
 * The `try` wraps the parse only, never the service call: the service's own
 * stored-row parses go through `parseStoredContract` so a broken row is a 500,
 * and a wide `try` would turn one into a caller error.
 *
 * **`download` streams through `@Res()`** — the `asset-images.controller.ts`
 * shape verbatim. The five headers come from the row, never from the object
 * (decision 4: the row is the authority): `Content-Type` is the stored
 * `content_type`, `Content-Disposition` is `attachment` naming the stored
 * `filename` (server-generated, bounded by the DTO parse that ran first),
 * `Cache-Control: no-store` (the file is scope-filtered per user, the F4.30
 * rule), `Content-Length` is the stored `byte_size`, and
 * `X-Content-Type-Options: nosniff`. Every header is set **before** the body
 * is handed to `pipeline` — a header after the first chunk is a throw — inside
 * a `try` that destroys the body on any throw, so a bucket socket is never
 * left open (ADR 0066 Amendment 2). `pipeline`, never `body.pipe(res)`: it
 * tears down both ends on either side's failure, and the one `warn` names the
 * file id and the error's `code`/`name`, never its message (§9.6).
 *
 * **No handler argument is a key** (ADR 0066 decision 4): the only path
 * parameter is `id`, and the object key is built from the row by the service.
 * `tests/f3.3-object-storage-invariants.test.ts` scans every controller for a
 * `key`/`objectKey` argument; `report-files.controller.spec.ts` scans this
 * file for the header order and the parse-before-service order.
 */
@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportFilesController {
  private readonly logger = new Logger(ReportFilesController.name);

  constructor(private readonly files: ReportFilesService) {}

  /** `POST /api/v1/reports/energy/files` — render, store, and answer the new row's DTO; 201. */
  @Post("energy/files")
  @HttpCode(HttpStatus.CREATED)
  async save(@CurrentUser() user: JwtPayload, @Body() body: unknown): Promise<ReportFileDto> {
    const dto = parseRequest(() => saveEnergyReportFileBodySchema.parse(body));
    return this.files.saveOnDemand(user, dto);
  }

  /** `GET /api/v1/reports/files?limit=` — the caller's scope, newest first (R-7). */
  @Get("files")
  async list(@CurrentUser() user: JwtPayload, @Query() query: unknown): Promise<ReportFileDto[]> {
    const { limit } = parseRequest(() => listReportFilesQuerySchema.parse(query));
    return this.files.list(user, limit);
  }

  /** `GET /api/v1/reports/files/:id/download` — the bytes, streamed, as an attachment. */
  @Get("files/:id/download")
  async download(
    @CurrentUser() user: JwtPayload,
    @Param() params: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const { id } = parseRequest(() => reportFileIdParamSchema.parse(params));
    const { row, body } = await this.files.download(user, id);

    // From here until `pipeline` owns it, `body` is an open socket to the
    // bucket that nothing else will close. The service parses the whole row
    // before it opens the stream, so a header value Node refuses
    // (`ERR_INVALID_CHAR`) cannot come from a stored row any more — but a
    // throw here for any reason must still release the socket first.
    try {
      res.setHeader("Content-Type", row.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${row.filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Length", String(row.byteSize));
      res.setHeader("X-Content-Type-Options", "nosniff");
    } catch (err) {
      body.destroy();
      throw err;
    }

    pipeline(body, res, (err) => {
      if (err) {
        // Headers may already be on the wire: a status cannot change.
        // `pipeline` has destroyed both streams — the object socket is
        // released whichever side failed, including a client that went away.
        this.logger.warn(
          `report file ${id}: stream ended early after headers were sent (${errorCodeOrName(err)})`,
        );
      }
    });
  }

  /** `DELETE /api/v1/reports/files/:id` — row, commit, then object (ADR 0066 decision 11); 204. */
  @Delete("files/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param() params: unknown): Promise<void> {
    const { id } = parseRequest(() => reportFileIdParamSchema.parse(params));
    await this.files.remove(user, id);
  }
}

/** A request-path parse: a `ZodError` is the caller's 400 with the flattened issues; anything else propagates. */
function parseRequest<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.flatten());
    }
    throw err;
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
