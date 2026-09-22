import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import { assets, notificationChannels, reportFiles, reportSchedules } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { REPORT_FILE_FORMATS, reportTemplateIdSchema } from "@bms/shared";
import type { EnergyReportPreview, ReportDeliveryStatus, ReportFileFormat } from "@bms/shared";

import { requireStorageConfigured } from "../assets/require-storage";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import type { BmsTx } from "../database/tenant-context";
import { ChannelsService } from "../notifications/channels.service";
import { EmailTransport, readRecipients } from "../notifications/email.transport";
import type { NotificationAttachment, NotificationMessage } from "../notifications/notification-transport";
import { MetricsService } from "../observability/metrics.service";
import type { PayloadOf } from "../queue/queue-registry";
import type { reportsRenderQueue } from "../queue/reports-render";
import { buildReportObjectKey } from "../storage/object-key";
import { getObject, putObject } from "../storage/storage-client";
import type { StorageClient } from "../storage/storage-client";
import { STORAGE_CLIENT } from "../storage/storage.tokens";
import {
  CONTENT_TYPES,
  describeBuffer,
  discardObjectsBestEffort,
  errorName,
  reportFilename,
} from "./report-file-store";
import type { ReportFilesConfig } from "./report-files-config";
import { REPORT_FILES_CONFIG } from "./report-files.tokens";
import { ReportsService } from "./reports.service";

export type RenderPayload = PayloadOf<typeof reportsRenderQueue>;

/**
 * What phase A hands phase B/C through `runProcessor`'s continuation. Two
 * fields the plan's shape did not name are carried so `finish` never
 * re-reads the schedule: `channelId` (the delivery target) and `assetIds`
 * (the scope `energyPreview` summarises — the same ids the files were
 * rendered under). `prunedKeys` is keyed by file id so the best-effort
 * discard can name the id, never the key, in its warn (§9.6).
 */
export type RenderOutcome =
  | { readonly kind: "skipped"; readonly reason: "absent" | "disabled" }
  | {
      readonly kind: "rendered";
      readonly organizationId: string;
      readonly scheduleId: string;
      readonly scheduleName: string;
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly written: number;
      readonly skippedExisting: number;
      /** File id → object key of every row the prune deleted in phase A. */
      readonly prunedKeys: ReadonlyMap<string, string>;
      readonly channelId: string | null;
      readonly assetIds: readonly string[];
    };

/** The four fixed delivery sentences this service composes (R-11). None carries an address, a filename or the schedule name. */
export const NO_CHANNEL_SENTENCE = "no channel configured";
export const CHANNEL_UNAVAILABLE_SENTENCE = "channel unavailable";
export const NO_HISTORY_URL_SENTENCE = "Open Reports & Analytics in TRINETRA to download the files.";

export function sendFailedSentence(recipients: number, attachments: number): string {
  return `email send failed (recipients=${recipients}, attachments=${attachments})`;
}

export function ceilingSentence(totalBytes: number): string {
  return `The files (${totalBytes} bytes) exceed the attachment ceiling; download them from the history.`;
}

/** The rows phase C delivers: this schedule and period's files still at `delivery_status = 'none'`. */
type DeliverableRow = {
  fileId: string;
  format: string;
  objectKey: string;
  filename: string;
  contentType: string;
  byteSize: number;
};

/**
 * `F3.5b` (ADR 0071 decisions 8, 9, 10; plan R-9, R-11; Q-4) — the
 * `reports-render` job body, in the three phases `runProcessor`'s
 * post-commit continuation separates.
 *
 * **Phase A — `render(payload, tx)`, inside the processor's tenant
 * transaction.** `requireStorageConfigured` first (a throw fails the job).
 * The schedule is read by id on `tx` — RLS-scoped, so a foreign or deleted
 * row is absent — and an absent or disabled row is one `info` with counts
 * and the `skipped` outcome; nothing is written. `location_ids = {}` means
 * every asset the policy shows this organization; else the assets whose
 * `location_id = ANY(location_ids)` — both on `tx`, never the fleet pool
 * (the service injects no fleet handle; `fleet-read-wiring.spec.ts` pins
 * slot 0). Then, for each format in `REPORT_FILE_FORMATS` order the row
 * names: a `(schedule_id, period_end, format)` row already present counts
 * `skippedExisting` (decision 9's idempotency); else the renderer runs on
 * the fleet pool with those asset ids exactly as the controller does, the
 * buffer is hashed and sized (`describeBuffer`), the filename comes from
 * `reportFilename(periodStart, periodEnd, format)` — **never the schedule
 * name** (Amendment 1 item 12: the `Content-Disposition` filename is quoted,
 * not escaped, so its only inputs are two bounded dates and an enum) — the
 * object is put under `buildReportObjectKey`, the row inserted on `tx` with
 * `created_by = NULL` (a schedule runs as the system, not as its author),
 * `schedule_id`, the row's `location_ids` copied and `delivery_status =
 * 'none'`, and `countReportFileWritten(format)` ticks. The prune then
 * selects this schedule's rows beyond the newest `retentionPerSchedule`
 * (`ORDER BY created_at DESC, id DESC OFFSET n`) and deletes the rows on
 * `tx`, collecting `(fileId → key)` for phase B.
 *
 * **Any throw in phase A deletes every object this run put, best-effort,
 * then rethrows.** No committed-row re-check (the shape
 * `discardObjectUnlessTheRowCommitted` needs) applies here: the throw
 * propagates out of `withTenant`'s callback, which aborts the transaction,
 * so none of this run's rows can have committed. A pruned row's object is
 * **not** touched in phase A — its delete is part of the same transaction
 * and may still roll back.
 *
 * **Phase B — `finish(outcome)`, after the commit.** The pruned keys are
 * deleted best-effort (one warn per failure naming the file id; the orphan
 * is ADR 0066 decision 11's sweep row). Then delivery: one tenant
 * transaction reads this schedule and period's rows still at
 * `delivery_status = 'none'` — the retry idempotency: a job that failed in
 * phase B re-delivers without re-rendering, and a job that already
 * delivered finds nothing — and the channel row by `channel_id` (invisible
 * under RLS when foreign, so it reads as absent). That transaction commits
 * **before** any object is read back or any mail is sent: a tenant
 * connection is never held across an S3 or SMTP round trip (the
 * `ReportFilesService` rule). The attachments are read back from the
 * object store by key — one code path for first runs and retries — one per
 * row in format order; a sum of `byte_size` strictly over
 * `emailMaxBytes` sends the message with no attachments and the ceiling
 * sentence, status `sent`. The message: `subject = "<schedule name> —
 * <periodStart> to <periodEnd>"` (nodemailer encodes headers), the four
 * summary lines from `energyPreview` on the same asset scope, the history
 * line (`REPORT_HISTORY_URL` set → `Open Reports & Analytics:
 * <url>/reports`, else the fixed sentence), `ruleId/ruleCode/alarmId/
 * severity = null`, the channel through `ChannelsService.toChannelRow`
 * (the one place a secret is decrypted). Outcomes: `channel_id NULL` →
 * `skipped_unconfigured` / `"no channel configured"`; channel absent,
 * disabled or not `email` → `skipped_unconfigured` / `"channel
 * unavailable"`; the transport's own `skipped_unconfigured` → its fixed
 * sentence (neither carries an address); `sent` → `null`; `failed` → the
 * counts-only sentence this service composes — **never the transport's
 * `error` string**, which may quote server text.
 *
 * **Phase C.** `UPDATE report_files SET delivery_status, delivery_error
 * WHERE id = ANY(ids)` in a second fresh `withTenant`, then
 * `countReportDelivery(status)`.
 *
 * **§9.6.** Every log line names ids, counts and `err.name` — never a
 * filename, an object key, an address or the schedule name. The
 * constructor order is pinned in `database/fleet-read-wiring.spec.ts`
 * (slot 0 = `TENANT_DRIZZLE`, slot 1 = `STORAGE_CLIENT`).
 */
@Injectable()
export class ReportRenderService {
  private readonly logger = new Logger(ReportRenderService.name);

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(STORAGE_CLIENT) private readonly client: StorageClient,
    @Inject(REPORT_FILES_CONFIG) private readonly config: ReportFilesConfig,
    private readonly reports: ReportsService,
    private readonly email: EmailTransport,
    private readonly metrics: MetricsService,
    // Slot 6 (0-based, the `fleet-read-wiring.spec.ts` indexing): `toChannelRow`
    // is an instance method (it decrypts through the
    // service's `CredentialCryptoService` and warns through its logger), so
    // the channel read cannot map without the service.
    private readonly channels: ChannelsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Phase A
  // ---------------------------------------------------------------------------

  async render(payload: RenderPayload, tx: BmsTx): Promise<RenderOutcome> {
    requireStorageConfigured(this.client);
    const { organizationId, scheduleId, periodStart, periodEnd } = payload;

    const [schedule] = await tx
      .select({
        scheduleId: reportSchedules.id,
        name: reportSchedules.name,
        formats: reportSchedules.formats,
        locationIds: reportSchedules.locationIds,
        channelId: reportSchedules.channelId,
        enabled: reportSchedules.enabled,
      })
      .from(reportSchedules)
      .where(eq(reportSchedules.id, scheduleId))
      .limit(1);

    if (!schedule) {
      this.logger.log(`report schedule ${scheduleId}: absent under the tenant policy; written=0 skippedExisting=0 (ADR 0071 decision 9)`);
      return { kind: "skipped", reason: "absent" };
    }
    if (!schedule.enabled) {
      this.logger.log(`report schedule ${scheduleId}: disabled; written=0 skippedExisting=0 (ADR 0071 decision 9)`);
      return { kind: "skipped", reason: "disabled" };
    }

    const assetIds = await resolveAssetIds(tx, schedule.locationIds);
    const formats = REPORT_FILE_FORMATS.filter((format) => schedule.formats.includes(format));
    const query = { startDate: periodStart, endDate: periodEnd };

    /** File id → key of every object this run put; discarded on a throw. */
    const putKeys = new Map<string, string>();
    let written = 0;
    let skippedExisting = 0;
    const prunedKeys = new Map<string, string>();

    try {
      for (const format of formats) {
        const existing = await tx
          .select({ existingId: reportFiles.id })
          .from(reportFiles)
          .where(
            and(
              eq(reportFiles.scheduleId, scheduleId),
              eq(reportFiles.periodEnd, periodEnd),
              eq(reportFiles.format, format),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          skippedExisting += 1;
          continue;
        }

        const buffer =
          format === "pdf"
            ? await this.reports.energyPdf(query, assetIds)
            : await this.reports.energyXlsx(query, assetIds);
        const { sha256, byteSize } = describeBuffer(buffer);
        const filename = reportFilename(periodStart, periodEnd, format);
        const contentType = CONTENT_TYPES[format];
        const fileId = randomUUID();
        const key = buildReportObjectKey({ organizationId, fileId });

        await putObject(this.client, key, buffer, contentType);
        putKeys.set(fileId, key);

        await tx.insert(reportFiles).values({
          id: fileId,
          organizationId,
          templateId: reportTemplateIdSchema.value,
          format,
          periodStart,
          periodEnd,
          locationIds: schedule.locationIds,
          objectKey: key,
          contentType,
          byteSize,
          sha256,
          filename,
          deliveryStatus: "none",
          deliveryError: null,
          scheduleId,
          // A schedule runs as the system, not as its author (R-9).
          createdBy: null,
        });
        this.metrics.countReportFileWritten(format);
        written += 1;
      }

      const overflow = await tx
        .select({ prunedId: reportFiles.id, objectKey: reportFiles.objectKey })
        .from(reportFiles)
        .where(eq(reportFiles.scheduleId, scheduleId))
        .orderBy(desc(reportFiles.createdAt), desc(reportFiles.id))
        .offset(this.config.retentionPerSchedule);
      if (overflow.length > 0) {
        await tx.delete(reportFiles).where(
          inArray(
            reportFiles.id,
            overflow.map((row) => row.prunedId),
          ),
        );
        for (const row of overflow) {
          prunedKeys.set(row.prunedId, row.objectKey);
        }
      }
    } catch (err) {
      this.logger.warn(
        `report schedule ${scheduleId}: render failed with ${errorName(err)} after ${putKeys.size} object(s) were put; discarding them (ADR 0071 decision 9)`,
      );
      await discardObjectsBestEffort(this.client, this.logger, putKeys);
      throw err;
    }

    this.logger.log(
      `report schedule ${scheduleId}: written=${written} skippedExisting=${skippedExisting} pruned=${prunedKeys.size} assets=${assetIds.length} (ADR 0071 decision 9)`,
    );
    return {
      kind: "rendered",
      organizationId,
      scheduleId,
      scheduleName: schedule.name,
      periodStart,
      periodEnd,
      written,
      skippedExisting,
      prunedKeys,
      channelId: schedule.channelId,
      assetIds,
    };
  }

  // ---------------------------------------------------------------------------
  // Phases B and C
  // ---------------------------------------------------------------------------

  async finish(outcome: RenderOutcome): Promise<void> {
    if (outcome.kind === "skipped") {
      return;
    }
    // Phase B, first half: the pruned rows committed, so their objects go.
    await discardObjectsBestEffort(this.client, this.logger, outcome.prunedKeys);

    const { organizationId, scheduleId, periodEnd } = outcome;
    const loaded = await withTenant(this.tenantDb, organizationId, async (tx) => {
      const rows: DeliverableRow[] = await tx
        .select({
          fileId: reportFiles.id,
          format: reportFiles.format,
          objectKey: reportFiles.objectKey,
          filename: reportFiles.filename,
          contentType: reportFiles.contentType,
          byteSize: reportFiles.byteSize,
        })
        .from(reportFiles)
        .where(
          and(
            eq(reportFiles.scheduleId, scheduleId),
            eq(reportFiles.periodEnd, periodEnd),
            eq(reportFiles.deliveryStatus, "none"),
          ),
        );
      const channel = outcome.channelId === null ? null : await loadChannel(tx, outcome.channelId);
      return { rows, channel };
    });

    const rows = [...loaded.rows].sort(
      (a, b) => REPORT_FILE_FORMATS.indexOf(a.format as ReportFileFormat) - REPORT_FILE_FORMATS.indexOf(b.format as ReportFileFormat),
    );
    if (rows.length === 0) {
      this.logger.log(`report schedule ${scheduleId}: no file still awaiting delivery for this period; nothing sent (ADR 0071 decision 10)`);
      return;
    }

    const verdict = await this.deliver(outcome, rows, loaded.channel);

    // Phase C.
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx
        .update(reportFiles)
        .set({ deliveryStatus: verdict.status, deliveryError: verdict.error })
        .where(
          inArray(
            reportFiles.id,
            rows.map((row) => row.fileId),
          ),
        );
    });
    this.metrics.countReportDelivery(verdict.status);
    this.logger.log(
      `report schedule ${scheduleId}: delivery ${verdict.status} for ${rows.length} file(s) (ADR 0071 decision 10)`,
    );
  }

  /** The R-11 decision table; resolves to the status and sentence phase C lands. */
  private async deliver(
    outcome: Extract<RenderOutcome, { kind: "rendered" }>,
    rows: readonly DeliverableRow[],
    channel: StoredChannelRow | null,
  ): Promise<{ status: ReportDeliveryStatus; error: string | null }> {
    if (outcome.channelId === null) {
      return { status: "skipped_unconfigured", error: NO_CHANNEL_SENTENCE };
    }
    if (channel === null || !channel.enabled || channel.kind !== "email") {
      return { status: "skipped_unconfigured", error: CHANNEL_UNAVAILABLE_SENTENCE };
    }

    const totalBytes = rows.reduce((sum, row) => sum + row.byteSize, 0);
    const overCeiling = totalBytes > this.config.emailMaxBytes;
    const attachments: NotificationAttachment[] = overCeiling ? [] : await this.readBack(rows);

    const preview = await this.reports.energyPreview(
      { startDate: outcome.periodStart, endDate: outcome.periodEnd },
      [...outcome.assetIds],
    );
    const bodyLines = [
      ...summaryLines(preview),
      this.config.historyUrl === null
        ? NO_HISTORY_URL_SENTENCE
        : `Open Reports & Analytics: ${this.config.historyUrl}/reports`,
    ];
    if (overCeiling) {
      bodyLines.push(ceilingSentence(totalBytes));
    }

    const channelRow = this.channels.toChannelRow(channel);
    const message: NotificationMessage = {
      subject: `${outcome.scheduleName} — ${outcome.periodStart} to ${outcome.periodEnd}`,
      body: bodyLines.join("\n"),
      ruleId: null,
      ruleCode: null,
      alarmId: null,
      severity: null,
      channel: channelRow,
      attachments,
    };

    const result = await this.email.send(message);
    if (result.status === "sent") {
      return { status: "sent", error: null };
    }
    if (result.status === "skipped_unconfigured") {
      return { status: "skipped_unconfigured", error: result.error };
    }
    // Never the transport's own sentence — it may quote server text.
    const recipients = readRecipients(channelRow.config).length;
    return { status: "failed", error: sendFailedSentence(recipients, attachments.length) };
  }

  /** One attachment per row, read back from the object store by key — the same path for a first run and a retry. */
  private async readBack(rows: readonly DeliverableRow[]): Promise<NotificationAttachment[]> {
    const attachments: NotificationAttachment[] = [];
    for (const row of rows) {
      const object = await getObject(this.client, row.objectKey);
      if (object === null) {
        // The row is the authority (decision 4): a missing object fails the job
        // rather than mailing a partial set; the rows stay at `none` for the retry.
        throw new Error(`report file ${row.fileId} has no object in the bucket (ADR 0071 decision 4)`);
      }
      attachments.push({
        filename: row.filename,
        contentType: row.contentType,
        body: await readAll(object.body),
      });
    }
    return attachments;
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/** What `ChannelsService.toChannelRow` takes — the eleven-column projection `channel-reads.ts` selects. */
type StoredChannelRow = Parameters<ChannelsService["toChannelRow"]>[0];

/**
 * `{}` → every asset the policy shows (the `FORCE` policy on `bms.assets`
 * bounds the read to the organization); else the plan's `location_id =
 * ANY($ids)`, spelled as drizzle's `inArray` (`location_id IN ($1, …)`) —
 * a raw `sql` template expands a JS array to `($1, $2)`, which `any(…)`
 * refuses as a row constructor (measured at U8). On `tx`, never the fleet
 * pool, so a location id that names another organization's location
 * resolves to nothing.
 */
async function resolveAssetIds(tx: BmsTx, locationIds: readonly string[]): Promise<string[]> {
  const rows = await tx
    .select({ assetId: assets.id })
    .from(assets)
    .where(locationIds.length === 0 ? undefined : inArray(assets.locationId, [...locationIds]));
  return rows.map((row) => row.assetId);
}

/** The channel by id on `tx`: a foreign channel is invisible under RLS and reads as absent. `enabled` and `kind` are decided in TypeScript so the three "unavailable" cases stay distinct paths. */
async function loadChannel(tx: BmsTx, channelId: string): Promise<StoredChannelRow | null> {
  const [row] = await tx
    .select({
      id: notificationChannels.id,
      organizationId: notificationChannels.organizationId,
      code: notificationChannels.code,
      name: notificationChannels.name,
      kind: notificationChannels.kind,
      config: notificationChannels.config,
      enabled: notificationChannels.enabled,
      secretCiphertext: notificationChannels.secretCiphertext,
      secretIv: notificationChannels.secretIv,
      secretKeyVersion: notificationChannels.secretKeyVersion,
      updatedAt: notificationChannels.updatedAt,
    })
    .from(notificationChannels)
    .where(eq(notificationChannels.id, channelId))
    .limit(1);
  return row ?? null;
}

/** The four summary lines of the mail body (R-11), from the same preview the PDF and XLSX tables read. */
export function summaryLines(preview: EnergyReportPreview): string[] {
  const { totalKwh, peakKw, pueEstimate, indicativeCost, currency } = preview.summary;
  return [
    `Total energy: ${totalKwh} kWh`,
    `Peak demand: ${peakKw} kW`,
    `PUE estimate: ${pueEstimate ?? "—"}`,
    `Indicative cost: ${indicativeCost === null ? "—" : `${currency ?? ""} ${indicativeCost}`.trim()}`,
  ];
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
