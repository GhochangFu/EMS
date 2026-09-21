import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import { sql } from "drizzle-orm";

import { notificationChannels } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { withTenant } from "../database/tenant-context";
import { ChannelsService } from "../notifications/channels.service";
import { EmailTransport, type MailSender } from "../notifications/email.transport";
import { buildConfig } from "../notifications/notifications.config";
import { MetricsService } from "../observability/metrics.service";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import { getObject, headObject, type S3Ops, type StorageClient } from "../storage/storage-client";
import type { ConfiguredStorageConfig } from "../testing/integration-storage-gate";
import type { ReportFilesConfig } from "./report-files-config";
import {
  assert,
  captureRejection,
  errorMessage,
  openReportFileFixtures,
  sha256Of,
  type ReportFileIntegrationFixtures,
} from "./report-files.integration.spec";
import {
  CHANNEL_UNAVAILABLE_SENTENCE,
  NO_CHANNEL_SENTENCE,
  ReportRenderService,
  ceilingSentence,
  sendFailedSentence,
  type RenderOutcome,
  type RenderPayload,
} from "./report-render.service";

/**
 * `F3.5b` U10 (ADR 0071 decisions 8, 9, 10; plan R-9, R-11) — the render job
 * against a real S3 endpoint and a real database: what
 * `report-render.service.spec.ts`'s fakes cannot tell you. Whether the
 * `0078` policy really hides a foreign schedule from the render's `tx`,
 * whether the partial unique index and the `delivery_status = 'none'`
 * predicate make a retry idempotent against committed rows, whether the
 * prune's `OFFSET` really deletes the oldest period's rows *and* its objects,
 * whether the bytes nodemailer would receive are the bytes in the bucket,
 * and whether a foreign channel row — admitted by the FK — reads as absent
 * under the tenant policy.
 *
 * **These rows commit by design.** Phase B/C read the rows phase A wrote
 * *after* the transaction that wrote them, so `withRollback` cannot hold
 * them (the F3.5b plan §3 Unit 10 ruling). Every schedule is therefore
 * named `f3.5b-render-<randomUUID()>`, every channel `f35b-render-<…>`, and
 * `afterAll` deletes as `bms_fleet` — by id, never by prefix — the report
 * files of this run's schedules, the schedules, the audit rows naming those
 * file ids (there should be none: the job writes no audit row), the
 * channels, and the objects by key, asserting each delete count. Files go
 * before schedules: `report_files_schedule_id_fkey` has no `ON DELETE`
 * (plan Q-2's `RESTRICT`).
 *
 * **No `tx.rollback()` in this file, and no read of `bms.assets`.** The
 * first would put it in scope of `tests/integration-fixture-isolation.test.ts`'s
 * rollback scan; the location-scope expectation comes through
 * `fx.assetIdsOfLocation` (F3.5a's technique), read after the render.
 *
 * **Two connections, two jobs (the F3.5a shape).** `bms_fleet` is
 * `BYPASSRLS`: it inserts the fixtures, counts and sweeps, and proves nothing
 * about the policy. The service's phase A runs through
 * `withTenant(tenantDb, payload.organizationId, …)` on a real `bms_tenant`
 * connection — and the foreign-schedule row passes the *payload's* (PHEWB)
 * organization, not the schedule's, which is the whole claim. Every count is
 * scoped to a schedule id this run made; a fleet-wide count would also see
 * another suite's rows.
 *
 * **One `MetricsService`, shared.** Its constructor starts
 * `collectDefaultMetrics`; one per row would leave observers running. The
 * counters row reads a series *before and after* one run and asserts a
 * delta of +1 — never a lifetime value, because every earlier row in this
 * file moved the same counters.
 *
 * **The channel fixtures carry no secret.** `toChannelRow` returns at
 * `secretCiphertext === null` with `secretState: "none"`, and
 * `EmailTransport` reads recipients from `config.to`, so the delivery rows
 * do not depend on whether `CREDENTIAL_ENCRYPTION_KEY` is set in the shell.
 * A real `ChannelsService` and `CredentialCryptoService` are still what the
 * service is built with — the null branch is the one taken.
 *
 * **`aFailedFinishLeavesRowsAtNoneForTheRetry` fails phase B through the
 * object store, not the sender.** The plan words it "the sender throws
 * once", but `EmailTransport.send` catches a sender throw and *returns*
 * `failed` — that lands `delivery_status = 'failed'` (the claim
 * `aSenderFailureLandsTheCountsOnlySentence` owns), and a re-run then finds
 * no row at `none`. The only throws that leave rows at `none` are the ones
 * before phase C: the read-back (`getObject`) and the preview. So the row
 * wraps the client with a `getObject` that throws once — MinIO unreachable
 * between the commit and the mail, the failure R-9's "a job that failed in
 * phase B re-delivers without re-rendering" describes.
 */

export type RenderIntegrationFixtures = {
  readonly base: ReportFileIntegrationFixtures;
  readonly metrics: MetricsService;
  readonly channels: ChannelsService;
  /** Every schedule this run inserted, deleted in `afterAll` (minus `deletedScheduleIds`). */
  readonly scheduleIds: string[];
  /** Schedules a row deleted itself (`aDeletedScheduleWritesNoRow`); excluded from the sweep's expected count. */
  readonly deletedScheduleIds: string[];
  /** Every channel this run inserted, deleted in `afterAll`. */
  readonly channelIds: string[];
};

export type OpenRenderFixtures = {
  readonly fx: RenderIntegrationFixtures;
  /** The id-bounded sweep with its count assertions, then the pool close. */
  readonly close: () => Promise<void>;
};

export const PERIOD_1 = { periodStart: "2026-09-01", periodEnd: "2026-09-07" } as const;
export const PERIOD_2 = { periodStart: "2026-09-08", periodEnd: "2026-09-14" } as const;
export const PERIOD_3 = { periodStart: "2026-09-15", periodEnd: "2026-09-21" } as const;

const RECIPIENT = "f3.5b@example.test";

const DEFAULT_CONFIG: ReportFilesConfig = {
  onDemandCap: 50,
  retentionPerSchedule: 24,
  emailMaxBytes: 10_485_760,
  historyUrl: null,
};

export async function openRenderFixtures(
  connectionString: string,
  config: ConfiguredStorageConfig,
  label: string,
): Promise<OpenRenderFixtures> {
  const opened = await openReportFileFixtures(connectionString, config, label);
  const base = opened.fx;
  const fx: RenderIntegrationFixtures = {
    base,
    metrics: new MetricsService(),
    channels: new ChannelsService(base.fleetDb, base.tenantDb, new CredentialCryptoService(), base.accessControl),
    scheduleIds: [],
    deletedScheduleIds: [],
    channelIds: [],
  };

  const close = async (): Promise<void> => {
    const failures: string[] = [];
    try {
      const fleet = base.fleetDb;
      const scheduleIds = fx.scheduleIds;
      if (scheduleIds.length > 0) {
        const files = await fleet.execute<{ id: string; object_key: string }>(
          sql`select id::text as id, object_key from bms.report_files where schedule_id = any(${pgArray(scheduleIds)}::uuid[])`,
        );
        const fileIds = files.rows.map((row) => row.id);
        const keys = files.rows.map((row) => row.object_key);
        if (fileIds.length > 0) {
          const audit = await fleet.execute(
            sql`delete from bms.audit_log where entity_type = 'report_file' and entity_id = any(${pgArray(fileIds)}::uuid[])`,
          );
          if (audit.rowCount !== 0) {
            failures.push(`expected the render job to write no audit row; the sweep deleted ${audit.rowCount}`);
          }
          const deletedFiles = await fleet.execute(sql`delete from bms.report_files where id = any(${pgArray(fileIds)}::uuid[])`);
          if (deletedFiles.rowCount !== fileIds.length) {
            failures.push(`expected the sweep to delete ${fileIds.length} report file row(s), got ${deletedFiles.rowCount}`);
          }
        }
        const deletedSchedules = await fleet.execute(
          sql`delete from bms.report_schedules where id = any(${pgArray(scheduleIds)}::uuid[])`,
        );
        const expectedSchedules = scheduleIds.length - fx.deletedScheduleIds.length;
        if (deletedSchedules.rowCount !== expectedSchedules) {
          failures.push(`expected the sweep to delete ${expectedSchedules} schedule row(s), got ${deletedSchedules.rowCount}`);
        }
        if (base.client.kind === "configured") {
          const { bucket, ops } = base.client;
          const results = await Promise.allSettled(keys.map((key) => ops.deleteObject(bucket, key)));
          const refused = results.filter((r) => r.status === "rejected").length;
          if (refused > 0) {
            failures.push(`the sweep could not delete ${refused} of ${keys.length} object(s)`);
          }
          for (const key of keys) {
            if ((await ops.headObject(bucket, key)) !== null) {
              failures.push("an object of this run is still in the bucket after the sweep");
            }
          }
        }
      }
      if (fx.channelIds.length > 0) {
        const deletedChannels = await fleet.execute(
          sql`delete from bms.notification_channels where id = any(${pgArray(fx.channelIds)}::uuid[])`,
        );
        if (deletedChannels.rowCount !== fx.channelIds.length) {
          failures.push(`expected the sweep to delete ${fx.channelIds.length} channel row(s), got ${deletedChannels.rowCount}`);
        }
      }
    } finally {
      await opened.close();
    }
    if (failures.length > 0) {
      throw new Error(`F3.5b render sweep: ${failures.join("; ")}`);
    }
  };

  return { fx, close };
}

// ---------------------------------------------------------------------------
// Fixtures: schedules, channels, the service factory, the fleet reads
// ---------------------------------------------------------------------------

type ScheduleOptions = {
  organizationId?: string;
  formats?: readonly ("pdf" | "xlsx")[];
  locationIds?: readonly string[];
  channelId?: string | null;
  enabled?: boolean;
};

/**
 * A Postgres array literal for one bound parameter. A JS array inside a
 * drizzle `sql` template expands to `($1, $2)` — a row constructor, not an
 * array (the U8 measurement) — so the arrays here are bound as text and cast.
 */
function pgArray(values: readonly string[]): string {
  return `{${values.join(",")}}`;
}

/** One committed schedule as `bms_fleet`, named `f3.5b-render-<id>`; recorded for the sweep. */
export async function insertSchedule(fx: RenderIntegrationFixtures, options: ScheduleOptions = {}): Promise<string> {
  const id = randomUUID();
  const organizationId = options.organizationId ?? fx.base.eskomId;
  const formats = pgArray(options.formats ?? ["pdf"]);
  const locationIds = pgArray(options.locationIds ?? []);
  const channelId = options.channelId ?? null;
  const enabled = options.enabled ?? true;
  await fx.base.fleetDb.execute(sql`
    insert into bms.report_schedules
      (id, organization_id, name, template_id, formats, cadence, run_at_local, timezone, location_ids, channel_id, enabled, next_run_at)
    values
      (${id}, ${organizationId}, ${`f3.5b-render-${id}`}, 'energy_consumption', ${formats}::text[], 'daily', '00:30:00',
       'Asia/Kolkata', ${locationIds}::uuid[], ${channelId}, ${enabled}, now())
  `);
  fx.scheduleIds.push(id);
  return id;
}

/** One committed channel as `bms_fleet` with no secret; recorded for the sweep. */
export async function insertChannel(
  fx: RenderIntegrationFixtures,
  options: { organizationId?: string; kind?: "email" | "webhook"; config?: Record<string, unknown>; enabled?: boolean } = {},
): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const [row] = await fx.base.fleetDb
    .insert(notificationChannels)
    .values({
      organizationId: options.organizationId ?? fx.base.eskomId,
      code: `f35b-render-${suffix}`,
      name: `f3.5b-render-${suffix}`,
      kind: options.kind ?? "email",
      config: options.config ?? { to: [RECIPIENT] },
      enabled: options.enabled ?? true,
    })
    .returning({ id: notificationChannels.id });
  assert(row !== undefined, "the positive control failed: the channel insert returned no id");
  fx.channelIds.push(row.id);
  return row.id;
}

export type SentMail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
};

/** A sender that records, or rejects with `fail` every time. */
export function fakeSender(fail?: Error): { sender: MailSender; sent: SentMail[] } {
  const sent: SentMail[] = [];
  return {
    sent,
    sender: {
      sendMail: (options: SentMail) => {
        if (fail) return Promise.reject(fail);
        sent.push(options);
        return Promise.resolve({ messageId: "fake" });
      },
    },
  };
}

/** What the probe wrapper makes `getObject` throw. A name, so §9.6 holds. */
class GetProbeError extends Error {
  override readonly name = "GetProbeError";
}

/** The real client with a `getObject` that throws once, then behaves. */
function clientFailingOneGet(base: StorageClient): StorageClient {
  if (base.kind !== "configured") {
    throw new Error("the integration client must be configured — the storage gate returned no config");
  }
  let remaining = 1;
  const ops: S3Ops = {
    ...base.ops,
    getObject: (bucket, key) => {
      if (remaining > 0) {
        remaining -= 1;
        return Promise.reject(new GetProbeError("probe: the object read was refused"));
      }
      return base.ops.getObject(bucket, key);
    },
  };
  return { kind: "configured", bucket: base.bucket, ops };
}

type ServiceOptions = {
  config?: Partial<ReportFilesConfig>;
  client?: StorageClient;
  sender?: MailSender;
};

/** The real service over the real client, a fake sender and the shared metrics. */
export function service(
  fx: RenderIntegrationFixtures,
  options: ServiceOptions = {},
): { svc: ReportRenderService; sent: SentMail[] } {
  const fake = fakeSender();
  const email = new EmailTransport({
    config: buildConfig({ SMTP_HOST: "mailpit", SMTP_PORT: "1025", SMTP_FROM: "trinetra@example.test" }),
    sender: options.sender ?? fake.sender,
  });
  const svc = new ReportRenderService(
    fx.base.tenantDb,
    options.client ?? fx.base.client,
    { ...DEFAULT_CONFIG, ...options.config },
    fx.base.reports,
    email,
    fx.metrics,
    fx.channels,
  );
  return { svc, sent: fake.sent };
}

export function payloadFor(
  scheduleId: string,
  period: { periodStart: string; periodEnd: string } = PERIOD_1,
  organizationId?: string,
): RenderPayload {
  return { organizationId: organizationId ?? "", scheduleId, ...period };
}

/** Phase A on a real tenant transaction under the payload's organization, then phases B/C. */
export async function run(fx: RenderIntegrationFixtures, svc: ReportRenderService, payload: RenderPayload): Promise<RenderOutcome> {
  const outcome = await withTenant(fx.base.tenantDb, payload.organizationId, (tx) => svc.render(payload, tx));
  await svc.finish(outcome);
  return outcome;
}

export type FileRow = {
  readonly id: string;
  readonly format: string;
  readonly object_key: string;
  readonly byte_size: number;
  readonly sha256: string;
  readonly filename: string;
  readonly period_end: string;
  readonly delivery_status: string;
  readonly delivery_error: string | null;
  readonly created_by: string | null;
  readonly location_ids: string[];
  readonly schedule_id: string | null;
};

/** This schedule's rows as `bms_fleet`, in format order. */
export async function readFileRows(db: BmsDb, scheduleId: string): Promise<FileRow[]> {
  const result = await db.execute<FileRow>(sql`
    select id::text as id, format, object_key, byte_size, sha256, filename, period_end::text as period_end,
           delivery_status, delivery_error, created_by::text as created_by, location_ids, schedule_id::text as schedule_id
      from bms.report_files
     where schedule_id = ${scheduleId}::uuid
     order by format, period_end
  `);
  return result.rows;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

/** The object's bytes, or a failure naming the file id. */
async function fetchObject(client: StorageClient, row: FileRow): Promise<Buffer> {
  const object = await getObject(client, row.object_key);
  assert(object !== null, `the positive control failed: file ${row.id} has no object in the bucket`);
  return collect((object as { body: Readable }).body);
}

function rendered(outcome: RenderOutcome): Extract<RenderOutcome, { kind: "rendered" }> {
  assert(outcome.kind === "rendered", `expected a rendered outcome, got ${JSON.stringify(outcome)}`);
  return outcome as Extract<RenderOutcome, { kind: "rendered" }>;
}

// ---------------------------------------------------------------------------
// Phase A — the rows and objects a whole-organization schedule writes
// ---------------------------------------------------------------------------

/** Both formats: two rows stamped with the schedule, no author, `{}`; each object's length and hash equal the row's. */
export async function rendersBothFormatsForAWholeOrganizationSchedule(fx: RenderIntegrationFixtures): Promise<void> {
  const scheduleId = await insertSchedule(fx, { formats: ["pdf", "xlsx"] });
  const { svc } = service(fx);
  const outcome = rendered(await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId)));
  assert(outcome.written === 2 && outcome.skippedExisting === 0, `expected written=2 skippedExisting=0; got ${outcome.written}/${outcome.skippedExisting}`);

  const rows = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(rows.map((r) => r.format).join(",") === "pdf,xlsx", `expected one pdf and one xlsx row; got ${rows.map((r) => r.format).join(",")}`);
  for (const row of rows) {
    assert(row.schedule_id === scheduleId, `row ${row.id} must carry the schedule id`);
    assert(row.created_by === null, `row ${row.id} must have created_by NULL (a schedule runs as the system); got ${String(row.created_by)}`);
    assert(Array.isArray(row.location_ids) && row.location_ids.length === 0, `row ${row.id} must copy location_ids '{}'`);
    const head = await headObject(fx.base.client, row.object_key);
    assert(head !== null && head.contentLength === row.byte_size, `object of ${row.id}: contentLength ${String(head?.contentLength)} must equal byte_size ${row.byte_size}`);
    const bytes = await fetchObject(fx.base.client, row);
    assert(sha256Of(bytes) === row.sha256, `object of ${row.id}: the SHA-256 of the object must equal the row's`);
  }
}

/** Decision 9: with the xlsx row and object gone, a re-run writes one xlsx and leaves the pdf row's id alone. */
export async function aRetrySkipsTheExistingFormatAndRendersTheMissingOne(fx: RenderIntegrationFixtures): Promise<void> {
  const scheduleId = await insertSchedule(fx, { formats: ["pdf", "xlsx"] });
  const { svc } = service(fx);
  await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  const first = await readFileRows(fx.base.fleetDb, scheduleId);
  const pdf = first.find((r) => r.format === "pdf");
  const xlsx = first.find((r) => r.format === "xlsx");
  assert(pdf !== undefined && xlsx !== undefined, "the positive control failed: the first run did not write both rows");

  await fx.base.fleetDb.execute(sql`delete from bms.report_files where id = ${xlsx!.id}::uuid`);
  if (fx.base.client.kind === "configured") {
    await fx.base.client.ops.deleteObject(fx.base.client.bucket, xlsx!.object_key);
  }

  const outcome = rendered(await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId)));
  assert(outcome.written === 1 && outcome.skippedExisting === 1, `expected written=1 skippedExisting=1; got ${outcome.written}/${outcome.skippedExisting}`);
  const second = await readFileRows(fx.base.fleetDb, scheduleId);
  const pdfAgain = second.find((r) => r.format === "pdf");
  const xlsxAgain = second.find((r) => r.format === "xlsx");
  assert(second.length === 2, `expected two rows after the retry; got ${second.length}`);
  assert(pdfAgain?.id === pdf!.id, `the pdf row's id must be unchanged; was ${pdf!.id}, now ${String(pdfAgain?.id)}`);
  assert(xlsxAgain !== undefined && xlsxAgain.id !== xlsx!.id, "the xlsx row must be a new row");
}

/** `location_ids = {WC}`: the asset scope the renderer received is a non-empty subset of RSMOC-WC's seeded assets. */
export async function aLocationScopedScheduleReadsOnlyItsAssets(fx: RenderIntegrationFixtures): Promise<void> {
  const scheduleId = await insertSchedule(fx, { locationIds: [fx.base.wcId] });
  const { svc } = service(fx);
  const outcome = rendered(await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId)));
  // Read after the render, so a fixture asset a concurrent suite commits in
  // RSMOC-WC lands in the expectation only and the ⊆ still holds.
  const wcAssets = await fx.base.assetIdsOfLocation(fx.base.wcId);
  assert(outcome.assetIds.length > 0, "the positive control failed: the location-scoped render resolved no asset");
  const foreign = outcome.assetIds.filter((id) => !wcAssets.has(id));
  assert(foreign.length === 0, `the render must read only RSMOC-WC's assets; ${foreign.length} of ${outcome.assetIds.length} are outside it`);
  const [row] = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(row !== undefined && row.location_ids.length === 1 && row.location_ids[0] === fx.base.wcId, "the row must copy the schedule's location_ids");
}

/** `0078`: an ESKOM schedule rendered under PHEWB's GUC is absent — `skipped/absent`, zero rows. */
export async function theTenantPolicyHidesAForeignSchedule(fx: RenderIntegrationFixtures): Promise<void> {
  const scheduleId = await insertSchedule(fx);
  const { svc } = service(fx);
  const outcome = await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.phewbId));
  assert(outcome.kind === "skipped" && outcome.reason === "absent", `expected skipped/absent; got ${JSON.stringify(outcome)}`);
  const rows = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(rows.length === 0, `a foreign schedule must write no row; found ${rows.length}`);
}

export async function aDisabledScheduleWritesNoRow(fx: RenderIntegrationFixtures): Promise<void> {
  const scheduleId = await insertSchedule(fx, { enabled: false });
  const { svc } = service(fx);
  const outcome = await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  assert(outcome.kind === "skipped" && outcome.reason === "disabled", `expected skipped/disabled; got ${JSON.stringify(outcome)}`);
  const rows = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(rows.length === 0, `a disabled schedule must write no row; found ${rows.length}`);
}

export async function aDeletedScheduleWritesNoRow(fx: RenderIntegrationFixtures): Promise<void> {
  const scheduleId = await insertSchedule(fx);
  const deleted = await fx.base.fleetDb.execute(sql`delete from bms.report_schedules where id = ${scheduleId}::uuid`);
  assert(deleted.rowCount === 1, `the positive control failed: expected to delete 1 schedule, got ${deleted.rowCount}`);
  fx.deletedScheduleIds.push(scheduleId);
  const { svc } = service(fx);
  const outcome = await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  assert(outcome.kind === "skipped" && outcome.reason === "absent", `expected skipped/absent; got ${JSON.stringify(outcome)}`);
  const rows = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(rows.length === 0, `a deleted schedule must write no row; found ${rows.length}`);
}

/**
 * `retentionPerSchedule: 2`, three periods in three transactions (so
 * `created_at` orders them — `now()` is transaction-stable and a single
 * format keeps the order total): the oldest period's row and object are
 * gone, the two newest rows and objects present.
 */
export async function pruneKeepsTheNewestRetentionRowsAndDeletesTheirObjects(fx: RenderIntegrationFixtures): Promise<void> {
  const scheduleId = await insertSchedule(fx);
  const { svc } = service(fx, { config: { retentionPerSchedule: 2 } });
  await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  const [oldest] = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(oldest !== undefined, "the positive control failed: the first period wrote no row");
  await run(fx, svc, payloadFor(scheduleId, PERIOD_2, fx.base.eskomId));
  const third = rendered(await run(fx, svc, payloadFor(scheduleId, PERIOD_3, fx.base.eskomId)));
  assert(third.prunedKeys.size === 1 && third.prunedKeys.has(oldest.id), `the third run must prune exactly the first period's row; pruned ${JSON.stringify([...third.prunedKeys.keys()])}`);

  const rows = await readFileRows(fx.base.fleetDb, scheduleId);
  const periods = rows.map((r) => r.period_end).sort();
  assert(periods.join(",") === `${PERIOD_2.periodEnd},${PERIOD_3.periodEnd}`, `expected the two newest periods to remain; got ${periods.join(",")}`);
  assert((await headObject(fx.base.client, oldest.object_key)) === null, "the pruned row's object must be gone from the bucket");
  for (const row of rows) {
    assert((await headObject(fx.base.client, row.object_key)) !== null, `the kept row ${row.id} must still have its object`);
  }
}

// ---------------------------------------------------------------------------
// Phases B/C — delivery
// ---------------------------------------------------------------------------

/** Decision 10: an ESKOM email channel → `sent`, no error, and the two attachments are the rows' filenames and the bucket's bytes. */
export async function deliverySentCarriesTheTwoAttachments(fx: RenderIntegrationFixtures): Promise<void> {
  const channelId = await insertChannel(fx);
  const scheduleId = await insertSchedule(fx, { formats: ["pdf", "xlsx"], channelId });
  const { svc, sent } = service(fx);
  await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));

  const rows = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(rows.length === 2, `the positive control failed: expected two rows, got ${rows.length}`);
  for (const row of rows) {
    assert(row.delivery_status === "sent" && row.delivery_error === null, `row ${row.id}: expected sent/NULL; got ${row.delivery_status}/${String(row.delivery_error)}`);
  }
  assert(sent.length === 1, `expected exactly one mail; got ${sent.length}`);
  const mail = sent[0]!;
  assert(mail.to.length === 1 && mail.to[0] === RECIPIENT, `the mail must go to the channel's recipient; got ${JSON.stringify(mail.to)}`);
  const attachments = mail.attachments ?? [];
  assert(
    attachments.map((a) => a.filename).join(",") === rows.map((r) => r.filename).join(","),
    `attachment filenames must equal the rows' in format order; got ${attachments.map((a) => a.filename).join(",")} vs ${rows.map((r) => r.filename).join(",")}`,
  );
  for (const [index, row] of rows.entries()) {
    const bytes = await fetchObject(fx.base.client, row);
    assert(attachments[index]!.content.equals(bytes), `attachment ${index} must be the bytes of the object of ${row.id}`);
  }
}

export async function noChannelIsSkippedUnconfigured(fx: RenderIntegrationFixtures): Promise<void> {
  const scheduleId = await insertSchedule(fx);
  const { svc, sent } = service(fx);
  await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  const [row] = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(row !== undefined, "the positive control failed: no row was written");
  assert(
    row.delivery_status === "skipped_unconfigured" && row.delivery_error === NO_CHANNEL_SENTENCE,
    `expected skipped_unconfigured/"${NO_CHANNEL_SENTENCE}"; got ${row.delivery_status}/${String(row.delivery_error)}`,
  );
  assert(sent.length === 0, "nothing may be sent without a channel");
}

/** The FK admits a PHEWB channel on an ESKOM schedule; the tenant policy hides it, so it reads as absent. */
export async function aForeignChannelIsSkippedUnconfigured(fx: RenderIntegrationFixtures): Promise<void> {
  const channelId = await insertChannel(fx, { organizationId: fx.base.phewbId });
  const scheduleId = await insertSchedule(fx, { channelId });
  const { svc, sent } = service(fx);
  await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  const [row] = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(row !== undefined, "the positive control failed: no row was written");
  assert(
    row.delivery_status === "skipped_unconfigured" && row.delivery_error === CHANNEL_UNAVAILABLE_SENTENCE,
    `expected skipped_unconfigured/"${CHANNEL_UNAVAILABLE_SENTENCE}"; got ${row.delivery_status}/${String(row.delivery_error)}`,
  );
  assert(sent.length === 0, "nothing may be sent to a foreign channel");
}

export async function aWebhookChannelIsSkippedUnconfigured(fx: RenderIntegrationFixtures): Promise<void> {
  const channelId = await insertChannel(fx, { kind: "webhook", config: { url: "https://hooks.example.test/f35b" } });
  const scheduleId = await insertSchedule(fx, { channelId });
  const { svc, sent } = service(fx);
  await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  const [row] = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(row !== undefined, "the positive control failed: no row was written");
  assert(
    row.delivery_status === "skipped_unconfigured" && row.delivery_error === CHANNEL_UNAVAILABLE_SENTENCE,
    `expected skipped_unconfigured/"${CHANNEL_UNAVAILABLE_SENTENCE}"; got ${row.delivery_status}/${String(row.delivery_error)}`,
  );
  assert(sent.length === 0, "nothing may be sent to a webhook channel");
}

/** A sender that rejects with an address in its text → `failed` and the counts-only sentence; no `@` reaches the row. */
export async function aSenderFailureLandsTheCountsOnlySentence(fx: RenderIntegrationFixtures): Promise<void> {
  const channelId = await insertChannel(fx);
  const scheduleId = await insertSchedule(fx, { channelId });
  const failing = fakeSender(new Error(`550 mailbox ${RECIPIENT} unavailable`));
  const { svc } = service(fx, { sender: failing.sender });
  await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  const [row] = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(row !== undefined, "the positive control failed: no row was written");
  assert(
    row.delivery_status === "failed" && row.delivery_error === sendFailedSentence(1, 1),
    `expected failed/"${sendFailedSentence(1, 1)}"; got ${row.delivery_status}/${String(row.delivery_error)}`,
  );
  assert(!(row.delivery_error ?? "").includes("@"), `delivery_error must carry no address; got ${String(row.delivery_error)}`);
}

/** `emailMaxBytes: 1`: the mail goes without attachments, the body says so, the row is `sent`. */
export async function overTheCeilingSendsNoAttachmentAndSaysSo(fx: RenderIntegrationFixtures): Promise<void> {
  const channelId = await insertChannel(fx);
  const scheduleId = await insertSchedule(fx, { channelId });
  const { svc, sent } = service(fx, { config: { emailMaxBytes: 1 } });
  await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  const [row] = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(row !== undefined, "the positive control failed: no row was written");
  assert(row.delivery_status === "sent" && row.delivery_error === null, `expected sent/NULL; got ${row.delivery_status}/${String(row.delivery_error)}`);
  assert(sent.length === 1, `expected exactly one mail; got ${sent.length}`);
  const mail = sent[0]!;
  assert(mail.attachments === undefined, `the mail must carry no attachments key; got ${JSON.stringify(mail.attachments?.map((a) => a.filename))}`);
  assert(mail.text.includes(ceilingSentence(row.byte_size)), `the body must carry "${ceilingSentence(row.byte_size)}"; got ${JSON.stringify(mail.text)}`);
}

/**
 * Phase B throws on the read-back (the object store refuses `getObject`
 * once): `finish` rejects, the row stays at `none`; `finish` again with the
 * working client → `sent`, without a second render.
 */
export async function aFailedFinishLeavesRowsAtNoneForTheRetry(fx: RenderIntegrationFixtures): Promise<void> {
  const channelId = await insertChannel(fx);
  const scheduleId = await insertSchedule(fx, { channelId });
  const broken = service(fx, { client: clientFailingOneGet(fx.base.client) });
  const payload = payloadFor(scheduleId, PERIOD_1, fx.base.eskomId);
  const outcome = await withTenant(fx.base.tenantDb, payload.organizationId, (tx) => broken.svc.render(payload, tx));
  const thrown = await captureRejection(() => broken.svc.finish(outcome));
  assert(errorMessage(thrown).includes("probe"), `expected the probe's rejection; got ${errorMessage(thrown)}`);
  const [afterFailure] = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(afterFailure !== undefined, "the positive control failed: phase A wrote no row");
  assert(afterFailure.delivery_status === "none", `a failed phase B must leave the row at none; got ${afterFailure.delivery_status}`);
  assert(broken.sent.length === 0, "nothing may be sent when the read-back failed");

  const working = service(fx);
  await working.svc.finish(outcome);
  const [afterRetry] = await readFileRows(fx.base.fleetDb, scheduleId);
  assert(afterRetry !== undefined && afterRetry.id === afterFailure.id, "the retry must deliver the same row, not render a new one");
  assert(afterRetry.delivery_status === "sent" && afterRetry.delivery_error === null, `expected sent/NULL after the retry; got ${afterRetry.delivery_status}/${String(afterRetry.delivery_error)}`);
  assert(working.sent.length === 1 && (working.sent[0]!.attachments ?? []).length === 1, "the retry must send the one attachment");
}

// ---------------------------------------------------------------------------
// The counters
// ---------------------------------------------------------------------------

/**
 * One series' sample as the registry renders it — `"0"` when the series has
 * not been observed yet. Matched by name and one label, not by the exact
 * label set: `setDefaultLabels` appends `service="…"` to every line.
 */
export async function readCounter(metrics: MetricsService, name: string, label: string): Promise<string> {
  const text = await metrics.registry.metrics();
  for (const line of text.split("\n")) {
    if (!line.startsWith(`${name}{`)) continue;
    const close = line.indexOf("}");
    const labels = line.slice(name.length + 1, close);
    if (labels.split(",").includes(label)) {
      return line.slice(close + 1).trim();
    }
  }
  return "0";
}

/** `{format="pdf"}` and `{status="sent"}` each move by exactly one across one delivered run — a delta, never a lifetime value. */
export async function theCountersMoved(fx: RenderIntegrationFixtures): Promise<void> {
  const writtenBefore = await readCounter(fx.metrics, "bms_report_files_written_total", 'format="pdf"');
  const sentBefore = await readCounter(fx.metrics, "bms_report_deliveries_total", 'status="sent"');
  const channelId = await insertChannel(fx);
  const scheduleId = await insertSchedule(fx, { channelId });
  const { svc } = service(fx);
  await run(fx, svc, payloadFor(scheduleId, PERIOD_1, fx.base.eskomId));
  const writtenAfter = await readCounter(fx.metrics, "bms_report_files_written_total", 'format="pdf"');
  const sentAfter = await readCounter(fx.metrics, "bms_report_deliveries_total", 'status="sent"');
  assert(
    Number(writtenAfter) === Number(writtenBefore) + 1,
    `bms_report_files_written_total{format="pdf"} must move by +1; before "${writtenBefore}", after "${writtenAfter}"`,
  );
  assert(
    Number(sentAfter) === Number(sentBefore) + 1,
    `bms_report_deliveries_total{status="sent"} must move by +1; before "${sentBefore}", after "${sentAfter}"`,
  );
}
