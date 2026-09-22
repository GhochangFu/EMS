import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { reportSchedules } from "@bms/db";
import type { JwtPayload, ReportScheduleDto } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { SEEDED, jwtFor } from "../auth/access-control.integration.spec";
import type { BmsTx } from "../database/tenant-context";
import { withTenant } from "../database/tenant-context";
import { ChannelsService } from "../notifications/channels.service";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import { buildReportObjectKey } from "../storage/object-key";
import { headObject, putObject } from "../storage/storage-client";
import type { ConfiguredStorageConfig } from "../testing/integration-storage-gate";
import { withRollback } from "../testing/with-rollback";
import {
  captureRejection,
  errorMessage,
  errorName,
  openReportFileFixtures,
  service as reportFilesService,
  sha256Of,
  type ReportFileIntegrationFixtures,
} from "./report-files.integration.spec";
import { ReportSchedulesService, SCHEDULE_OUT_OF_SCOPE_SENTENCE } from "./report-schedules.service";
import type { CreateReportScheduleBodyInput } from "./report-schedules.schema";

/**
 * `F3.5b` U11 (ADR 0071 decisions 7, 11; plan R-12, R-16; Q-2, Q-5, Q-6) —
 * `ReportSchedulesService` against a real database and a real bucket.
 *
 * `report-schedules.service.spec.ts` drives the same service over fakes and
 * proves the seams. What a fake cannot tell you is whether `0078`'s `WITH
 * CHECK` refuses a foreign stamp, whether the tenant policy hides ESKOM's
 * row under PHEWB's GUC, whether a `location_admin`'s real grants admit
 * exactly its own location, whether `countFiles`'s `schedule_id IS NULL`
 * really spares a scheduled row from the on-demand cap, whether the
 * row-then-object delete really empties the bucket, what `pg` returns for
 * `time(0)` (§8), and what the audit rows really carry. That is what this
 * file measures.
 *
 * **This suite commits.** The service opens `withTenant` itself, so every
 * row is a committed row named `f3.5b-sched-<uuid>`; `afterAll` (the
 * `.test.ts`) deletes, as `bms_fleet`, every audit row, file row, schedule
 * and channel whose id this run recorded — bounded by ids, never by
 * `entity_type` alone — with count assertions, and every object whose key
 * was put. `pgArray()` binds every array (a JS array inside a `sql` template
 * renders `($1, $2)`, the U8/U10 measurement).
 *
 * **One rollback-isolated case** (`theInsertStampedWithAForeignOrganizationIs42501`)
 * runs under `withRollback` and ends with `tx.rollback()`.
 */

export type ScheduleIntegrationFixtures = {
  readonly base: ReportFileIntegrationFixtures;
  readonly channels: ChannelsService;
  readonly service: ReportSchedulesService;
  /** `RSMOC-EC` — an ESKOM location `wc-admin@bms.local` does not hold. */
  readonly ecId: string;
  readonly scheduleIds: string[];
  /** Schedules a row removed through the service; excluded from the sweep's expected count. */
  readonly removedScheduleIds: string[];
  readonly fileIds: string[];
  readonly channelIds: string[];
};

export type OpenScheduleFixtures = {
  readonly fx: ScheduleIntegrationFixtures;
  readonly close: () => Promise<void>;
};

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A Postgres array literal for one bound parameter (the U8 measurement). */
export function pgArray(values: readonly string[]): string {
  return `{${values.join(",")}}`;
}

export const admin = (): JwtPayload => jwtFor(SEEDED.globalAdmin, "admin");
export const pheAdmin = (): JwtPayload => jwtFor(SEEDED.organizationAdmin, "organization_admin");
export const wcAdmin = (): JwtPayload => jwtFor(SEEDED.locationAdmin, "location_admin");
export const wcHvacAdmin = (): JwtPayload => jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");

export async function openScheduleFixtures(
  connectionString: string,
  config: ConfiguredStorageConfig,
  label: string,
): Promise<OpenScheduleFixtures> {
  const opened = await openReportFileFixtures(connectionString, config, label);
  const base = opened.fx;
  const ec = await base.fleetDb.execute<{ id: string }>(sql`select id::text as id from bms.locations where code = 'RSMOC-EC'`);
  const ecId = ec.rows[0]?.id;
  if (!ecId) {
    throw new Error("F3.5b: the seeded location RSMOC-EC is missing — run pnpm db:seed");
  }
  const channels = new ChannelsService(base.fleetDb, base.tenantDb, new CredentialCryptoService(), base.accessControl);
  const fx: ScheduleIntegrationFixtures = {
    base,
    channels,
    service: new ReportSchedulesService(
      base.tenantDb,
      base.fleetDb,
      base.client,
      base.accessControl,
      channels,
      new MasterDataAuditService(base.tenantDb, base.fleetDb),
    ),
    ecId,
    scheduleIds: [],
    removedScheduleIds: [],
    fileIds: [],
    channelIds: [],
  };

  const close = async (): Promise<void> => {
    const failures: string[] = [];
    try {
      const fleet = base.fleetDb;
      if (fx.fileIds.length > 0) {
        await fleet.execute(
          sql`delete from bms.audit_log where entity_type = 'report_file' and entity_id = any(${pgArray(fx.fileIds)}::uuid[])`,
        );
        await fleet.execute(sql`delete from bms.report_files where id = any(${pgArray(fx.fileIds)}::uuid[])`);
      }
      if (fx.scheduleIds.length > 0) {
        await fleet.execute(
          sql`delete from bms.audit_log where entity_type = 'report_schedule' and entity_id = any(${pgArray(fx.scheduleIds)}::uuid[])`,
        );
        const deleted = await fleet.execute(
          sql`delete from bms.report_schedules where id = any(${pgArray(fx.scheduleIds)}::uuid[])`,
        );
        const expected = fx.scheduleIds.length - fx.removedScheduleIds.length;
        if (deleted.rowCount !== expected) {
          failures.push(`expected the sweep to delete ${expected} schedule row(s), got ${deleted.rowCount}`);
        }
      }
      if (fx.channelIds.length > 0) {
        const deleted = await fleet.execute(
          sql`delete from bms.notification_channels where id = any(${pgArray(fx.channelIds)}::uuid[])`,
        );
        if (deleted.rowCount !== fx.channelIds.length) {
          failures.push(`expected the sweep to delete ${fx.channelIds.length} channel row(s), got ${deleted.rowCount}`);
        }
      }
    } finally {
      // The base sweep deletes the on-demand file rows and every put key.
      await opened.close();
    }
    if (failures.length > 0) {
      throw new Error(`F3.5b schedule sweep: ${failures.join("; ")}`);
    }
  };

  return { fx, close };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function body(fx: ScheduleIntegrationFixtures, overrides: Partial<CreateReportScheduleBodyInput> = {}): CreateReportScheduleBodyInput {
  return {
    name: `f3.5b-sched-${randomUUID()}`,
    formats: ["pdf"],
    cadence: "daily",
    runAtLocal: "07:00",
    timezone: "Asia/Kolkata",
    locationIds: [],
    organizationId: fx.base.eskomId,
    ...overrides,
  };
}

/** One create through the service, recorded for the sweep. */
export async function createAs(
  fx: ScheduleIntegrationFixtures,
  jwt: JwtPayload,
  overrides: Partial<CreateReportScheduleBodyInput> = {},
): Promise<ReportScheduleDto> {
  const dto = await fx.service.create(jwt, body(fx, overrides));
  fx.scheduleIds.push(dto.id);
  return dto;
}

/** The schedule's row count by id under one organization's GUC, on the real `bms_tenant` connection. */
async function countUnderTenant(fx: ScheduleIntegrationFixtures, organizationId: string, scheduleId: string): Promise<number> {
  return withTenant(fx.base.tenantDb, organizationId, async (tx) => {
    const result = await tx.execute<{ n: string }>(
      sql`select count(*)::text as n from bms.report_schedules where id = ${scheduleId}::uuid`,
    );
    return Number(result.rows[0]?.n ?? "-1");
  });
}

async function countScheduleRow(fx: ScheduleIntegrationFixtures, scheduleId: string): Promise<number> {
  const result = await fx.base.fleetDb.execute<{ n: string }>(
    sql`select count(*)::text as n from bms.report_schedules where id = ${scheduleId}::uuid`,
  );
  return Number(result.rows[0]?.n ?? "-1");
}

async function countFileRows(fx: ScheduleIntegrationFixtures, fileIds: readonly string[]): Promise<number> {
  const result = await fx.base.fleetDb.execute<{ n: string }>(
    sql`select count(*)::text as n from bms.report_files where id = any(${pgArray(fileIds)}::uuid[])`,
  );
  return Number(result.rows[0]?.n ?? "-1");
}

/** One committed `report_files` row bound to a schedule, as `bms_fleet`, with a real object when `bytes` is given. */
async function insertScheduledFile(
  fx: ScheduleIntegrationFixtures,
  scheduleId: string,
  organizationId: string,
  bytes: Buffer | null,
  period: { start: string; end: string } = { start: "2026-09-01", end: "2026-09-07" },
): Promise<{ fileId: string; key: string }> {
  const fileId = randomUUID();
  const key = buildReportObjectKey({ organizationId, fileId });
  const content = bytes ?? Buffer.from("%PDF-1.4 f3.5b scheduled probe");
  if (bytes !== null) {
    await putObject(fx.base.client, key, bytes, "application/pdf");
    fx.base.putKeys.push(key);
  }
  await fx.base.fleetDb.execute(sql`
    insert into bms.report_files
      (id, organization_id, template_id, format, period_start, period_end, location_ids, object_key, content_type,
       byte_size, sha256, filename, delivery_status, delivery_error, schedule_id, created_by)
    values
      (${fileId}, ${organizationId}, 'energy_consumption', 'pdf', ${period.start}::date, ${period.end}::date, '{}'::uuid[], ${key},
       'application/pdf', ${content.length}, ${sha256Of(content)}, ${`energy-consumption-${period.start}-to-${period.end}.pdf`},
       'none', null, ${scheduleId}, null)
  `);
  fx.fileIds.push(fileId);
  return { fileId, key };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** `0078`'s policy: the row is visible under ESKOM's GUC and invisible under PHEWB's. */
export async function adminCreatesForEskomAndTheRowIsForced(fx: ScheduleIntegrationFixtures): Promise<void> {
  const dto = await createAs(fx, admin());
  assert(dto.organizationId === fx.base.eskomId, "the positive control failed: the DTO must carry ESKOM");
  const underEskom = await countUnderTenant(fx, fx.base.eskomId, dto.id);
  const underPhewb = await countUnderTenant(fx, fx.base.phewbId, dto.id);
  assert(underEskom === 1, `bms_tenant under ESKOM must see the row; counted ${underEskom}`);
  assert(underPhewb === 0, `bms_tenant under PHEWB must not see ESKOM's row; counted ${underPhewb}`);
}

/** The SQLSTATE of a database rejection, dug out of the error and its cause. */
function sqlState(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** `42501` — `insufficient_privilege`, the code a `WITH CHECK` violation answers with. Nothing commits. */
export async function theInsertStampedWithAForeignOrganizationIs42501(fx: ScheduleIntegrationFixtures): Promise<void> {
  let crossOrg: unknown;
  await withRollback(fx.base.tenantDb, async (tx: BmsTx) => {
    await tx.execute(sql`select set_config('app.current_organization', ${fx.base.eskomId}, true)`);
    crossOrg = await captureRejection(() =>
      tx.transaction((inner) =>
        inner.insert(reportSchedules).values({
          organizationId: fx.base.phewbId,
          name: `f3.5b-sched-${randomUUID()}`,
          templateId: "energy_consumption",
          formats: ["pdf"],
          cadence: "daily",
          runAtLocal: "07:00",
          timezone: "Asia/Kolkata",
          locationIds: [],
          nextRunAt: new Date(),
        }),
      ),
    );
    await tx.rollback();
  });
  const state = sqlState(crossOrg);
  assert(state === "42501", `a row stamped PHEWB under ESKOM's GUC must be refused with 42501; got ${String(state)} (${errorName(crossOrg)})`);
}

/** R-12 on real grants: `[WC]` is admitted, `[EC]` is 403, `[]` is 403. */
export async function wcAdminCreatesOnlyWithItsOwnLocation(fx: ScheduleIntegrationFixtures, scope: "WC" | "OTHER" | "EMPTY"): Promise<void> {
  if (scope === "WC") {
    const dto = await createAs(fx, wcAdmin(), { locationIds: [fx.base.wcId], organizationId: undefined });
    assert(dto.organizationId === fx.base.eskomId, `the row must be ESKOM's; got ${dto.organizationId}`);
    assert(JSON.stringify(dto.locationIds) === JSON.stringify([fx.base.wcId]), `the row must carry [WC]; got ${JSON.stringify(dto.locationIds)}`);
    return;
  }
  const locationIds = scope === "OTHER" ? [fx.ecId] : [];
  const err = await captureRejection(() => fx.service.create(wcAdmin(), body(fx, { locationIds, organizationId: undefined })));
  assert(errorName(err) === "ForbiddenException", `${scope} must be 403; got ${errorName(err)}: ${errorMessage(err)}`);
  const expected = scope === "OTHER" ? "locationIds is outside your access scope" : "An empty location scope requires organization-level rights";
  assert(errorMessage(err) === expected, `expected "${expected}", got "${errorMessage(err)}"`);
}

/** Decision 6's `wc-hvac-admin` case: every route is 403 with the master-data sentence, before any read. */
export async function assetGroupAdminIsRefusedOnEveryRoute(fx: ScheduleIntegrationFixtures): Promise<void> {
  const target = await createAs(fx, admin());
  const runs: [string, () => Promise<unknown>][] = [
    ["create", () => fx.service.create(wcHvacAdmin(), body(fx))],
    ["list", () => fx.service.list(wcHvacAdmin())],
    ["get", () => fx.service.get(wcHvacAdmin(), target.id)],
    ["update", () => fx.service.update(wcHvacAdmin(), target.id, { name: "renamed" })],
    ["remove", () => fx.service.remove(wcHvacAdmin(), target.id)],
  ];
  for (const [route, run] of runs) {
    const err = await captureRejection(run);
    assert(errorName(err) === "ForbiddenException", `${route} must be 403 for an asset_group_admin; got ${errorName(err)}`);
    assert(errorMessage(err).startsWith("Master data administration requires"), `${route}: expected the master-data sentence, got "${errorMessage(err)}"`);
  }
  assert((await countScheduleRow(fx, target.id)) === 1, "the refused remove must leave the row");
}

/** An organization admin lists its own organization's rows and not ESKOM's. */
export async function pheAdminListsOnlyPhewb(fx: ScheduleIntegrationFixtures): Promise<void> {
  const eskom = await createAs(fx, admin());
  const phewb = await createAs(fx, admin(), { organizationId: fx.base.phewbId, timezone: "Asia/Kolkata" });
  const listed = new Set((await fx.service.list(pheAdmin())).map((row) => row.id));
  assert(listed.has(phewb.id), "the PHEWB admin must list the PHEWB row");
  assert(!listed.has(eskom.id), "the PHEWB admin must not list ESKOM's row");
}

/** The tenant branch still applies the location predicate: the admin's `{}` row is hidden from the location admin. */
export async function wcAdminSeesItsOwnAndNotTheAdminsEmptyScopeRow(fx: ScheduleIntegrationFixtures): Promise<void> {
  const own = await createAs(fx, wcAdmin(), { locationIds: [fx.base.wcId], organizationId: undefined });
  const whole = await createAs(fx, admin());
  const listed = new Set((await fx.service.list(wcAdmin())).map((row) => row.id));
  assert(listed.has(own.id), "wc-admin must list its own [WC] row");
  assert(!listed.has(whole.id), "wc-admin must not list the admin's {} row");
}

/** The same verdict on the by-id routes: the `{}` row is 403 with the one sentence. */
export async function wcAdminCannotReadTheWholeOrganizationSchedule(fx: ScheduleIntegrationFixtures): Promise<void> {
  const whole = await createAs(fx, admin());
  const err = await captureRejection(() => fx.service.get(wcAdmin(), whole.id));
  assert(errorName(err) === "ForbiddenException", `expected 403, got ${errorName(err)}`);
  assert(errorMessage(err) === SCHEDULE_OUT_OF_SCOPE_SENTENCE, `got "${errorMessage(err)}"`);
}

/**
 * F3.5a R-11's promised change, gated: a `schedule_id` row does not count
 * toward `REPORT_ONDEMAND_CAP`. The cap is set to the on-demand count plus
 * one, so the save is admitted only if the scheduled row is excluded.
 */
export async function aScheduledFileDoesNotCountTowardTheOnDemandCap(fx: ScheduleIntegrationFixtures): Promise<void> {
  const schedule = await createAs(fx, admin());
  await insertScheduledFile(fx, schedule.id, fx.base.eskomId, null);
  const onDemand = await fx.base.fleetDb.execute<{ n: string }>(
    sql`select count(*)::text as n from bms.report_files where organization_id = ${fx.base.eskomId}::uuid and schedule_id is null`,
  );
  const onDemandCount = Number(onDemand.rows[0]?.n ?? "-1");
  assert(onDemandCount >= 0, "the on-demand count read failed");
  const files = reportFilesService(fx.base, fx.base.client, {
    config: { onDemandCap: onDemandCount + 1, retentionPerSchedule: 24, emailMaxBytes: 10_485_760, historyUrl: null },
  });
  const dto = await files.saveOnDemand(admin(), { startDate: "2026-09-01", endDate: "2026-09-07", format: "pdf", organizationId: fx.base.eskomId });
  fx.base.createdFileIds.push(dto.id);
  fx.base.putKeys.push(buildReportObjectKey({ organizationId: fx.base.eskomId, fileId: dto.id }));
  assert(dto.scheduleId === null, "the positive control failed: the on-demand save must answer a row with scheduleId null");
}

/** Q-2: two file rows and their objects go with the schedule; the bucket is empty afterwards. */
export async function removeTakesTheFilesWithIt(fx: ScheduleIntegrationFixtures): Promise<void> {
  const schedule = await createAs(fx, admin());
  const a = await insertScheduledFile(fx, schedule.id, fx.base.eskomId, Buffer.from("%PDF-1.4 f3.5b remove a"));
  // A second period: `report_files_schedule_period_format_key` refuses two rows of one schedule, period and format.
  const b = await insertScheduledFile(fx, schedule.id, fx.base.eskomId, Buffer.from("%PDF-1.4 f3.5b remove b"), {
    start: "2026-09-08",
    end: "2026-09-14",
  });
  assert((await headObject(fx.base.client, a.key)) !== null, "the positive control failed: object a is not in the bucket");

  await fx.service.remove(admin(), schedule.id);
  fx.removedScheduleIds.push(schedule.id);

  assert((await countScheduleRow(fx, schedule.id)) === 0, "the schedule row must be gone");
  assert((await countFileRows(fx, [a.fileId, b.fileId])) === 0, "both file rows must be gone");
  assert((await headObject(fx.base.client, a.key)) === null, "object a must be gone from the bucket");
  assert((await headObject(fx.base.client, b.key)) === null, "object b must be gone from the bucket");
  const err = await captureRejection(() => fx.service.get(admin(), schedule.id));
  assert(errorName(err) === "NotFoundException", `a removed schedule must be 404; got ${errorName(err)}`);
}

/** A real `email` channel of ESKOM, created through `ChannelsService.create` as admin, is accepted. */
export async function channelOfThisOrganizationIsAccepted(fx: ScheduleIntegrationFixtures): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const channel = await fx.channels.create(admin(), {
    organizationId: fx.base.eskomId,
    code: `f35b-sched-${suffix}`,
    name: `f3.5b-sched-${suffix}`,
    kind: "email",
    config: { to: ["f3.5b@example.test"] },
    enabled: true,
  });
  fx.channelIds.push(channel.id);
  const dto = await createAs(fx, admin(), { channelId: channel.id });
  assert(dto.channelId === channel.id, `the DTO must carry the channel id; got ${String(dto.channelId)}`);
}

/** Q-6 on real grants: `ChannelsService.loadById` refuses a `location_admin` before the channel is read. */
export async function wcAdminCannotAttachAChannel(fx: ScheduleIntegrationFixtures): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const channel = await fx.channels.create(admin(), {
    organizationId: fx.base.eskomId,
    code: `f35b-sched-${suffix}`,
    name: `f3.5b-sched-${suffix}`,
    kind: "email",
    config: { to: ["f3.5b@example.test"] },
    enabled: true,
  });
  fx.channelIds.push(channel.id);
  const err = await captureRejection(() =>
    fx.service.create(wcAdmin(), body(fx, { locationIds: [fx.base.wcId], organizationId: undefined, channelId: channel.id })),
  );
  assert(errorName(err) === "ForbiddenException", `expected 403, got ${errorName(err)}: ${errorMessage(err)}`);
  assert(errorMessage(err) === "Notification channel is outside your access scope", `got "${errorMessage(err)}"`);
}

type AuditRow = {
  readonly action: string;
  readonly organization_id: string | null;
  readonly actor_id: string | null;
  readonly payload: Record<string, unknown> | null;
};

/** R-10: the three audit rows name the actor and the organization and carry ids and enums, never the name. */
export async function auditRowsCarryIdsOnly(fx: ScheduleIntegrationFixtures): Promise<void> {
  const created = await createAs(fx, admin());
  await fx.service.update(admin(), created.id, { enabled: false });
  await fx.service.remove(admin(), created.id);
  fx.removedScheduleIds.push(created.id);
  const result = await fx.base.fleetDb.execute<AuditRow>(
    sql`select action, organization_id::text as organization_id, actor_id::text as actor_id, payload
          from bms.audit_log where entity_type = 'report_schedule' and entity_id = ${created.id}::uuid order by action`,
  );
  const actions = result.rows.map((row) => row.action);
  assert(
    JSON.stringify(actions) === JSON.stringify(["report_schedule.create", "report_schedule.delete", "report_schedule.update"]),
    `expected the three actions, got ${JSON.stringify(actions)}`,
  );
  for (const row of result.rows) {
    assert(row.organization_id === fx.base.eskomId, `${row.action} must carry ESKOM; got ${String(row.organization_id)}`);
    assert(row.actor_id === fx.base.adminUserId, `${row.action} must carry the seeded admin; got ${String(row.actor_id)}`);
    const payload = JSON.stringify(row.payload);
    assert(!payload.includes(created.name), `${row.action}'s payload must not carry the name: ${payload}`);
    assert(payload.includes(created.id), `${row.action}'s payload must carry the schedule id: ${payload}`);
  }
}

/** §8, pinned: `pg` returns `time(0)` as `HH:MM:SS`; the DTO carries `HH:MM`. */
export async function runAtLocalRoundTripsAsHHMM(fx: ScheduleIntegrationFixtures): Promise<void> {
  const dto = await createAs(fx, admin(), { runAtLocal: "07:00" });
  assert(dto.runAtLocal === "07:00", `the DTO must carry "07:00"; got "${dto.runAtLocal}"`);
  const stored = await fx.base.fleetDb.execute<{ run_at_local: unknown }>(
    sql`select run_at_local from bms.report_schedules where id = ${dto.id}::uuid`,
  );
  const raw = stored.rows[0]?.run_at_local;
  assert(raw === "07:00:00", `pg must return time(0) as "07:00:00" (a string); got ${JSON.stringify(raw)} (${typeof raw})`);
  const reread = await fx.service.get(admin(), dto.id);
  assert(reread.runAtLocal === "07:00", `the re-read DTO must carry "07:00"; got "${reread.runAtLocal}"`);
}

/** Q-3 on a real row: `enabled: false` leaves `next_run_at`; `enabled: true` moves it strictly after now. */
export async function reenableMovesNextRunAtOnARealRow(fx: ScheduleIntegrationFixtures): Promise<void> {
  const dto = await createAs(fx, admin());
  // Park the row a year overdue as bms_fleet, so a recompute is visible as a move.
  await fx.base.fleetDb.execute(
    sql`update bms.report_schedules set next_run_at = now() - interval '365 days' where id = ${dto.id}::uuid`,
  );
  const disabled = await fx.service.update(admin(), dto.id, { enabled: false });
  assert(new Date(disabled.nextRunAt).getTime() < Date.now(), "disabling must not move next_run_at");
  const before = Date.now();
  const enabled = await fx.service.update(admin(), dto.id, { enabled: true });
  assert(new Date(enabled.nextRunAt).getTime() > before, `re-enabling must move next_run_at after now; got ${enabled.nextRunAt}`);
  assert(enabled.updatedAt !== dto.updatedAt, "updated_at must move on a PATCH");
}
