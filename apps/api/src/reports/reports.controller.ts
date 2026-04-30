import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { energyReportQuerySchema } from "./reports.schema";
import { ReportsService } from "./reports.service";

@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("energy/preview")
  async energyPreview(@Query() query: unknown) {
    try {
      const dto = energyReportQuerySchema.parse(query);
      return await this.reports.energyPreview(dto);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Get("energy/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header(
    "Content-Disposition",
    'attachment; filename="energy-consumption-report.csv"',
  )
  async energyCsv(@Query() query: unknown): Promise<string> {
    try {
      const dto = energyReportQuerySchema.parse(query);
      return await this.reports.energyCsv(dto);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
