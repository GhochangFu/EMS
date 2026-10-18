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

import { commitOnboardingBodySchema, startOnboardingDiscoveryBodySchema, type JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import { MAX_IMPORT_FILE_BYTES } from "../telemetry-import/telemetry-import.schema";
import {
  createSessionBodySchema,
  patchDraftBodySchema,
  rollbackBodySchema,
  setCredentialsBodySchema,
} from "./onboarding.schema";
import { OnboardingDiscoveryService } from "./onboarding-discovery.service";
import { OnboardingService } from "./onboarding.service";

@Controller("admin/onboarding")
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(
    private readonly service: OnboardingService,
    private readonly discovery: OnboardingDiscoveryService,
  ) {}

  @Get("template.xlsx")
  async downloadTemplate(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const buffer = this.service.buildTemplate(user, "");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bms-onboarding-template.xlsx"',
    );
    res.send(buffer);
  }

  @Post("sessions")
  async createSession(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      const parsed = createSessionBodySchema.parse(body);
      return this.service.createSession(user, parsed.organizationId);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * `F4.255` (ADR 0099 Amendment 2 A1) — the organization's open drafts, for
   * the copilot dock's resume list. Declared above `sessions/:id` so the
   * reading order matches Nest's matching order. A non-uuid `organizationId`
   * (an empty `?organizationId=` too) is a 400; an absent one reaches the
   * service as `undefined`, which lists the caller's home organization.
   */
  @Get("sessions")
  async listDrafts(@Query("organizationId") organizationId: unknown, @CurrentUser() user: JwtPayload) {
    if (organizationId === undefined) return this.service.listDrafts(user, undefined);
    let parsed: string;
    try {
      parsed = idParamSchema.parse(organizationId);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
    return this.service.listDrafts(user, parsed);
  }

  @Get("sessions/:id")
  async getSession(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getSession(user, idParamSchema.parse(id));
  }

  @Post("sessions/:id/upload")
  @HttpCode(HttpStatus.OK)
  // `F4.102`. Until this row the route took an unbounded upload: multer buffered
  // whatever arrived before `parseUpload` saw a byte, and the two sibling
  // spreadsheet routes had carried these limits since `F1.9`. `files: 1` caps
  // the multipart part count for the file field; `fields: 1` caps the non-file
  // fields, of which the SPA sends none (`apps/web/src/api/admin/onboarding.ts`
  // posts only `file`) — multer defaults `fields` to Infinity at 1 MB each,
  // otherwise unbounded regardless of `fileSize`. Nest maps multer's
  // `LIMIT_FILE_SIZE` to a 413 and every other limit breach to a 400.
  //
  // What gates this line: `tests/f4.102-file-interceptor-limits.test.ts` scans
  // every controller and fails when a `FileInterceptor` carries no `fileSize`,
  // so the limit being *declared* is gated statically. That it is *enforced* is
  // not gated by Vitest — no Nest module is instantiated anywhere in the suite,
  // so nothing here exercises multer. The API layer is the only gate on the
  // enforcement, which is why `parseUpload` keeps its own byte cap as well.
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1, fields: 1 } }))
  async uploadExcel(
    @Param("id") id: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Excel file is required");
    }
    return this.service.uploadExcel(user, idParamSchema.parse(id), file.buffer);
  }

  @Patch("sessions/:id/draft")
  async patchDraft(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const parsed = patchDraftBodySchema.parse(body);
      return this.service.patchDraft(user, idParamSchema.parse(id), parsed.draft);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * ADR 0022 decision 1 — the only way credentials enter onboarding. The body
   * is plaintext, encrypted before storage, and never echoed back.
   */
  @Post("sessions/:id/credentials")
  @HttpCode(HttpStatus.OK)
  async setCredentials(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.setCredentials(
        user,
        idParamSchema.parse(id),
        setCredentialsBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * F3.25 (ADR 0094 decisions 5 and 6): restore a checkpoint, bound to the
   * checkpoint id and the draft hash the client last saw (409 on a mismatch).
   */
  @Post("sessions/:id/rollback")
  @HttpCode(HttpStatus.OK)
  async rollback(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.rollback(user, idParamSchema.parse(id), rollbackBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post("sessions/:id/validate")
  @HttpCode(HttpStatus.OK)
  async validate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.validate(user, idParamSchema.parse(id));
  }

  /**
   * `F3.24b` (ADR 0103 decision 2) — start one bounded, read-only MQTT
   * discovery on a draft RTU; 202 with `{ discoveryId }`, and the session DTO
   * carries the status from then on. The body is `safeParse`d here with the
   * shared export the catalog entry names, and the **result** goes to the
   * service: the service runs the session gate before it audits a refused
   * prefix (security review M5), so the 400 cannot be thrown here.
   */
  @Post("sessions/:id/discovery")
  @HttpCode(HttpStatus.ACCEPTED)
  async startDiscovery(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    let sessionId: string;
    try {
      sessionId = idParamSchema.parse(id);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
    return this.discovery.start(user, sessionId, startOnboardingDiscoveryBodySchema.safeParse(body));
  }

  /**
   * `F3.86` PR 5 (ADR 0099 decision 7): `draftHash` is required and binds the
   * commit to that draft (400 when it has changed). An empty or missing body is
   * a 400: the empty body existed only for the retired page.
   */
  @Post("sessions/:id/commit")
  @HttpCode(HttpStatus.OK)
  async commit(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      const { draftHash } = commitOnboardingBodySchema.parse(body);
      return await this.service.commit(user, idParamSchema.parse(id), draftHash);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
