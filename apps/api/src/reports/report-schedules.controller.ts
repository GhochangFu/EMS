import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload, ReportScheduleDto } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  createReportScheduleBodySchema,
  reportScheduleIdParamSchema,
  updateReportScheduleBodySchema,
} from "./report-schedules.schema";
import { ReportSchedulesService } from "./report-schedules.service";

/**
 * `F3.5b` (ADR 0071 decision 11; plan R-12) — the five schedule routes, a
 * **third class on the `reports` prefix** beside `ReportsController` and
 * `ReportFilesController`, for the F3.5a reason: `reports.controller.spec.ts`
 * reads `ReportsController`'s prototype by name and `tests/` scans that file
 * as text, so a handler added there changes what those measure. Three classes
 * on one prefix cost Nest nothing.
 *
 * **The access verdict lives in the service** (the F3.5a shape): a schedule's
 * verdict needs the row's `organization_id` and `location_ids`, so there is
 * nothing to decide until `ReportSchedulesService` has read the row — and for
 * `create` the organization is resolved from the actor's grants first.
 *
 * **Parses are request-path parses.** Each `.parse()` validates what the
 * client sent (the class-wide controller allowance
 * `tests/f4.108-service-parses-are-guarded.test.ts` records) and each
 * `ZodError` becomes a 400 carrying `err.flatten()` — so the R-6 timezone
 * refine answers `fieldErrors.timezone`. The `try` wraps the parse only,
 * never the service call.
 *
 * **No `@Res()`**: every handler returns its DTO (or nothing, for the 204)
 * and lets Nest write it. **No handler argument is a key** (ADR 0066 decision
 * 4): the only path parameter is `id`.
 */
@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportSchedulesController {
  constructor(private readonly schedules: ReportSchedulesService) {}

  /** `GET /api/v1/reports/schedules` — the caller's scope, newest first; no query (the cap bounds the set). */
  @Get("schedules")
  async list(@CurrentUser() user: JwtPayload): Promise<ReportScheduleDto[]> {
    return this.schedules.list(user);
  }

  /** `POST /api/v1/reports/schedules` — the write checks, the cap, the first `next_run_at`; 201. */
  @Post("schedules")
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JwtPayload, @Body() body: unknown): Promise<ReportScheduleDto> {
    const dto = parseRequest(() => createReportScheduleBodySchema.parse(body));
    return this.schedules.create(user, dto);
  }

  /** `GET /api/v1/reports/schedules/:id` — the fleet read by id, then the scope verdict. */
  @Get("schedules/:id")
  async get(@CurrentUser() user: JwtPayload, @Param() params: unknown): Promise<ReportScheduleDto> {
    const { id } = parseRequest(() => reportScheduleIdParamSchema.parse(params));
    return this.schedules.get(user, id);
  }

  /** `PATCH /api/v1/reports/schedules/:id` — the write checks on the new scope; `next_run_at` recomputed per R-8. */
  @Patch("schedules/:id")
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<ReportScheduleDto> {
    const { id } = parseRequest(() => reportScheduleIdParamSchema.parse(params));
    const dto = parseRequest(() => updateReportScheduleBodySchema.parse(body));
    return this.schedules.update(user, id, dto);
  }

  /** `DELETE /api/v1/reports/schedules/:id` — the files' rows, the schedule, commit, then the objects (Q-2); 204. */
  @Delete("schedules/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param() params: unknown): Promise<void> {
    const { id } = parseRequest(() => reportScheduleIdParamSchema.parse(params));
    await this.schedules.remove(user, id);
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
