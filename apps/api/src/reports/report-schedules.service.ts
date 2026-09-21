import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, arrayContained, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { locations, reportFiles, reportSchedules, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { MAX_REPORT_SCHEDULES_PER_ORGANIZATION, reportScheduleDtoSchema, reportTemplateIdSchema } from "@bms/shared";
import type { JwtPayload, ReportCadence, ReportScheduleDto } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { requireStorageConfigured } from "../assets/require-storage";
import { AccessControlService } from "../auth/access-control.service";
import { parseStoredContract } from "../common/parse-stored-contract";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import type { BmsTx } from "../database/tenant-context";
import { withOrganizationReadScope } from "../database/tenant-read-scope";
import { ChannelsService } from "../notifications/channels.service";
import type { StorageClient } from "../storage/storage-client";
import { STORAGE_CLIENT } from "../storage/storage.tokens";
import { discardObjectsBestEffort } from "./report-file-store";
import { resolveReportOrganization } from "./report-organization";
import { nextRunAt } from "./report-period";
import type { CreateReportScheduleBodyInput, UpdateReportScheduleBodyInput } from "./report-schedules.schema";

/** The one sentence a covered role gets for a schedule its scope does not cover (R-12). */
export const SCHEDULE_OUT_OF_SCOPE_SENTENCE = "Report schedule is outside your access scope";

/** One row of `bms.report_schedules` as drizzle selects it; `runAtLocal` is `pg`'s `HH:MM:SS`. */
type StoredRow = typeof reportSchedules.$inferSelect;

/**
 * `F3.5b` (ADR 0071 decisions 7, 8, 11; plan R-8, R-10, R-12, R-16; owner
 * rulings Q-2, Q-3, Q-5, Q-6) — the five schedule routes' service.
 *
 * **`create`, in this order (R-12).** `writableLocationIds(jwt)` first
 * (`assertMasterDataRole` refuses `asset_group_admin`, `operator` and
 * `viewer` before any read — the F3.5a order) → `resolveReportOrganization`
 * (Amendment 1 item 1: a global admin names the organization in the body, a
 * one-organization admin gets theirs, several must name one) →
 * {@link assertWriteScope}: every `locationIds` entry must be a location of
 * that organization (fleet read; 400) **and** in the writable set (`null` =
 * all; 403); `[]` needs organization-level rights
 * (`reportFileReadScope(jwt).kind === "location"` → 403); a `channelId` goes
 * through `ChannelsService.loadById` (its own 403 for a `location_admin` —
 * Q-6, no permission moves; `null` → 404), must be `kind = 'email'` (400)
 * and must belong to this organization (400 — a fleet-wide `null`-organization
 * channel included, because the render reads the channel under the tenant
 * GUC and a `null` row is invisible there) → the tenant transaction: the
 * advisory lock `pg_advisory_xact_lock(hashtextextended('report_schedules:'
 * || org, 0))`, the count, `!(n < cap)` fail-closed (Q-5: 50, a contracts
 * constant; 409 before any write), the insert with `next_run_at =
 * nextRunAt(body, now)`, the `report_schedule.create` audit row → DTO.
 *
 * **`update` (Q-3, R-8).** The row is read on the fleet handle by id (404),
 * `canReadReportFile` decides with the row's `organization_id` and
 * `location_ids` (403 with {@link SCHEDULE_OUT_OF_SCOPE_SENTENCE} — the same
 * scope rule as a file, reused as-is: a schedule's readers are the users
 * whose manage scope covers its locations), then the write checks run on the
 * fields the body carries. `next_run_at` is recomputed **from now** when
 * `cadence`, `runAtLocal` or `timezone` changes value, or when `enabled`
 * turns `false → true`; any other PATCH leaves it alone. Never a catch-up: a
 * re-enabled schedule's first run is the next occurrence after now, and the
 * periods it slept through are not rendered. `updated_at` is stamped here —
 * the column has a default and no trigger.
 *
 * **`remove` (Q-2).** `report_files.schedule_id` is `ON DELETE RESTRICT`
 * (the Postgres default `NO ACTION`), so the files go first: one tenant
 * transaction deletes the schedule's file rows returning their keys, deletes
 * the schedule (0 rows → 404), writes the audit row, commits; then
 * `discardObjectsBestEffort` removes the objects — a bucket that is down
 * leaves row-less orphans (one `warn` per key naming the file id, ADR 0066
 * decision 11) and never a rowed object-less file. `requireStorageConfigured`
 * runs first for the F3.5a reason: the file routes answer 503, and this route
 * deletes files.
 *
 * **`list` (R-12).** `reportFileReadScope` + `withOrganizationReadScope` +
 * the location predicate `cardinality(location_ids) > 0 AND location_ids <@
 * $writable` for the `location` kind on both branches, ordered `created_at
 * DESC, id DESC`, no query (the cap bounds the set).
 *
 * **`created_by`** is the actor's `bms.users.id` resolved the way
 * `MasterDataAuditService.write` resolves it (a private copy of F3.5a's
 * `resolveActorId` — the plan names no source for it; the render job's
 * `NULL` is a different, deliberate rule, R-9). **The audit payloads carry
 * ids and enums, never `name`** (R-10). **The clock is a seam** (`now`), a
 * field rather than a constructor parameter so Nest's `design:paramtypes`
 * and the slot pins in `database/fleet-read-wiring.spec.ts` see six
 * parameters. **`toReportScheduleDto`** is the eleventh `parseStoredContract`
 * site (R-16); `runAtLocal` is sliced to `HH:MM` from the `HH:MM:SS` drizzle's
 * `time()` column returns (measured 2026-09-22 on a real row: `returning`,
 * `select` and raw `execute` all answer `"07:00:00"`).
 */
@Injectable()
export class ReportSchedulesService {
  private readonly logger = new Logger(ReportSchedulesService.name);

  /** The clock: `nextRunAt` is computed strictly after this instant. Overridden by the spec. */
  private readonly now: () => Date = () => new Date();

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(STORAGE_CLIENT) private readonly client: StorageClient,
    private readonly accessControl: AccessControlService,
    private readonly channels: ChannelsService,
    private readonly audit: MasterDataAuditService,
  ) {}

  async create(jwt: JwtPayload, body: CreateReportScheduleBodyInput): Promise<ReportScheduleDto> {
    // R-12: the role gate, before any other read.
    const writableLocations = await this.accessControl.writableLocationIds(jwt);
    const organizationId = await resolveReportOrganization(
      { accessControl: this.accessControl, fleetDb: this.fleetDb },
      jwt,
      body.organizationId,
    );
    const channelId = body.channelId ?? null;
    await this.assertWriteScope(jwt, organizationId, body.locationIds, channelId, writableLocations);

    const createdBy = await this.resolveActorId(jwt);
    const scheduleId = randomUUID();
    const enabled = body.enabled ?? true;
    const firstRun = nextRunAt(
      { cadence: body.cadence, runAtLocal: body.runAtLocal, timezone: body.timezone },
      this.now(),
    );

    const row = await withTenant(this.tenantDb, organizationId, async (tx) => {
      // Q-5: serialise concurrent creates for one organization; no parent row to lock.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`report_schedules:${organizationId}`}, 0))`,
      );
      refuseAtCap(await countSchedules(tx, organizationId));
      const [inserted] = await tx
        .insert(reportSchedules)
        .values({
          id: scheduleId,
          organizationId,
          name: body.name,
          templateId: reportTemplateIdSchema.value,
          formats: [...body.formats],
          cadence: body.cadence,
          runAtLocal: body.runAtLocal,
          timezone: body.timezone,
          locationIds: [...body.locationIds],
          channelId,
          enabled,
          nextRunAt: firstRun,
          createdBy,
        })
        .returning();
      if (!inserted) {
        throw new Error("report schedule insert returned no row");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "report_schedule.create",
          entityType: "report_schedule",
          entityId: scheduleId,
          organizationId,
          payload: auditPayload(inserted),
        },
        tx,
      );
      return inserted;
    });
    return toReportScheduleDto(row);
  }

  async list(jwt: JwtPayload): Promise<ReportScheduleDto[]> {
    const scope = await this.accessControl.reportFileReadScope(jwt);
    const organizationIds = scope.kind === "global" ? null : scope.organizationIds;
    const locationPredicate: SQL | undefined =
      scope.kind === "location"
        ? and(
            sql`cardinality(${reportSchedules.locationIds}) > 0`,
            arrayContained(reportSchedules.locationIds, scope.locationIds),
          )
        : undefined;
    const rows = await withOrganizationReadScope(
      this.tenantDb,
      this.fleetDb,
      organizationIds,
      () => [] as StoredRow[],
      (tx, filter) =>
        tx
          .select()
          .from(reportSchedules)
          .where(and(filter ? inArray(reportSchedules.organizationId, filter) : undefined, locationPredicate))
          .orderBy(desc(reportSchedules.createdAt), desc(reportSchedules.id)),
    );
    return rows.map(toReportScheduleDto);
  }

  async get(jwt: JwtPayload, id: string): Promise<ReportScheduleDto> {
    return toReportScheduleDto(await this.readRowForVerdict(jwt, id));
  }

  async update(jwt: JwtPayload, id: string, body: UpdateReportScheduleBodyInput): Promise<ReportScheduleDto> {
    // R-12: the role gate first, then the row, then the verdict, then the write checks on the new scope.
    const writableLocations = await this.accessControl.writableLocationIds(jwt);
    const row = await this.readRowForVerdict(jwt, id);
    await this.assertWriteScope(jwt, row.organizationId, body.locationIds, body.channelId, writableLocations);

    // The stored cadence is CHECK-constrained to the enum (`0078`) and the DTO parse re-validates it on the way out.
    const cadence: ReportCadence = body.cadence ?? (row.cadence as ReportCadence);
    const runAtLocal = body.runAtLocal ?? row.runAtLocal.slice(0, 5);
    const timezone = body.timezone ?? row.timezone;
    const enabled = body.enabled ?? row.enabled;
    // Q-3 / R-8: recompute from now on a change to the three period fields, or on false → true.
    const recompute =
      cadence !== row.cadence ||
      runAtLocal !== row.runAtLocal.slice(0, 5) ||
      timezone !== row.timezone ||
      (enabled && !row.enabled);
    const now = this.now();
    const changes: Partial<typeof reportSchedules.$inferInsert> = {
      updatedAt: now,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.formats !== undefined ? { formats: [...body.formats] } : {}),
      ...(body.cadence !== undefined ? { cadence: body.cadence } : {}),
      ...(body.runAtLocal !== undefined ? { runAtLocal: body.runAtLocal } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.locationIds !== undefined ? { locationIds: [...body.locationIds] } : {}),
      ...(body.channelId !== undefined ? { channelId: body.channelId } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(recompute ? { nextRunAt: nextRunAt({ cadence, runAtLocal, timezone }, now) } : {}),
    };

    const updated = await withTenant(this.tenantDb, row.organizationId, async (tx) => {
      const [after] = await tx.update(reportSchedules).set(changes).where(eq(reportSchedules.id, id)).returning();
      if (!after) {
        throw new NotFoundException("Report schedule not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "report_schedule.update",
          entityType: "report_schedule",
          entityId: id,
          organizationId: row.organizationId,
          payload: auditPayload(after),
        },
        tx,
      );
      return after;
    });
    return toReportScheduleDto(updated);
  }

  async remove(jwt: JwtPayload, id: string): Promise<void> {
    requireStorageConfigured(this.client);
    const row = await this.readRowForVerdict(jwt, id);

    const keysByFileId = await withTenant(this.tenantDb, row.organizationId, async (tx) => {
      // Q-2: the files first — `schedule_id` is RESTRICT, so the schedule's delete would fail on 23503.
      const files = await tx
        .delete(reportFiles)
        .where(eq(reportFiles.scheduleId, id))
        .returning({ fileId: reportFiles.id, objectKey: reportFiles.objectKey });
      const [deleted] = await tx.delete(reportSchedules).where(eq(reportSchedules.id, id)).returning({ id: reportSchedules.id });
      if (!deleted) {
        throw new NotFoundException("Report schedule not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "report_schedule.delete",
          entityType: "report_schedule",
          entityId: id,
          organizationId: row.organizationId,
          payload: {
            scheduleId: id,
            organizationId: row.organizationId,
            deletedFileIds: files.map((file) => file.fileId),
          },
        },
        tx,
      );
      return new Map(files.map((file) => [file.fileId, file.objectKey]));
    });

    // ADR 0066 decision 11: after the commit, and the method resolves either way.
    await discardObjectsBestEffort(this.client, this.logger, keysByFileId);
  }

  /**
   * The write checks shared by `create` and `update` (R-12), on the fields
   * the body carries: `locationIds` and `channelId` `undefined` mean "not in
   * this PATCH" and are skipped — the row's existing scope was already
   * verified by `canReadReportFile`. `create` always passes both.
   */
  private async assertWriteScope(
    jwt: JwtPayload,
    organizationId: string,
    locationIds: readonly string[] | undefined,
    channelId: string | null | undefined,
    writableLocations: string[] | null,
  ): Promise<void> {
    if (locationIds !== undefined) {
      if (locationIds.length > 0) {
        // fleetDb: the organization's own locations, bounded by the requested ids.
        const rows = await this.fleetDb
          .select({ locationId: locations.id })
          .from(locations)
          .where(and(eq(locations.organizationId, organizationId), inArray(locations.id, [...locationIds])));
        const inOrganization = new Set(rows.map((row) => row.locationId));
        if (!locationIds.every((locationId) => inOrganization.has(locationId))) {
          throw new BadRequestException("locationIds names a location outside the organization");
        }
        if (writableLocations !== null) {
          const held = new Set(writableLocations);
          if (!locationIds.every((locationId) => held.has(locationId))) {
            throw new ForbiddenException("locationIds is outside your access scope");
          }
        }
      } else {
        const scope = await this.accessControl.reportFileReadScope(jwt);
        if (scope.kind === "location") {
          throw new ForbiddenException("An empty location scope requires organization-level rights");
        }
      }
    }
    if (channelId !== undefined && channelId !== null) {
      // Q-6: `loadById` applies `canManageNotificationChannel` — a location_admin is refused there.
      const channel = await this.channels.loadById(jwt, channelId);
      if (channel === null) {
        throw new NotFoundException("Notification channel not found");
      }
      if (channel.kind !== "email") {
        throw new BadRequestException("channelId must name an email channel");
      }
      if (channel.organizationId !== organizationId) {
        throw new BadRequestException("channelId names a channel of another organization");
      }
    }
  }

  /** The fleet read by id (404), then the decision-6 verdict (403). Shared by `get`, `update` and `remove`. */
  private async readRowForVerdict(jwt: JwtPayload, id: string): Promise<StoredRow> {
    const [row] = await this.fleetDb.select().from(reportSchedules).where(eq(reportSchedules.id, id)).limit(1);
    if (!row) {
      throw new NotFoundException("Report schedule not found");
    }
    const allowed = await this.accessControl.canReadReportFile(jwt, {
      organizationId: row.organizationId,
      locationIds: row.locationIds,
    });
    if (!allowed) {
      throw new ForbiddenException(SCHEDULE_OUT_OF_SCOPE_SENTENCE);
    }
    return row;
  }

  /** `created_by`: the `bms.users.id` the way `MasterDataAuditService.write` resolves its actor — on the fleet pool, `null` when absent. */
  private async resolveActorId(jwt: JwtPayload): Promise<string | null> {
    const [row] = await this.fleetDb
      .select({ actorId: users.id })
      .from(users)
      .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
      .limit(1);
    return row?.actorId ?? null;
  }
}

/** Q-5: 409 at or over the cap; `!(n < cap)` so a non-numeric count refuses rather than admits. */
function refuseAtCap(current: number): void {
  const cap = MAX_REPORT_SCHEDULES_PER_ORGANIZATION;
  if (!(current < cap)) {
    throw new ConflictException(
      `This organization already has ${cap} report schedules; delete one before creating another`,
    );
  }
}

/** The per-organization count inside the tenant transaction (the policy scopes it; the predicate says so anyway). */
async function countSchedules(tx: BmsTx, organizationId: string): Promise<number> {
  const [row] = await tx
    .select({ count: count() })
    .from(reportSchedules)
    .where(eq(reportSchedules.organizationId, organizationId));
  return Number(row?.count);
}

/** R-10: ids and enums, never `name`. */
function auditPayload(row: StoredRow): Record<string, unknown> {
  return {
    scheduleId: row.id,
    organizationId: row.organizationId,
    cadence: row.cadence,
    formats: row.formats,
    enabled: row.enabled,
    locationIds: row.locationIds,
    channelId: row.channelId,
  };
}

/**
 * Picks the DTO's fields by name — never a spread — and parses the assembled
 * DTO through `reportScheduleDtoSchema` via `parseStoredContract` (ADR 0060
 * ruling 2, `F4.108`): a stored row that breaks its contract is the server's
 * 500 with the context logged, never a 400. `runAtLocal` is `pg`'s
 * `HH:MM:SS` sliced to `HH:MM` (R-16). The one site
 * `tests/f4.108-service-parses-are-guarded.test.ts` counts as
 * `reportSchedules: 1`.
 */
export function toReportScheduleDto(row: StoredRow): ReportScheduleDto {
  const candidate = {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    templateId: row.templateId,
    formats: row.formats,
    cadence: row.cadence,
    runAtLocal: row.runAtLocal.slice(0, 5),
    timezone: row.timezone,
    locationIds: row.locationIds,
    channelId: row.channelId,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt === null ? null : row.lastRunAt.toISOString(),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } satisfies Record<keyof ReportScheduleDto, unknown>;
  return parseStoredContract(reportScheduleDtoSchema, candidate, "report_schedules.to_dto.row");
}
