import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload, TelemetryWriteResponse } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { manualReadingsBodySchema } from "./manual-readings.schema";
import { TelemetryWriteService } from "./telemetry-write.service";

@Controller("admin/telemetry-entry/manual-readings")
@UseGuards(JwtAuthGuard)
export class ManualReadingsController {
  constructor(private readonly writeService: TelemetryWriteService) {}

  /**
   * `sourceKind` is hardcoded to `"manual"` here, not read from the body —
   * `manualReadingsBodySchema` is `.strict()` so a caller cannot supply it.
   * No role check here: `writeService.writeReadings` calls
   * `requireMasterDataUser` before touching any row.
   *
   * `rejected[].reason` interpolates caller-supplied text (asset/point-key
   * identifiers echoed back) — it must never reach a logger or be rendered
   * with `dangerouslySetInnerHTML` on the frontend.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<TelemetryWriteResponse> {
    try {
      const parsed = manualReadingsBodySchema.parse(body);
      return await this.writeService.writeReadings(user, {
        rows: parsed.rows,
        sourceKind: "manual",
        conflictPolicy: parsed.conflictPolicy,
        auditAction: "telemetry.manual_entry",
      });
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
