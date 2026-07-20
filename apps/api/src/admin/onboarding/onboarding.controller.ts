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
import { idParamSchema } from "../admin.schema";
import {
  chatBodySchema,
  createSessionBodySchema,
  patchDraftBodySchema,
} from "./onboarding.schema";
import { OnboardingService } from "./onboarding.service";

@Controller("admin/onboarding")
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

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

  @Get("sessions/:id")
  async getSession(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getSession(user, idParamSchema.parse(id));
  }

  @Post("sessions/:id/chat")
  @HttpCode(HttpStatus.OK)
  async chat(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const parsed = chatBodySchema.parse(body);
      return this.service.chat(user, idParamSchema.parse(id), parsed.message);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post("sessions/:id/upload")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor("file"))
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

  @Post("sessions/:id/validate")
  @HttpCode(HttpStatus.OK)
  async validate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.validate(user, idParamSchema.parse(id));
  }

  @Post("sessions/:id/commit")
  @HttpCode(HttpStatus.OK)
  async commit(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.commit(user, idParamSchema.parse(id));
  }
}
