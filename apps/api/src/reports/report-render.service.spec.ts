import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { Readable } from "node:stream";
import { vi } from "vitest";

import type { BmsDb } from "@bms/db";
import type { EnergyReportPreview } from "@bms/shared";

import type { ChannelsService } from "../notifications/channels.service";
import type { EmailTransport } from "../notifications/email.transport";
import type { DeliveryResult, NotificationMessage } from "../notifications/notification-transport";
import type { MetricsService } from "../observability/metrics.service";
import { buildReportObjectKey, OBJECT_KEY_PREFIX } from "../storage/object-key";
import type { S3Ops, StorageClient } from "../storage/storage-client";
import { STORAGE_CLIENT } from "../storage/storage.tokens";
import { ReportRenderService } from "./report-render.service";
import type { RenderOutcome, RenderPayload } from "./report-render.service";
import type { ReportFilesConfig } from "./report-files-config";
import type { ReportsService } from "./reports.service";

/**
 * `F3.5b` (ADR 0071 decisions 8–10; plan R-9, R-11) — `ReportRenderService`
 * over fakes. Assertions live here; `report-render.service.test.ts` is the
 * Vitest entry point (§4.6).
 *
 * The harness mirrors `report-files.service.spec.ts`: a `tx` fake dispatched
 * on the `select` projection's shape (every read of the service has a
 * distinct shape — `scheduleId…`, `assetId`, `existingId`, `prunedId`,
 * `fileId…`, the eleven-column channel row — so the fake never guesses), an
 * in-memory `S3Ops` recording every put/get/delete key, a `ReportsService`
 * fake answering `%PDF-`/`PK` buffers and one preview, an `EmailTransport`
 * fake recording the message and answering a scripted `DeliveryResult`, a
 * `MetricsService` fake recording both counters, and a `ChannelsService`
 * fake whose `toChannelRow` is the identity plus the two secret fields.
 * `where` arguments are rendered through `PgDialect` to SQL text plus
 * params, so the location predicate and the `delivery_status = 'none'`
 * retry predicate are asserted on text, never on a comment.
 *
 * The fixture schedule is named `f3.5b-SHOULD-NOT-APPEAR`, and one row
 * asserts it reaches no insert value, no put key, no log line and no
 * filename — with `outcome.scheduleName` as the positive control that the
 * name was in fact loaded.
 *
 * Phases B and C (`finish`) are asserted in `report-render-delivery.spec.ts`
 * over this same harness — one file would cross AGENTS.md §4.5's cap.
 */

export const ORG_ID = "11111111-1111-4111-8111-111111111111";
export const SCHEDULE_ID = "44444444-4444-4444-8444-444444444444";
export const CHANNEL_ID = "77777777-7777-4777-8777-777777777777";
export const WC = "22222222-2222-4222-8222-222222222222";
export const OTHER_LOCATION = "23232323-2323-4232-8232-232323232323";
const ASSET_A = "66666666-6666-4666-8666-666666666666";
export const ASSET_B = "67676767-6767-4676-8676-676767676767";
export const PRUNED_A = "88888888-8888-4888-8888-888888888888";
export const PRUNED_B = "89898989-8989-4898-8898-898989898989";
export const FILE_PDF = "33333333-3333-4333-8333-333333333333";
export const FILE_XLSX = "34343434-3434-4343-8343-343434343434";
export const SCHEDULE_NAME = "f3.5b-SHOULD-NOT-APPEAR";
export const PDF_BYTES = Buffer.from("%PDF-1.4 fake report bytes");
export const XLSX_BYTES = Buffer.from("PK fake workbook bytes");
export const PDF_TYPE = "application/pdf";
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const RECIPIENTS = ["control.room@ion-exchange.example", "ops@ion-exchange.example"];
export const SMTP_ERROR = "550 for control.room@ion-exchange.example";

export const PAYLOAD: RenderPayload = {
  organizationId: ORG_ID,
  scheduleId: SCHEDULE_ID,
  periodStart: "2026-09-01",
  periodEnd: "2026-09-07",
};

export const KEY_PDF = buildReportObjectKey({ organizationId: ORG_ID, fileId: FILE_PDF });
export const KEY_XLSX = buildReportObjectKey({ organizationId: ORG_ID, fileId: FILE_XLSX });
export const KEY_PRUNED_A = buildReportObjectKey({ organizationId: ORG_ID, fileId: PRUNED_A });
export const KEY_PRUNED_B = buildReportObjectKey({ organizationId: ORG_ID, fileId: PRUNED_B });

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { name?: unknown }).name?.toString() : undefined;
}

export function namedError(name: string): Error {
  // The message carries a key, so a warn that quoted `err.message` reddens the leak rows.
  const err = new Error(`fake ${name}: ${KEY_PRUNED_A}`);
  err.name = name;
  return err;
}

async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  let rejected = false;
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    rejected = true;
    caught = err;
  }
  assert(rejected, "expected the call to reject, and it resolved");
  return caught;
}

export async function capturingLogs<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[]; logs: string[] }> {
  const warns: string[] = [];
  const logs: string[] = [];
  const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
    warns.push(String(message));
  });
  const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation((message: unknown) => {
    logs.push(String(message));
  });
  try {
    const result = await fn();
    return { result, warns, logs };
  } finally {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function chain(resolve: () => Promise<unknown>, onCall?: (method: string, args: unknown[]) => void): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop): unknown {
        if (prop === "then") {
          return (res: (v: unknown) => void, rej: (e: unknown) => void) => resolve().then(res, rej);
        }
        return (...args: unknown[]) => {
          onCall?.(String(prop), args);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function shapeOf(projection?: Record<string, unknown>): string {
  return projection === undefined ? "" : Object.keys(projection).sort().join(",");
}

const dialect = new PgDialect();

function renderWhere(arg: unknown): { sql: string; params: unknown[] } {
  if (arg === undefined) return { sql: "", params: [] };
  const query = dialect.sqlToQuery(arg as SQL);
  return { sql: query.sql, params: query.params };
}

type ScheduleFixture = {
  scheduleId: string;
  name: string;
  formats: string[];
  locationIds: string[];
  channelId: string | null;
  enabled: boolean;
};

type ChannelFixture = {
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  kind: string;
  config: unknown;
  enabled: boolean;
  secretCiphertext: Buffer | null;
  secretIv: Buffer | null;
  secretKeyVersion: number | null;
  updatedAt: Date;
};

type DeliverableFixture = {
  fileId: string;
  format: string;
  objectKey: string;
  filename: string;
  contentType: string;
  byteSize: number;
};

export function schedule(overrides: Partial<ScheduleFixture> = {}): ScheduleFixture {
  return {
    scheduleId: SCHEDULE_ID,
    name: SCHEDULE_NAME,
    formats: ["pdf", "xlsx"],
    locationIds: [],
    channelId: CHANNEL_ID,
    enabled: true,
    ...overrides,
  };
}

export function emailChannel(overrides: Partial<ChannelFixture> = {}): ChannelFixture {
  return {
    id: CHANNEL_ID,
    organizationId: ORG_ID,
    code: "CONTROL-ROOM",
    name: "Control room",
    kind: "email",
    config: { to: RECIPIENTS },
    enabled: true,
    secretCiphertext: null,
    secretIv: null,
    secretKeyVersion: null,
    updatedAt: new Date("2026-09-21T10:00:00.000Z"),
    ...overrides,
  };
}

/** The two rows phase B/C finds at `delivery_status = 'none'` — xlsx first so the format-order sort is observable. */
export function deliverableRows(): DeliverableFixture[] {
  return [
    {
      fileId: FILE_XLSX,
      format: "xlsx",
      objectKey: KEY_XLSX,
      filename: "energy-consumption-2026-09-01-to-2026-09-07.xlsx",
      contentType: XLSX_TYPE,
      byteSize: XLSX_BYTES.length,
    },
    {
      fileId: FILE_PDF,
      format: "pdf",
      objectKey: KEY_PDF,
      filename: "energy-consumption-2026-09-01-to-2026-09-07.pdf",
      contentType: PDF_TYPE,
      byteSize: PDF_BYTES.length,
    },
  ];
}

const PREVIEW = {
  summary: { window: "7d", totalKwh: 2345.17, peakKw: 414.66, pueEstimate: 1.25, indicativeCost: 5042.12, tariffPerKwh: 2.15, currency: "ZAR", asOf: "2026-09-08T00:00:00.000Z" },
} as unknown as EnergyReportPreview;

export type Scenario = {
  client?: StorageClient;
  config?: Partial<ReportFilesConfig>;
  /** `undefined` = the default enabled fixture; `null` = absent under the policy. */
  schedule?: ScheduleFixture | null;
  assets?: string[];
  /** Formats whose `(schedule_id, period_end, format)` row already exists. */
  existingFormats?: string[];
  /** The prune select's overflow rows. */
  overflow?: { prunedId: string; objectKey: string }[];
  /** The insert that throws (0-based), if any. */
  insertErrorAt?: number;
  deliverable?: DeliverableFixture[];
  channel?: ChannelFixture | null;
  emailResult?: DeliveryResult;
  deleteObject?: () => Promise<void>;
};

export type Harness = {
  service: ReportRenderService;
  calls: string[];
  putKeys: string[];
  getKeys: string[];
  deleteKeys: string[];
  inserted: Record<string, unknown>[];
  deleteWheres: { sql: string; params: unknown[] }[];
  updates: { set: Record<string, unknown>; where: { sql: string; params: unknown[] } }[];
  assetWheres: { sql: string; params: unknown[] }[];
  deliverableWheres: { sql: string; params: unknown[] }[];
  executed: { sql: string; params: unknown[] }[];
  reports: { calls: { method: string; query: unknown; assetIds: unknown }[] };
  email: { messages: NotificationMessage[] };
  metrics: { written: string[]; deliveries: string[] };
  tenantTransactions: () => number;
  tx: object;
};

export function harness(scenario: Scenario = {}): Harness {
  const calls: string[] = [];
  const putKeys: string[] = [];
  const getKeys: string[] = [];
  const deleteKeys: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const deleteWheres: Harness["deleteWheres"] = [];
  const updates: Harness["updates"] = [];
  const assetWheres: Harness["assetWheres"] = [];
  const deliverableWheres: Harness["deliverableWheres"] = [];
  const executed: Harness["executed"] = [];
  const putBodies = new Map<string, Buffer>();
  let tenantTransactions = 0;
  const scheduleRow = scenario.schedule === undefined ? schedule() : scenario.schedule;
  const channelRow = scenario.channel === undefined ? emailChannel() : scenario.channel;

  const tx = {
    execute: async (statement: unknown) => {
      const rendered = renderWhere(statement);
      executed.push(rendered);
      calls.push(rendered.sql.includes("set_config") ? "tx:setTenant" : "tx:execute");
      return undefined;
    },
    select: (projection?: Record<string, unknown>) => {
      const shape = shapeOf(projection);
      let whereArg: unknown;
      return chain(
        async () => {
          if (shape === "channelId,enabled,formats,locationIds,name,scheduleId") {
            calls.push("tx:selectSchedule");
            return scheduleRow === null ? [] : [scheduleRow];
          }
          if (shape === "assetId") {
            calls.push("tx:selectAssets");
            assetWheres.push(renderWhere(whereArg));
            return (scenario.assets ?? [ASSET_A, ASSET_B]).map((assetId) => ({ assetId }));
          }
          if (shape === "existingId") {
            calls.push("tx:uniqueCheck");
            const { params } = renderWhere(whereArg);
            const hit = (scenario.existingFormats ?? []).some((format) => params.includes(format));
            return hit ? [{ existingId: PRUNED_A }] : [];
          }
          if (shape === "objectKey,prunedId") {
            calls.push("tx:pruneSelect");
            return scenario.overflow ?? [];
          }
          if (shape === "byteSize,contentType,fileId,filename,format,objectKey") {
            calls.push("tx:selectDeliverable");
            deliverableWheres.push(renderWhere(whereArg));
            return scenario.deliverable ?? deliverableRows();
          }
          if (shape === "code,config,enabled,id,kind,name,organizationId,secretCiphertext,secretIv,secretKeyVersion,updatedAt") {
            calls.push("tx:selectChannel");
            return channelRow === null ? [] : [channelRow];
          }
          throw new Error(`tx fake: unexpected select shape ${shape}`);
        },
        (method, args) => {
          if (method === "where") whereArg = args[0];
        },
      );
    },
    insert: () => {
      let values: Record<string, unknown> = {};
      return chain(
        async () => {
          calls.push("tx:insert");
          if (scenario.insertErrorAt !== undefined && inserted.length - 1 === scenario.insertErrorAt) {
            throw namedError("InsertFailure");
          }
          return [values];
        },
        (method, args) => {
          if (method === "values") {
            values = args[0] as Record<string, unknown>;
            inserted.push(values);
          }
        },
      );
    },
    delete: () => {
      let whereArg: unknown;
      return chain(
        async () => {
          calls.push("tx:delete");
          deleteWheres.push(renderWhere(whereArg));
          return [];
        },
        (method, args) => {
          if (method === "where") whereArg = args[0];
        },
      );
    },
    update: () => {
      let setArg: Record<string, unknown> = {};
      let whereArg: unknown;
      return chain(
        async () => {
          calls.push("tx:update");
          updates.push({ set: setArg, where: renderWhere(whereArg) });
          return [];
        },
        (method, args) => {
          if (method === "set") setArg = args[0] as Record<string, unknown>;
          if (method === "where") whereArg = args[0];
        },
      );
    },
  };
  const tenant = {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      tenantTransactions += 1;
      calls.push("tx:begin");
      const result = await fn(tx);
      calls.push("tx:commit");
      return result;
    },
  } as unknown as BmsDb;

  const unreachable = (name: string) => async () => {
    calls.push(name);
    throw new Error(`${name} must not be called by the render job`);
  };
  const ops: S3Ops = {
    headBucket: unreachable("headBucket") as S3Ops["headBucket"],
    createBucket: unreachable("createBucket"),
    putObject: async (_bucket, key, body) => {
      calls.push("putObject");
      putKeys.push(key);
      putBodies.set(key, body);
    },
    getObject: async (_bucket, key) => {
      calls.push("getObject");
      getKeys.push(key);
      const body = putBodies.get(key) ?? (key === KEY_PDF ? PDF_BYTES : XLSX_BYTES);
      return { body: Readable.from([body]), contentLength: body.length };
    },
    headObject: unreachable("headObject") as S3Ops["headObject"],
    deleteObject: async (_bucket, key) => {
      calls.push("deleteObject");
      deleteKeys.push(key);
      await (scenario.deleteObject ?? (async () => undefined))();
    },
  };
  const client: StorageClient = scenario.client ?? { kind: "configured", bucket: "bms-asset-images", ops };

  const reports = { calls: [] as { method: string; query: unknown; assetIds: unknown }[] };
  const reportsFake = {
    energyPdf: async (query: unknown, assetIds: unknown) => {
      calls.push("render");
      reports.calls.push({ method: "energyPdf", query, assetIds });
      return PDF_BYTES;
    },
    energyXlsx: async (query: unknown, assetIds: unknown) => {
      calls.push("render");
      reports.calls.push({ method: "energyXlsx", query, assetIds });
      return XLSX_BYTES;
    },
    energyPreview: async (query: unknown, assetIds: unknown) => {
      calls.push("preview");
      reports.calls.push({ method: "energyPreview", query, assetIds });
      return PREVIEW;
    },
  } as unknown as ReportsService;

  const email = { messages: [] as NotificationMessage[] };
  const emailFake = {
    send: async (message: NotificationMessage) => {
      calls.push("email:send");
      email.messages.push(message);
      return scenario.emailResult ?? { status: "sent", error: null };
    },
  } as unknown as EmailTransport;

  const metrics = { written: [] as string[], deliveries: [] as string[] };
  const metricsFake = {
    countReportFileWritten: (format: string) => {
      metrics.written.push(format);
    },
    countReportDelivery: (status: string) => {
      metrics.deliveries.push(status);
    },
  } as unknown as MetricsService;

  const channelsFake = {
    toChannelRow: (row: ChannelFixture) => {
      calls.push("toChannelRow");
      const { secretCiphertext: _c, secretIv: _i, secretKeyVersion: _v, ...base } = row;
      return { ...base, config: (row.config ?? {}) as Record<string, unknown>, secret: null, secretState: "none" };
    },
  } as unknown as ChannelsService;

  const config: ReportFilesConfig = {
    onDemandCap: 50,
    retentionPerSchedule: 2,
    emailMaxBytes: 1_000_000,
    historyUrl: null,
    ...scenario.config,
  };
  const service = new ReportRenderService(tenant, client, config, reportsFake, emailFake, metricsFake, channelsFake);
  return {
    service,
    calls,
    putKeys,
    getKeys,
    deleteKeys,
    inserted,
    deleteWheres,
    updates,
    assetWheres,
    deliverableWheres,
    executed,
    reports,
    email,
    metrics,
    tenantTransactions: () => tenantTransactions,
    tx,
  };
}

/** Phase A on the harness's own `tx` fake, as `runProcessor` would hand it. */
async function render(h: Harness): Promise<RenderOutcome> {
  return h.service.render(PAYLOAD, h.tx as never);
}

function rendered(outcome: RenderOutcome): Extract<RenderOutcome, { kind: "rendered" }> {
  assert(outcome.kind === "rendered", `expected a rendered outcome, got ${outcome.kind}`);
  return outcome as Extract<RenderOutcome, { kind: "rendered" }>;
}

/** A rendered outcome as phase A would hand `finish`, without running phase A. */
export function renderedOutcome(overrides: Partial<Extract<RenderOutcome, { kind: "rendered" }>> = {}): RenderOutcome {
  return {
    kind: "rendered",
    organizationId: ORG_ID,
    scheduleId: SCHEDULE_ID,
    scheduleName: SCHEDULE_NAME,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-07",
    written: 2,
    skippedExisting: 0,
    prunedKeys: new Map(),
    channelId: CHANNEL_ID,
    assetIds: [ASSET_A, ASSET_B],
    ...overrides,
  };
}

export function lastUpdate(h: Harness): { set: Record<string, unknown>; where: { sql: string; params: unknown[] } } {
  const update = h.updates[h.updates.length - 1];
  assert(update !== undefined, "expected a phase-C update, and none ran");
  return update;
}

// ---------------------------------------------------------------------------
// Phase A — the gate, the schedule, the scope
// ---------------------------------------------------------------------------

export async function assertUnconfiguredStorageThrowsBeforeAnyRead(): Promise<void> {
  const h = harness({ client: { kind: "unconfigured" } });
  const err = await captureRejection(() => render(h));
  assert(errorName(err) === "ServiceUnavailableException" && h.calls.length === 0, `expected the 503 before any call, got ${errorName(err)} after ${h.calls.join(",")}`);
}

export async function assertAbsentScheduleIsSkipped(): Promise<void> {
  const h = harness({ schedule: null });
  const outcome = await render(h);
  assert(outcome.kind === "skipped" && outcome.reason === "absent", `expected skipped/absent, got ${JSON.stringify(outcome)}`);
}

export async function assertAbsentScheduleWritesNothing(): Promise<void> {
  const h = harness({ schedule: null });
  await render(h);
  assert(h.putKeys.length === 0 && h.reports.calls.length === 0 && h.inserted.length === 0, `expected no put, render or insert, got ${h.calls.join(",")}`);
}

export async function assertDisabledScheduleIsSkipped(): Promise<void> {
  const h = harness({ schedule: schedule({ enabled: false }) });
  const outcome = await render(h);
  assert(outcome.kind === "skipped" && outcome.reason === "disabled", `expected skipped/disabled, got ${JSON.stringify(outcome)}`);
}

export async function assertDisabledScheduleWritesNothing(): Promise<void> {
  const h = harness({ schedule: schedule({ enabled: false }) });
  await render(h);
  assert(h.putKeys.length === 0 && h.reports.calls.length === 0 && h.inserted.length === 0, `expected no put, render or insert, got ${h.calls.join(",")}`);
}

export async function assertAssetsResolveOnTheTransaction(): Promise<void> {
  const h = harness();
  await render(h);
  assert(h.calls.includes("tx:selectAssets"), `expected the asset select on the tx fake, got ${h.calls.join(",")}`);
}

/** The structural positive control for the row above: the service injects no fleet handle — slot 1 is the storage client. */
export function assertStorageClientIsSlotOne(): void {
  const deps =
    (Reflect.getMetadata("self:paramtypes", ReportRenderService) as { index: number; param: unknown }[] | undefined) ?? [];
  assert(deps.find((d) => d.index === 1)?.param === STORAGE_CLIENT, "expected STORAGE_CLIENT in constructor slot 1");
}

export async function assertEmptyLocationIdsSelectsEveryAsset(): Promise<void> {
  const h = harness({ schedule: schedule({ locationIds: [] }) });
  await render(h);
  assert(h.assetWheres.length === 1 && h.assetWheres[0]?.sql === "", `expected an unfiltered asset select, got ${JSON.stringify(h.assetWheres)}`);
}

export async function assertNamedLocationsFilterTheAssets(): Promise<void> {
  const h = harness({ schedule: schedule({ locationIds: [WC, OTHER_LOCATION] }) });
  await render(h);
  const where = h.assetWheres[0];
  assert(
    where !== undefined &&
      /"location_id" in \(\$1, \$2\)/.test(where.sql) &&
      where.params.length === 2 &&
      where.params.includes(WC) &&
      where.params.includes(OTHER_LOCATION),
    `expected location_id in ($1, $2) bound to the two location ids, got ${JSON.stringify(where)}`,
  );
}

export async function assertTheRenderReceivesTheResolvedAssetIds(): Promise<void> {
  const h = harness({ assets: [ASSET_B] });
  await render(h);
  const first = h.reports.calls[0];
  assert(
    first?.method === "energyPdf" && JSON.stringify(first.assetIds) === JSON.stringify([ASSET_B]) && JSON.stringify(first.query) === JSON.stringify({ startDate: "2026-09-01", endDate: "2026-09-07" }),
    `expected energyPdf with the period and the resolved asset ids, got ${JSON.stringify(first)}`,
  );
}

// ---------------------------------------------------------------------------
// Phase A — files, objects, rows
// ---------------------------------------------------------------------------

export async function assertRendersOneFileAndObjectPerFormat(): Promise<void> {
  const h = harness();
  const outcome = rendered(await render(h));
  assert(h.putKeys.length === 2 && h.inserted.length === 2 && outcome.written === 2, `expected two puts and two inserts, got puts=${h.putKeys.length} inserts=${h.inserted.length} written=${outcome.written}`);
}

export async function assertObjectThenRowPerFormatThenPrune(): Promise<void> {
  const h = harness();
  await render(h);
  const expected = ["tx:selectSchedule", "tx:selectAssets", "tx:uniqueCheck", "render", "putObject", "tx:insert", "tx:uniqueCheck", "render", "putObject", "tx:insert", "tx:pruneSelect"];
  assert(JSON.stringify(h.calls) === JSON.stringify(expected), `expected ${expected.join(",")}, got ${h.calls.join(",")}`);
}

export async function assertInsertsCarryCreatedByNull(): Promise<void> {
  const h = harness();
  await render(h);
  assert(h.inserted.length === 2 && h.inserted.every((row) => row.createdBy === null), `expected createdBy === null on both rows, got ${JSON.stringify(h.inserted.map((r) => r.createdBy))}`);
}

export async function assertInsertsCarryTheScheduleIdAndCopiedLocationIds(): Promise<void> {
  const h = harness({ schedule: schedule({ locationIds: [WC] }) });
  await render(h);
  assert(
    h.inserted.every((row) => row.scheduleId === SCHEDULE_ID && JSON.stringify(row.locationIds) === JSON.stringify([WC]) && row.deliveryStatus === "none" && row.templateId === "energy_consumption"),
    `expected scheduleId, the copied location_ids, delivery none and the template on both rows, got ${JSON.stringify(h.inserted)}`,
  );
}

export async function assertTheFilenameComesFromTheDatesAndTheFormat(): Promise<void> {
  const h = harness();
  await render(h);
  assert(
    h.inserted[0]?.filename === "energy-consumption-2026-09-01-to-2026-09-07.pdf" && h.inserted[1]?.filename === "energy-consumption-2026-09-01-to-2026-09-07.xlsx",
    `expected the two date-and-format filenames, got ${JSON.stringify(h.inserted.map((r) => r.filename))}`,
  );
}

export async function assertTheKeyIsBuiltFromTheOrganizationAndTheRowId(): Promise<void> {
  const h = harness();
  await render(h);
  assert(
    h.inserted.every((row, i) => row.objectKey === h.putKeys[i] && row.objectKey === buildReportObjectKey({ organizationId: ORG_ID, fileId: String(row.id) })),
    `expected each row's objectKey to be the put key built from the org and the row id, got ${JSON.stringify(h.inserted.map((r) => r.objectKey))} vs ${JSON.stringify(h.putKeys)}`,
  );
}

export async function assertHashAndSizeComeFromTheBuffer(): Promise<void> {
  const h = harness();
  await render(h);
  assert(h.inserted[0]?.byteSize === PDF_BYTES.length && h.inserted[1]?.byteSize === XLSX_BYTES.length, `expected the buffers' lengths, got ${JSON.stringify(h.inserted.map((r) => r.byteSize))}`);
}

/** The positive control that the fixture name was loaded is `outcome.scheduleName`; the claim is that it reaches nothing else. */
export async function assertTheScheduleNameReachesNoValueKeyLogOrFilename(): Promise<void> {
  const h = harness();
  const { result, warns, logs } = await capturingLogs(() => render(h));
  const outcome = rendered(result);
  assert(outcome.scheduleName === SCHEDULE_NAME, "positive control: the outcome must carry the fixture name");
  const surfaces = [
    ...h.inserted.flatMap((row) => Object.values(row).map(String)),
    ...h.putKeys,
    ...warns,
    ...logs,
    ...h.inserted.map((row) => String(row.filename)),
  ];
  const leaked = surfaces.filter((s) => s.includes(SCHEDULE_NAME));
  assert(leaked.length === 0, `the schedule name reached ${leaked.length} surface(s): ${leaked.join(" | ")}`);
}

export async function assertCountsWrittenPdfThenXlsx(): Promise<void> {
  const h = harness();
  await render(h);
  assert(JSON.stringify(h.metrics.written) === JSON.stringify(["pdf", "xlsx"]), `expected countReportFileWritten pdf then xlsx, got ${JSON.stringify(h.metrics.written)}`);
}

export async function assertOnlyTheFormatsTheScheduleNamesAreRendered(): Promise<void> {
  const h = harness({ schedule: schedule({ formats: ["xlsx"] }) });
  await render(h);
  assert(h.putKeys.length === 1 && h.inserted[0]?.format === "xlsx", `expected one xlsx file, got ${JSON.stringify(h.inserted.map((r) => r.format))}`);
}

export async function assertSkipsAFormatWhoseUniqueRowExistsPutsOnlyTheOther(): Promise<void> {
  const h = harness({ existingFormats: ["pdf"] });
  await render(h);
  assert(h.putKeys.length === 1 && h.inserted.length === 1 && h.inserted[0]?.format === "xlsx", `expected one xlsx put and insert, got ${JSON.stringify(h.inserted.map((r) => r.format))}`);
}

export async function assertSkipsAFormatWhoseUniqueRowExistsCountsIt(): Promise<void> {
  const h = harness({ existingFormats: ["pdf"] });
  const outcome = rendered(await render(h));
  assert(outcome.skippedExisting === 1 && outcome.written === 1, `expected skippedExisting=1 written=1, got ${outcome.skippedExisting}/${outcome.written}`);
}

export async function assertTheUniqueCheckNamesScheduleAndPeriodEndAndFormat(): Promise<void> {
  const h = harness({ existingFormats: ["pdf"] });
  await render(h);
  // The fake matched on the format param — so the check carried it; the negative control is that xlsx was not skipped.
  assert(h.metrics.written.length === 1 && h.metrics.written[0] === "xlsx", `expected only xlsx written, got ${JSON.stringify(h.metrics.written)}`);
}

// ---------------------------------------------------------------------------
// Phase A — prune, and the throw
// ---------------------------------------------------------------------------

const OVERFLOW = [
  { prunedId: PRUNED_A, objectKey: KEY_PRUNED_A },
  { prunedId: PRUNED_B, objectKey: KEY_PRUNED_B },
];

export async function assertPrunesTheOverflowRowsInPhaseA(): Promise<void> {
  const h = harness({ overflow: OVERFLOW });
  await render(h);
  const del = h.deleteWheres[0];
  assert(h.deleteWheres.length === 1 && del !== undefined && del.params.includes(PRUNED_A) && del.params.includes(PRUNED_B), `expected one row delete naming both pruned ids, got ${JSON.stringify(h.deleteWheres)}`);
}

export async function assertPrunedKeysAreCarriedInTheOutcome(): Promise<void> {
  const h = harness({ overflow: OVERFLOW });
  const outcome = rendered(await render(h));
  assert(
    outcome.prunedKeys.get(PRUNED_A) === KEY_PRUNED_A && outcome.prunedKeys.get(PRUNED_B) === KEY_PRUNED_B && outcome.prunedKeys.size === 2,
    `expected both pruned keys by file id, got ${JSON.stringify([...outcome.prunedKeys])}`,
  );
}

export async function assertRenderDeletesNoObject(): Promise<void> {
  const h = harness({ overflow: OVERFLOW });
  await render(h);
  assert(h.deleteKeys.length === 0, `expected no deleteObject in phase A, got ${JSON.stringify(h.deleteKeys)}`);
}

export async function assertNoOverflowMeansNoRowDelete(): Promise<void> {
  const h = harness({ overflow: [] });
  await render(h);
  assert(h.deleteWheres.length === 0, `expected no row delete, got ${h.deleteWheres.length}`);
}

export async function assertAThrowAfterAPutDiscardsThisRunsObjects(): Promise<void> {
  const h = harness({ insertErrorAt: 1 });
  await captureRejection(() => render(h));
  assert(JSON.stringify(h.deleteKeys) === JSON.stringify(h.putKeys) && h.putKeys.length === 2, `expected the two put keys deleted, got puts=${JSON.stringify(h.putKeys)} deletes=${JSON.stringify(h.deleteKeys)}`);
}

export async function assertAThrowAfterAPutRethrows(): Promise<void> {
  const h = harness({ insertErrorAt: 1 });
  const err = await captureRejection(() => render(h));
  assert(errorName(err) === "InsertFailure", `expected the insert's own error, got ${errorName(err)}`);
}

export async function assertAThrowWarnsWithTheScheduleIdAndErrNameNeverTheKey(): Promise<void> {
  const h = harness({ insertErrorAt: 1 });
  const { warns } = await capturingLogs(() => captureRejection(() => render(h)));
  assert(
    warns.length === 1 && warns[0]!.includes(SCHEDULE_ID) && warns[0]!.includes("InsertFailure") && !warns[0]!.includes(OBJECT_KEY_PREFIX),
    `expected one warn with the schedule id and err.name and no key, got ${JSON.stringify(warns)}`,
  );
}
