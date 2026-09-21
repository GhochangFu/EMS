import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { vi } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, ReportFileDto } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { assertFixturesPresent, SEEDED, jwtFor } from "../auth/access-control.integration.spec";
import { AccessControlService } from "../auth/access-control.service";
import type { BmsTx } from "../database/tenant-context";
import { createAwsS3Ops } from "../storage/aws-s3-ops";
import { buildReportObjectKey } from "../storage/object-key";
import { createStorageClient, deleteObject, ensureBucket, headObject, type S3Ops, type StorageClient } from "../storage/storage-client";
import { openIntegrationPool } from "../testing/integration-db-gate";
import type { ConfiguredStorageConfig } from "../testing/integration-storage-gate";
import { asRole } from "../testing/role-urls";
import type { ReportFilesConfig } from "./report-files-config";
import { OUT_OF_SCOPE_SENTENCE, ReportFilesService } from "./report-files.service";
import { ReportsService } from "./reports.service";

/**
 * `F3.5a` (ADR 0071 decisions 4, 5, 6, 11; Amendment 1 items 1–3) — the
 * stored report files against a real S3 endpoint and a real database.
 *
 * `report-files.service.spec.ts` drives the same service over fakes and
 * proves the seams. What a fake cannot tell you is whether the `0077`
 * `WITH CHECK` refuses a row stamped with another organization, whether the
 * tenant policy hides ESKOM's row under PHEWB's GUC, whether the cap holds
 * against rows that are really committed, whether the object the service
 * says it discarded is really gone from the bucket, and whether the three
 * seeded roles see exactly the files decision 6 gives them. That is what this
 * file measures.
 *
 * **Two connections, two jobs (the `asset-images-write` shape).** `bms_fleet`
 * is `BYPASSRLS`: it is the counting and teardown connection and proves
 * nothing about the policy. Every count is read on it and **scoped to a file
 * id this suite created** — `bms_owner` would answer 0 with the rows present
 * (`FORCE ROW LEVEL SECURITY`), and a fleet-wide count would also see another
 * suite's committed rows. The service's own writes run through
 * `withTenant(tenantDb, …)` on a real `bms_tenant` connection.
 *
 * **No fixture assets.** The render reads the seeded assets through
 * `readableAssetIdsInOrganization`, `bms.report_files` references no asset,
 * and the RLS row inserts a bare row — so nothing here needs
 * `createFixtureAssets`, and nothing here reads `bms.assets` positionally.
 * The organizations and the one location the rows name are resolved by
 * **code** (`ESKOM`, `PHEWB`, `RSMOC-WC`), never by a uuid literal and never
 * by `LIMIT 1`.
 *
 * **Cleanup, twice.** Every row deletes its own file rows and objects in
 * `finally`; `afterAll` (the `.test.ts`) deletes, as `bms_fleet`, every
 * `bms.report_files` row and every `bms.audit_log` row whose id is in
 * `fx.createdFileIds` — bounded by ids this run made, never by
 * `entity_type` alone — and every object whose key is in `fx.putKeys`.
 *
 * **Two specs, one lifecycle.** This file holds the save, the scope and the
 * list rows and exports the helpers and `openReportFileFixtures`;
 * `report-files-lifecycle.integration.spec.ts` holds the `0077` policy rows
 * (the one rollback-isolated case) and the lifecycle rows. The split is
 * AGENTS.md §4.5's 1000-line cap, and the policy rows sit in the second file
 * because `tests/integration-fixture-isolation.test.ts` scans a
 * rollback-isolated spec for any `bms.assets` read — the render-scope row
 * here reads one as its expectation (see `assetIdsOfLocation`).
 *
 * **The cap row costs two saves, not fifty.** It builds its own service with
 * `REPORT_FILES_CONFIG = { onDemandCap: <count before> + 2 }` in PHEWB, so a
 * row another session left behind moves the threshold rather than turning
 * the third save's 409 into a refusal that proves nothing about the cap.
 *
 * **`jwtFor` is usable here.** Its `sub` is a synthetic uuid that matches no
 * user; `ReportFilesService.resolveActorId`, `MasterDataAuditService.write`
 * and `AccessControlService.resolveDbUser` all fall through to the email, so
 * `created_by` and `audit_log.actor_id` resolve to the seeded user's real id
 * — which `auditRowsCarryIdsOnly` reads by email as its expectation.
 */

/** Everything the assertions need. Built once by the `.test.ts` lifecycle. */
export type ReportFileIntegrationFixtures = {
  /** The real configured client over `createAwsS3Ops`, bound to the configured bucket. */
  readonly client: StorageClient;
  readonly fleetDb: BmsDb;
  readonly tenantDb: BmsDb;
  readonly accessControl: AccessControlService;
  readonly reports: ReportsService;
  readonly eskomId: string;
  readonly phewbId: string;
  /** `RSMOC-WC` — the one location `wc-admin@bms.local` holds. */
  readonly wcId: string;
  /** `admin@bms.local`'s `bms.users.id`, read by email — the audit row's expected actor. */
  readonly adminUserId: string;
  /**
   * The seeded asset ids of one location, read as `bms_fleet` at call time —
   * the independent expectation for the render-scope row. It is an
   * expectation over seed rows, not a fixture: nothing in this suite writes a
   * row that references these ids, so the `23503` class
   * `tests/integration-fixture-isolation.test.ts` guards against cannot
   * occur here. Read **after** the render scope it is compared with, so a
   * fixture asset a concurrent suite commits in RSMOC-WC lands in this set
   * only and the `⊆` still holds.
   */
  readonly assetIdsOfLocation: (locationId: string) => Promise<Set<string>>;
  /** Every file id a row created, for the `afterAll` sweep of rows and audit rows. */
  readonly createdFileIds: string[];
  /** Every key a row put, for the `afterAll` sweep of the bucket. */
  readonly putKeys: string[];
};

export const PERIOD = { startDate: "2026-09-01", endDate: "2026-09-07" } as const;

/** The R-9 payload keys of `report_file.create`; `report_file.delete` carries the first two. */
export const AUDIT_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "fileId",
  "organizationId",
  "format",
  "byteSize",
  "sha256",
  "periodStart",
  "periodEnd",
]);

const MASTER_DATA_SENTENCE =
  "Master data administration requires admin, organization_admin, or location_admin role";

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

/** Captures a rejection. A call that resolves fails here, never inside a `catch`. */
export async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  let resolved = false;
  let thrown: unknown;
  try {
    await run();
    resolved = true;
  } catch (err) {
    thrown = err;
  }
  if (resolved) {
    throw new Error("expected the call to reject, but it resolved");
  }
  return thrown;
}

export function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : String(err);
}

export function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
    ? (err as { message: string }).message
    : String(err);
}

/** Runs `fn` with `Logger.prototype.warn` captured; restores the spy whatever happens. */
export async function capturingWarns<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[] }> {
  const warns: string[] = [];
  const spy = vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
    warns.push(String(message));
  });
  try {
    return { result: await fn(), warns };
  } finally {
    spy.mockRestore();
  }
}

/** One file row, by id, on whichever executor the caller is on. */
export async function countFileRow(db: BmsDb | BmsTx, fileId: string): Promise<number> {
  const result = await db.execute<{ n: string }>(
    sql`select count(*)::text as n from bms.report_files where id = ${fileId}::uuid`,
  );
  return Number(result.rows[0]?.n ?? "-1");
}

/** The organization's row count, read as `bms_fleet` — the cap's own predicate. */
export async function countFilesForOrganization(db: BmsDb, organizationId: string): Promise<number> {
  const result = await db.execute<{ n: string }>(
    sql`select count(*)::text as n from bms.report_files where organization_id = ${organizationId}::uuid`,
  );
  return Number(result.rows[0]?.n ?? "-1");
}

type StoredColumns = {
  readonly object_key: string;
  readonly byte_size: number;
  readonly sha256: string;
  readonly location_ids: string[];
  readonly organization_id: string;
  readonly delivery_status: string;
  readonly created_by: string | null;
};

/** The stored columns the DTO hides, read on the fleet pool. */
async function readStoredColumns(db: BmsDb, fileId: string): Promise<StoredColumns | null> {
  const result = await db.execute<StoredColumns>(
    sql`select object_key, byte_size, sha256, location_ids, organization_id::text as organization_id,
               delivery_status, created_by::text as created_by
          from bms.report_files where id = ${fileId}::uuid`,
  );
  return result.rows[0] ?? null;
}

export type AuditRow = {
  readonly action: string;
  readonly entity_id: string | null;
  readonly organization_id: string | null;
  readonly actor_id: string | null;
  readonly payload: Record<string, unknown> | null;
};

/** Audit rows for one file id, read as `bms_fleet`. */
export async function readAuditRows(db: BmsDb, fileId: string): Promise<AuditRow[]> {
  const result = await db.execute<AuditRow>(
    sql`select action,
               entity_id::text as entity_id,
               organization_id::text as organization_id,
               actor_id::text as actor_id,
               payload
          from bms.audit_log
         where entity_type = 'report_file'
           and entity_id = ${fileId}::uuid
         order by action`,
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// The recording client, the services and the per-row cleanup
// ---------------------------------------------------------------------------

/** What the probe wrapper makes `deleteObject` throw. A name, so §9.6 holds. */
class DeleteProbeError extends Error {
  override readonly name = "DeleteProbeError";
}

/** What the probe makes `MasterDataAuditService.write` throw inside the tenant transaction. */
export class AuditProbeError extends Error {
  override readonly name = "AuditProbeError";
}

export type StorageRecorder = {
  readonly client: StorageClient;
  /** Operation names in call order — read as a delta, never as a lifetime count. */
  readonly calls: string[];
  readonly putKeys: string[];
  readonly state: { failDeletes: boolean };
};

/**
 * Wraps the real client so a row can read the key `putObject` was called with
 * (the service never returns it), count the calls a refused save made, and
 * make `deleteObject` fail on demand (decision 11 on a real endpoint). Every
 * key put is also pushed onto `fx.putKeys` for the `afterAll` sweep.
 */
export function recordingClient(fx: ReportFileIntegrationFixtures): StorageRecorder {
  const base = fx.client;
  if (base.kind !== "configured") {
    throw new Error("the integration client must be configured — the storage gate returned no config");
  }
  const calls: string[] = [];
  const putKeys: string[] = [];
  const state = { failDeletes: false };
  const ops: S3Ops = {
    headBucket: (bucket) => base.ops.headBucket(bucket),
    createBucket: (bucket) => base.ops.createBucket(bucket),
    putObject: async (bucket, key, body, contentType) => {
      calls.push("putObject");
      putKeys.push(key);
      fx.putKeys.push(key);
      await base.ops.putObject(bucket, key, body, contentType);
    },
    getObject: (bucket, key) => base.ops.getObject(bucket, key),
    headObject: (bucket, key) => base.ops.headObject(bucket, key),
    deleteObject: async (bucket, key) => {
      calls.push("deleteObject");
      if (state.failDeletes) {
        throw new DeleteProbeError("probe: the object delete was refused");
      }
      await base.ops.deleteObject(bucket, key);
    },
  };
  return { client: { kind: "configured", bucket: base.bucket, ops }, calls, putKeys, state };
}

const DEFAULT_CONFIG: ReportFilesConfig = {
  onDemandCap: 50,
  retentionPerSchedule: 24,
  emailMaxBytes: 10_485_760,
  historyUrl: null,
};

export function service(
  fx: ReportFileIntegrationFixtures,
  client: StorageClient,
  options: { config?: ReportFilesConfig; audit?: MasterDataAuditService } = {},
): ReportFilesService {
  return new ReportFilesService(
    fx.tenantDb,
    fx.fleetDb,
    client,
    options.config ?? DEFAULT_CONFIG,
    fx.reports,
    fx.accessControl,
    options.audit ?? new MasterDataAuditService(fx.tenantDb, fx.fleetDb),
  );
}

export const admin = (): JwtPayload => jwtFor(SEEDED.globalAdmin, "admin");
const pheAdmin = (): JwtPayload => jwtFor(SEEDED.organizationAdmin, "organization_admin");
const wcAdmin = (): JwtPayload => jwtFor(SEEDED.locationAdmin, "location_admin");
const wcHvacAdmin = (): JwtPayload => jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");

/** The global admin's ESKOM save — the file most rows start from. */
export async function saveAsAdmin(
  fx: ReportFileIntegrationFixtures,
  svc: ReportFilesService,
  format: "pdf" | "xlsx" = "pdf",
  organizationId: string = fx.eskomId,
): Promise<ReportFileDto> {
  const dto = await svc.saveOnDemand(admin(), { ...PERIOD, format, organizationId });
  fx.createdFileIds.push(dto.id);
  return dto;
}

/** Removes one file row and one object as `bms_fleet`, and never lets one failure skip the other. */
export async function discard(fx: ReportFileIntegrationFixtures, fileId: string, key: string | null): Promise<void> {
  const [dbDelete] = await Promise.allSettled([
    fx.fleetDb.execute(sql`delete from bms.report_files where id = ${fileId}::uuid`),
    key === null ? Promise.resolve() : deleteObject(fx.client, key).catch(() => undefined),
  ]);
  if (dbDelete.status === "rejected") {
    throw dbDelete.reason;
  }
}


// ---------------------------------------------------------------------------
// Rows 1, 2 — the admin's save: DTO, row, object and bytes agree
// ---------------------------------------------------------------------------

type SaveRun = {
  readonly dto: ReportFileDto;
  readonly stored: StoredColumns;
  readonly head: { contentLength: number } | null;
  readonly fetched: Buffer;
};

/** One save as the global admin, the fleet read, the head and the proxied download; row and object go in `finally`. */
async function runAdminSave(fx: ReportFileIntegrationFixtures, format: "pdf" | "xlsx"): Promise<SaveRun> {
  const recorder = recordingClient(fx);
  const svc = service(fx, recorder.client);
  const dto = await saveAsAdmin(fx, svc, format);
  const key = recorder.putKeys[0] ?? null;
  try {
    const stored = await readStoredColumns(fx.fleetDb, dto.id);
    assert(stored !== null, "the positive control failed: the fleet read found no row for the saved file");
    const head = key === null ? null : await headObject(fx.client, key);
    const { body } = await svc.download(admin(), dto.id);
    return { dto, stored: stored as StoredColumns, head, fetched: await collect(body) };
  } finally {
    await discard(fx, dto.id, key);
  }
}

/** Decision 4: the DTO the save answers carries no `objectKey`. */
export async function adminSaveReturnsADtoWithoutTheObjectKey(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAdminSave(fx, "pdf");
  const dto = run.dto as unknown as Record<string, unknown>;
  assert(typeof dto.id === "string" && dto.id.length > 0, "the positive control failed: the save returned no id");
  assert(!Object.hasOwn(dto, "objectKey"), `the DTO must not carry objectKey; keys: ${Object.keys(dto).join(", ")}`);
}

/** The stored key is `buildReportObjectKey` of the two ids, and nothing else. */
export async function adminSaveStoresTheBuiltKey(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAdminSave(fx, "pdf");
  const expected = buildReportObjectKey({ organizationId: fx.eskomId, fileId: run.dto.id });
  assert(run.stored.object_key === expected, `object_key must be the built key; stored ${run.stored.object_key}`);
}

/** Amendment 1 item 2: a global admin's save stamps `{}`. */
export async function adminSaveStampsTheEmptyArray(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAdminSave(fx, "pdf");
  assert(
    Array.isArray(run.stored.location_ids) && run.stored.location_ids.length === 0,
    `a global admin's save stamps '{}'; stored ${JSON.stringify(run.stored.location_ids)}`,
  );
}

/** `delivery_status = 'none'` and `created_by` = the seeded admin (F3.5a writes `none` and never changes it). */
export async function adminSaveWritesDeliveryNoneAndTheCreator(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAdminSave(fx, "pdf");
  assert(run.stored.delivery_status === "none", `delivery_status must be 'none'; got ${run.stored.delivery_status}`);
  assert(
    run.stored.created_by === fx.adminUserId,
    `created_by must be the seeded admin ${fx.adminUserId}; got ${String(run.stored.created_by)}`,
  );
}

/** Decision 4, R-3: the object in the bucket is the rendered PDF the row describes — length, sha256 and signature. */
export async function adminSavePutsThePdfTheRowDescribes(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAdminSave(fx, "pdf");
  assert(
    run.head !== null && run.head.contentLength === run.dto.byteSize,
    `headObject must answer the row's byteSize ${run.dto.byteSize}; got ${String(run.head?.contentLength)}`,
  );
  assert(sha256Of(run.fetched) === run.dto.sha256, "the downloaded bytes' sha256 must equal the DTO's");
  assert(run.fetched.subarray(0, 5).toString("latin1") === "%PDF-", "the downloaded bytes must start with %PDF-");
}

/** R-3: the filename is server-generated from the period and the format. */
export async function adminSaveNamesTheFileFromThePeriod(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAdminSave(fx, "pdf");
  const expected = `energy-consumption-${PERIOD.startDate}-to-${PERIOD.endDate}.pdf`;
  assert(run.dto.filename === expected, `the filename must be ${expected}; got ${run.dto.filename}`);
}

/** The XLSX save carries the sheet content type. */
export async function adminSavesAnXlsxWithTheSheetContentType(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAdminSave(fx, "xlsx");
  assert(
    run.dto.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `contentType must be the xlsx type; got ${run.dto.contentType}`,
  );
}

/** …and the object is the zip the row describes (`PK`, length, sha256). */
export async function adminSavePutsTheXlsxTheRowDescribes(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAdminSave(fx, "xlsx");
  assert(
    run.head !== null && run.head.contentLength === run.dto.byteSize,
    `headObject must answer the row's byteSize ${run.dto.byteSize}; got ${String(run.head?.contentLength)}`,
  );
  assert(sha256Of(run.fetched) === run.dto.sha256, "the downloaded bytes' sha256 must equal the DTO's");
  assert(run.fetched.subarray(0, 2).toString("latin1") === "PK", "the downloaded bytes must start with PK");
}

// ---------------------------------------------------------------------------
// Row 3 — the location admin's stamp and render scope
// ---------------------------------------------------------------------------

type LocationAdminRun = {
  readonly stored: StoredColumns;
  /** `readableAssetIdsInOrganization(wc-admin, ESKOM)` — what the render was bounded by. */
  readonly scoped: readonly string[];
  /** The seeded assets of RSMOC-WC, read **after** `scoped` so a concurrent fixture commit lands in this set only. */
  readonly wcAssets: ReadonlySet<string>;
  readonly topConsumerAssetIds: readonly string[];
};

/**
 * `wc-admin` (one organization, one location) saves without a body id. The
 * render scope is asserted through `readableAssetIdsInOrganization` and
 * `ReportsService.energyPreview` with the same ids — the cheaper gate; the
 * PDF bytes are not re-rendered for identity because `generatedAt` differs.
 */
async function runLocationAdminSave(fx: ReportFileIntegrationFixtures): Promise<LocationAdminRun> {
  const recorder = recordingClient(fx);
  const svc = service(fx, recorder.client);
  const dto = await svc.saveOnDemand(wcAdmin(), { ...PERIOD, format: "pdf" });
  fx.createdFileIds.push(dto.id);
  try {
    const stored = await readStoredColumns(fx.fleetDb, dto.id);
    assert(stored !== null, "the positive control failed: the fleet read found no row for the location admin's file");
    const scoped = await fx.accessControl.readableAssetIdsInOrganization(wcAdmin(), fx.eskomId);
    const wcAssets = await fx.assetIdsOfLocation(fx.wcId);
    const preview = await fx.reports.energyPreview({ ...PERIOD }, [...scoped]);
    return {
      stored: stored as StoredColumns,
      scoped,
      wcAssets,
      topConsumerAssetIds: preview.topConsumers.map((row) => row.assetId),
    };
  } finally {
    await discard(fx, dto.id, recorder.putKeys[0] ?? null);
  }
}

/** Amendment 1 item 1: a one-organization location admin needs no body id; the row lands in ESKOM. */
export async function locationAdminSavesIntoItsOwnOrganization(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runLocationAdminSave(fx);
  assert(run.stored.organization_id === fx.eskomId, `the row must belong to ESKOM; got ${run.stored.organization_id}`);
}

/** Amendment 1 item 2: the stamp is exactly `{RSMOC-WC}`. */
export async function locationAdminStampsItsLocation(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runLocationAdminSave(fx);
  assert(
    JSON.stringify(run.stored.location_ids) === JSON.stringify([fx.wcId]),
    `location_ids must be exactly [RSMOC-WC]; stored ${JSON.stringify(run.stored.location_ids)}`,
  );
}

/** Amendment 1 item 1: the render scope, and the preview it yields, carry no asset outside RSMOC-WC. */
export async function locationAdminRendersUnderItsLocationsAssets(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runLocationAdminSave(fx);
  assert(run.scoped.length > 0, "the positive control failed: wc-admin's ESKOM render scope is empty");
  const outside = run.scoped.filter((id) => !run.wcAssets.has(id));
  assert(outside.length === 0, `the render scope carries ${outside.length} asset(s) outside RSMOC-WC`);
  const foreign = run.topConsumerAssetIds.filter((id) => !run.wcAssets.has(id));
  assert(foreign.length === 0, `the preview's top consumers carry ${foreign.length} asset(s) outside RSMOC-WC`);
}

// ---------------------------------------------------------------------------
// Rows 4, 4b — refusals before any write
// ---------------------------------------------------------------------------

type RefusedSaveRun = {
  readonly err: unknown;
  readonly countBefore: number;
  readonly countAfter: number;
  readonly calls: readonly string[];
};

async function runRefusedSave(
  fx: ReportFileIntegrationFixtures,
  jwt: JwtPayload,
  organizationId: string | undefined,
  countedOrganization: string,
): Promise<RefusedSaveRun> {
  const recorder = recordingClient(fx);
  const svc = service(fx, recorder.client);
  const countBefore = await countFilesForOrganization(fx.fleetDb, countedOrganization);
  const err = await captureRejection(() =>
    svc.saveOnDemand(
      jwt,
      organizationId === undefined ? { ...PERIOD, format: "pdf" } : { ...PERIOD, format: "pdf", organizationId },
    ),
  );
  return {
    err,
    countBefore,
    countAfter: await countFilesForOrganization(fx.fleetDb, countedOrganization),
    calls: recorder.calls,
  };
}

/** Decision 6: `wc-hvac-admin` is refused by `assertMasterDataRole`, with its sentence. */
export async function assetGroupAdminIsRefusedWith403(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runRefusedSave(fx, wcHvacAdmin(), undefined, fx.eskomId);
  assert(errorName(run.err) === "ForbiddenException", `expected ForbiddenException; got ${errorName(run.err)}`);
  assert(errorMessage(run.err) === MASTER_DATA_SENTENCE, `expected the master-data sentence; got: ${errorMessage(run.err)}`);
}

/**
 * …and before any write: no row created by that user exists afterwards and no
 * S3 call was made. The count is by creator, not organization-wide — the
 * lifecycle wrapper commits ESKOM rows in parallel with this one.
 */
export async function assetGroupAdminsRefusalWritesNothing(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runRefusedSave(fx, wcHvacAdmin(), undefined, fx.eskomId);
  const result = await fx.fleetDb.execute<{ n: string }>(
    sql`select count(*)::text as n from bms.report_files
         where created_by = (select id from bms.users where email = ${SEEDED.assetGroupAdmin})`,
  );
  const byHvac = Number(result.rows[0]?.n ?? "-1");
  assert(byHvac === 0, `rows created by ${SEEDED.assetGroupAdmin} exist: ${byHvac}`);
  assert(run.calls.length === 0, `the refused save must make no S3 call; calls: ${run.calls.join(", ")}`);
}

/** U8's flagged claim: a global admin naming an organization that does not exist is 404. */
export async function globalAdminNamingAnUnknownOrganizationIs404(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runRefusedSave(fx, admin(), randomUUID(), fx.eskomId);
  assert(errorName(run.err) === "NotFoundException", `expected NotFoundException; got ${errorName(run.err)}`);
}

/** …with no row under the unknown id and no object put. */
export async function theUnknownOrganizationRefusalWritesNothing(fx: ReportFileIntegrationFixtures): Promise<void> {
  const unknown = randomUUID();
  const run = await runRefusedSave(fx, admin(), unknown, unknown);
  assert(run.countBefore === 0 && run.countAfter === 0, `rows appeared under a random uuid: ${run.countAfter}`);
  assert(run.calls.length === 0, `the refused save must make no S3 call; calls: ${run.calls.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Rows 5, 6, 6b — who lists and downloads what (decision 6)
// ---------------------------------------------------------------------------

type ListRun = {
  readonly adminFileId: string;
  readonly wcFileId: string;
  readonly adminList: readonly string[];
  readonly pheList: readonly string[];
  readonly wcList: readonly string[];
  readonly pheDownload: unknown;
  readonly wcDownloadOfAdminFile: unknown;
  readonly wcScopeOrganizationCount: number;
};

/**
 * Two files in ESKOM: the admin's `{}` and wc-admin's `{RSMOC-WC}`. Then the
 * three roles list, and the two non-global roles ask for the admin's file.
 * Every list assertion is by id containment, never by length.
 */
async function runListMatrix(fx: ReportFileIntegrationFixtures): Promise<ListRun> {
  const recorder = recordingClient(fx);
  const svc = service(fx, recorder.client);
  const adminFile = await saveAsAdmin(fx, svc);
  let wcFile: ReportFileDto | null = null;
  try {
    wcFile = await svc.saveOnDemand(wcAdmin(), { ...PERIOD, format: "pdf" });
    fx.createdFileIds.push(wcFile.id);
    const ids = (rows: ReportFileDto[]): string[] => rows.map((row) => row.id);
    const scope = await fx.accessControl.reportFileReadScope(wcAdmin());
    return {
      adminFileId: adminFile.id,
      wcFileId: wcFile.id,
      adminList: ids(await svc.list(admin(), 200)),
      pheList: ids(await svc.list(pheAdmin(), 200)),
      wcList: ids(await svc.list(wcAdmin(), 200)),
      pheDownload: await captureRejection(() => svc.download(pheAdmin(), adminFile.id)),
      wcDownloadOfAdminFile: await captureRejection(() => svc.download(wcAdmin(), adminFile.id)),
      wcScopeOrganizationCount: scope.kind === "global" ? -1 : scope.organizationIds.length,
    };
  } finally {
    await discard(fx, adminFile.id, recorder.putKeys[0] ?? null);
    if (wcFile !== null) {
      await discard(fx, wcFile.id, recorder.putKeys[1] ?? null);
    }
  }
}

/** `phe-admin` (PHEWB) does not list ESKOM's file — with the control that the admin does. */
export async function organizationAdminOfAnotherOrganizationCannotList(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runListMatrix(fx);
  assert(run.adminList.includes(run.adminFileId), "the positive control failed: the admin's list lacks its own file");
  assert(!run.pheList.includes(run.adminFileId), "phe-admin's list must not contain ESKOM's file");
}

/** …and its download is the 403 of Amendment 1 item 3, with the one sentence. */
export async function organizationAdminOfAnotherOrganizationCannotDownload(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runListMatrix(fx);
  assert(errorName(run.pheDownload) === "ForbiddenException", `expected ForbiddenException; got ${errorName(run.pheDownload)}`);
  assert(
    errorMessage(run.pheDownload) === OUT_OF_SCOPE_SENTENCE,
    `expected "${OUT_OF_SCOPE_SENTENCE}"; got: ${errorMessage(run.pheDownload)}`,
  );
}

/** `wc-admin` lists its own `{RSMOC-WC}` file and not the admin's `{}` file; the admin lists both. */
export async function locationAdminListsOnlyCoveredFiles(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runListMatrix(fx);
  assert(run.adminList.includes(run.wcFileId), "the positive control failed: the admin's list lacks wc-admin's file");
  assert(run.wcList.includes(run.wcFileId), "wc-admin's list must contain its own file");
  assert(!run.wcList.includes(run.adminFileId), "wc-admin's list must not contain the admin's '{}' file");
}

/**
 * U8's flagged claim, about the **branch** rather than the outcome: `wc-admin`
 * holds exactly one organization, so `withOrganizationReadScope` takes the
 * tenant branch with a `null` filter — and the location predicate must apply
 * there too, or the `{}` file leaks through the tenant policy that admits it.
 */
export async function theTenantBranchStillAppliesTheLocationPredicate(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runListMatrix(fx);
  assert(
    run.wcScopeOrganizationCount === 1,
    `the positive control failed: wc-admin holds ${run.wcScopeOrganizationCount} organizations, not the one the tenant branch needs`,
  );
  assert(!run.wcList.includes(run.adminFileId), "on the tenant branch, wc-admin's list must still exclude the '{}' file");
}

/** The row verdict agrees with the list: `wc-admin`'s download of the `{}` file is 403. */
export async function locationAdminCannotDownloadTheWholeOrganizationFile(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runListMatrix(fx);
  assert(
    errorName(run.wcDownloadOfAdminFile) === "ForbiddenException",
    `wc-admin's download of the '{}' file must be 403; got ${errorName(run.wcDownloadOfAdminFile)}`,
  );
  assert(
    errorMessage(run.wcDownloadOfAdminFile) === OUT_OF_SCOPE_SENTENCE,
    `expected "${OUT_OF_SCOPE_SENTENCE}"; got: ${errorMessage(run.wcDownloadOfAdminFile)}`,
  );
}

// ---------------------------------------------------------------------------
// The lifecycle, shared by both wrappers
// ---------------------------------------------------------------------------

/**
 * The one lifecycle the two wrappers share (`report-files.integration.test.ts`
 * and `report-files-lifecycle.integration.test.ts`; `tests/repo-invariants.test.ts`
 * wants one wrapper per spec). It lives in this spec rather than in a
 * runtime module because a non-spec file may not import `src/testing/` (the
 * same fence), and U6's `loadReportFileFixtures` is the precedent for a spec
 * exporting its loader. The two wrappers run in parallel on the same
 * database, so every count a row makes is scoped to ids this run created.
 * Pools, seeded ids, the storage client and the sweep live here so the two
 * wrappers cannot drift on what "clean" means.
 *
 * **Fixtures by code.** `ESKOM`, `PHEWB` and `RSMOC-WC` are resolved by
 * `code` with an exact-count check, the seeded admin by email — never a uuid
 * literal, never `LIMIT 1`. `bms.report_files` references no asset, so no
 * fixture asset is created.
 *
 * **The sweep is bounded by this run's own ids.** `close` deletes, as
 * `bms_fleet`, the `bms.report_files` and `bms.audit_log` rows whose id is in
 * `fx.createdFileIds`, and the objects whose key is in `fx.putKeys` — so a
 * row that failed between its save and its `finally` still leaves nothing,
 * and a concurrent run's rows are never touched (`bms.audit_log` has no
 * cascade from `bms.report_files`).
 *
 * `ReportsService` takes `NO_TARIFFS` (the `reports.service.rls.integration`
 * shape): nothing here asserts on cost. `AccessControlService` is built on
 * one fleet handle passed twice, as U6's suite does — the rows prove scope,
 * and `bms_fleet`'s `BYPASSRLS` is transparent for the grant walk.
 */

const NO_TARIFFS = { resolveForAssets: async () => new Map<string, number>() };

async function idByCode(pool: pg.Pool, table: "organizations" | "locations", code: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.${table} WHERE code = $1`, [code]);
  const id = rows[0]?.id;
  if (!id || rows.length !== 1) {
    throw new Error(
      `F3.5a: expected exactly one bms.${table} row with code ${code}, found ${rows.length} — run pnpm db:seed`,
    );
  }
  return id;
}

export type OpenReportFileFixtures = {
  readonly fx: ReportFileIntegrationFixtures;
  /** The sweep and the pool close; safe to call once, after every row ran. */
  readonly close: () => Promise<void>;
};

export async function openReportFileFixtures(
  connectionString: string,
  config: ConfiguredStorageConfig,
  label: string,
): Promise<OpenReportFileFixtures> {
  const fleetPool = await openIntegrationPool(connectionString, label); // fleet (BYPASSRLS) by default
  const tenantPool = await openIntegrationPool(
    process.env.DATABASE_URL_TENANT ?? asRole(connectionString, "bms_tenant", "bms_tenant_dev"),
    label,
  );
  const fleetDb = createDb(fleetPool);
  const tenantDb = createDb(tenantPool);

  await assertFixturesPresent(fleetPool);
  const [eskomId, phewbId, wcId] = await Promise.all([
    idByCode(fleetPool, "organizations", "ESKOM"),
    idByCode(fleetPool, "organizations", "PHEWB"),
    idByCode(fleetPool, "locations", "RSMOC-WC"),
  ]);
  const { rows: adminRows } = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.users WHERE email = $1`, [
    SEEDED.globalAdmin,
  ]);
  const adminUserId = adminRows[0]?.id;
  if (!adminUserId) {
    throw new Error(`F3.5a: ${SEEDED.globalAdmin} is missing — run pnpm db:seed`);
  }

  const client = createStorageClient(config, {
    createOps: () => createAwsS3Ops(config),
    logger: new Logger(`${label} report files integration`),
  });
  await ensureBucket(client);

  const fx: ReportFileIntegrationFixtures = {
    client,
    fleetDb,
    tenantDb,
    accessControl: new AccessControlService(fleetDb, fleetDb),
    reports: new ReportsService(fleetPool, NO_TARIFFS),
    eskomId,
    phewbId,
    wcId,
    adminUserId,
    // Seed rows nothing writes to; read at call time so a fixture asset a
    // concurrent suite commits in RSMOC-WC cannot sit between the read and
    // the render scope it is compared with.
    assetIdsOfLocation: async (locationId) => {
      const { rows } = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE location_id = $1`, [
        locationId,
      ]);
      return new Set(rows.map((row) => row.id));
    },
    createdFileIds: [],
    putKeys: [],
  };

  const close = async (): Promise<void> => {
    if (fx.createdFileIds.length > 0) {
      await fleetPool.query(
        `DELETE FROM bms.audit_log WHERE entity_type = 'report_file' AND entity_id = ANY($1::uuid[])`,
        [fx.createdFileIds],
      );
      await fleetPool.query(`DELETE FROM bms.report_files WHERE id = ANY($1::uuid[])`, [fx.createdFileIds]);
    }
    if (fx.client.kind === "configured") {
      const { bucket, ops } = fx.client;
      await Promise.allSettled(fx.putKeys.map((key) => ops.deleteObject(bucket, key)));
    }
    await Promise.all([fleetPool, tenantPool].map((p) => p.end()));
  };

  return { fx, close };
}
