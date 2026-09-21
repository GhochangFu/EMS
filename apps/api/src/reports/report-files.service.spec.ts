import { Logger } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { vi } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { MasterDataAuditService, AuditInput } from "../admin/master-data-audit.service";
import type { AccessControlService } from "../auth/access-control.service";
import { buildReportObjectKey, OBJECT_KEY_PREFIX } from "../storage/object-key";
import type { S3Ops, StorageClient } from "../storage/storage-client";
import { ReportFilesService } from "./report-files.service";
import type { SaveEnergyReportFileBody } from "./report-files.service";
import type { ReportsService } from "./reports.service";

/**
 * `F3.5a` (ADR 0071 decisions 4–6, 11; Amendment 1 items 1–3) —
 * `ReportFilesService` over fakes. Assertions live here;
 * `report-files.service.test.ts` is the Vitest entry point (§4.6/ADR 0014).
 *
 * The fakes follow `asset-images-write.service.spec.ts`: pool fakes
 * dispatched on the `select` projection's shape, an in-memory `S3Ops`
 * recording every call into **one** ordered `calls` list shared with the
 * tenant fake's `tx:begin`/`tx:commit` entries and the advisory-lock
 * `execute`, so "put, then lock, then count, then insert, then audit, then
 * commit" is a deep-equal on that list. The `list` rows capture the `where`
 * argument and render it through `PgDialect` — no database — so the
 * location predicate's presence per scope kind is asserted on SQL text.
 *
 * `AccessControlService` is a per-row fake whose every call is recorded, so
 * "the render receives `readableAssetIdsInOrganization`'s array and never
 * `readableAssetIds`'s" is an assertion on the fake, not on a comment.
 * `Logger.prototype.warn` is spied and restored in `finally`; errors are
 * matched on `err.name`.
 */

export const ORG_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_ORG_ID = "12121212-1212-4121-8121-121212121212";
export const WC = "22222222-2222-4222-8222-222222222222";
export const OTHER_LOCATION = "23232323-2323-4232-8232-232323232323";
export const FOREIGN_LOCATION = "24242424-2424-4242-8242-242424242424";
export const FILE_ID = "33333333-3333-4333-8333-333333333333";
export const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
const ASSET_A = "66666666-6666-4666-8666-666666666666";
const ASSET_B = "67676767-6767-4676-8676-676767676767";
const ASSET_FOREIGN = "68686868-6868-4686-8686-686868686868";
const CREATED_AT = new Date("2026-09-21T10:00:00.000Z");
const CAP = 50;
export const JWT: JwtPayload = { sub: ACTOR_ID, email: "admin@bms.local", name: "Admin", role: "admin" };
const PDF_BYTES = Buffer.from("%PDF-1.4 fake report bytes");
const XLSX_BYTES = Buffer.from("PK fake workbook bytes");
const PDF_TYPE = "application/pdf";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A key whose last segment is deliberately not `FILE_ID`, so "names the id" and "never the key" stay two claims. */
const FIXTURE_KEY = buildReportObjectKey({ organizationId: ORG_ID, fileId: OTHER_LOCATION });

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { name?: unknown }).name?.toString() : undefined;
}

function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : "";
}

function namedError(name: string): Error {
  // The message carries a key, so a warn that quoted `err.message` reddens the leak rows.
  const err = new Error(`fake ${name}: ${FIXTURE_KEY}`);
  err.name = name;
  return err;
}

async function capturingWarns<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[] }> {
  const warns: string[] = [];
  const spy = vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
    warns.push(String(message));
  });
  try {
    const result = await fn();
    return { result, warns };
  } finally {
    spy.mockRestore();
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

type ReadScope = Awaited<ReturnType<AccessControlService["reportFileReadScope"]>>;

export type StoredRowFixture = {
  id: string;
  organizationId: string;
  templateId: string;
  format: string;
  periodStart: string;
  periodEnd: string;
  locationIds: string[];
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  filename: string;
  deliveryStatus: string;
  deliveryError: string | null;
  createdBy: string | null;
  createdAt: Date;
};

export function storedRow(overrides: Partial<StoredRowFixture> = {}): StoredRowFixture {
  return {
    id: FILE_ID,
    organizationId: ORG_ID,
    templateId: "energy_consumption",
    format: "pdf",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-07",
    locationIds: [],
    objectKey: FIXTURE_KEY,
    contentType: PDF_TYPE,
    byteSize: PDF_BYTES.length,
    sha256: createHash("sha256").update(PDF_BYTES).digest("hex"),
    filename: "energy-consumption-2026-09-01-to-2026-09-07.pdf",
    deliveryStatus: "none",
    deliveryError: null,
    createdBy: ACTOR_ID,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

export type Scenario = {
  client?: StorageClient;
  /** The `AccessControlService` answers. Defaults are the global admin's. */
  writableLocationIds?: string[] | null;
  writableOrganizationIds?: string[] | null;
  /** Whether the fleet `{ organizationId }` existence read finds the body's organization; default true. */
  organizationExists?: boolean;
  readScope?: ReadScope;
  readableInOrganization?: string[];
  canRead?: boolean;
  /** The organization's locations, as the fleet `{ locationId }` read answers. */
  organizationLocations?: string[];
  fleetCount?: number;
  /** The fleet count rows verbatim — the one way to reach a non-numeric count. */
  fleetCountRows?: { count: unknown }[];
  /** The committed-row re-check's answer; default empty (the row really rolled back). */
  committedRows?: { fileId: string }[];
  committedCheckError?: Error;
  txCount?: number;
  insertError?: Error;
  /** The rows the by-id fleet read (download/remove) and the list select answer with. */
  fileRows?: StoredRowFixture[];
  deleteRows?: { objectKey: string }[];
  putObject?: () => Promise<void>;
  getObject?: () => Promise<{ body: Readable; contentLength: number | null } | null>;
  deleteObject?: () => Promise<void>;
};

export type Harness = {
  service: ReportFilesService;
  calls: string[];
  putKeys: string[];
  deleteKeys: string[];
  inserted: Record<string, unknown>[];
  executed: string[];
  /** The `where` argument of every list select, rendered to SQL text (`""` when absent). */
  listWheres: { sql: string; params: unknown[] }[];
  access: { calls: string[]; renderedAssetIds: unknown[] };
  reports: { calls: { method: string; query: unknown; assetIds: unknown }[] };
  tenantTransactions: () => number;
  audit: { inputs: AuditInput[]; executors: unknown[] };
  tx: object;
};

const dialect = new PgDialect();

function renderWhere(arg: unknown): { sql: string; params: unknown[] } {
  if (arg === undefined) return { sql: "", params: [] };
  const query = dialect.sqlToQuery(arg as SQL);
  return { sql: query.sql, params: query.params };
}

export function harness(scenario: Scenario = {}): Harness {
  const calls: string[] = [];
  const putKeys: string[] = [];
  const deleteKeys: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const executed: string[] = [];
  const listWheres: { sql: string; params: unknown[] }[] = [];
  let tenantTransactions = 0;
  const fileRows = scenario.fileRows ?? [];

  const rowSelect = (projection?: Record<string, unknown>, executor = "tx") => {
    const shape = shapeOf(projection);
    let whereArg: unknown;
    return chain(
      async () => {
        if (shape === "count") {
          if (executor === "fleet") return scenario.fleetCountRows ?? [{ count: scenario.fleetCount ?? 0 }];
          return [{ count: scenario.txCount ?? 0 }];
        }
        if (shape.includes("objectKey")) {
          if (executor !== "fleet-by-id") listWheres.push(renderWhere(whereArg));
          return fileRows;
        }
        throw new Error(`${executor} fake: unexpected select shape ${shape}`);
      },
      (method, args) => {
        if (method === "where") whereArg = args[0];
        if (executor === "fleet-by-id" && method === "where") calls.push("fleet:readById");
      },
    );
  };

  const fleet = {
    select: (projection?: Record<string, unknown>) => {
      const shape = shapeOf(projection);
      if (shape === "locationId") {
        return chain(async () =>
          (scenario.organizationLocations ?? [WC, OTHER_LOCATION]).map((locationId) => ({ locationId })),
        );
      }
      if (shape === "actorId") return chain(async () => [{ actorId: ACTOR_ID }]);
      if (shape === "organizationId") {
        return chain(async () => {
          calls.push("fleet:organizationExists");
          return scenario.organizationExists === false ? [] : [{ organizationId: ORG_ID }];
        });
      }
      if (shape === "fileId") {
        return chain(async () => {
          calls.push("fleet:committedCheck");
          if (scenario.committedCheckError) throw scenario.committedCheckError;
          return scenario.committedRows ?? [];
        });
      }
      if (shape === "count") {
        return rowSelect(projection, "fleet");
      }
      return rowSelect(projection, "fleet-by-id");
    },
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      calls.push("fleetTx:begin");
      const result = await fn(tx);
      calls.push("fleetTx:commit");
      return result;
    },
  } as unknown as BmsDb;

  const tx = {
    execute: async (statement: unknown) => {
      const rendered = renderWhere(statement).sql;
      executed.push(rendered);
      calls.push(rendered.includes("pg_advisory_xact_lock") ? "tx:advisoryLock" : rendered.includes("set_config") ? "tx:setTenant" : "tx:execute");
      return undefined;
    },
    select: (projection?: Record<string, unknown>) => {
      if (shapeOf(projection) === "count") calls.push("tx:count");
      return rowSelect(projection, "tx");
    },
    insert: () => {
      let values: Record<string, unknown> = {};
      return chain(
        async () => {
          calls.push("tx:insert");
          if (scenario.insertError) throw scenario.insertError;
          return [{ ...values, createdAt: CREATED_AT }];
        },
        (method, args) => {
          if (method === "values") {
            values = args[0] as Record<string, unknown>;
            inserted.push(values);
          }
        },
      );
    },
    delete: () =>
      chain(async () => {
        calls.push("tx:delete");
        return scenario.deleteRows ?? [];
      }),
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
    throw new Error(`${name} must not be called by the report file paths`);
  };
  const ops: S3Ops = {
    headBucket: unreachable("headBucket") as S3Ops["headBucket"],
    createBucket: unreachable("createBucket"),
    putObject: async (_bucket, key) => {
      calls.push("putObject");
      putKeys.push(key);
      await (scenario.putObject ?? (async () => undefined))();
    },
    getObject: async () => {
      calls.push("getObject");
      return (scenario.getObject ?? (async () => ({ body: Readable.from([PDF_BYTES]), contentLength: PDF_BYTES.length })))();
    },
    headObject: unreachable("headObject") as S3Ops["headObject"],
    deleteObject: async (_bucket, key) => {
      calls.push("deleteObject");
      deleteKeys.push(key);
      await (scenario.deleteObject ?? (async () => undefined))();
    },
  };
  const client: StorageClient = scenario.client ?? { kind: "configured", bucket: "bms-asset-images", ops };

  const access = { calls: [] as string[], renderedAssetIds: [] as unknown[] };
  const accessFake = {
    writableLocationIds: async () => {
      access.calls.push("writableLocationIds");
      return scenario.writableLocationIds === undefined ? null : scenario.writableLocationIds;
    },
    writableOrganizationIds: async () => {
      access.calls.push("writableOrganizationIds");
      return scenario.writableOrganizationIds === undefined ? null : scenario.writableOrganizationIds;
    },
    reportFileReadScope: async () => {
      access.calls.push("reportFileReadScope");
      return scenario.readScope ?? { kind: "global" };
    },
    readableAssetIdsInOrganization: async () => {
      access.calls.push("readableAssetIdsInOrganization");
      return scenario.readableInOrganization ?? [ASSET_A, ASSET_B];
    },
    readableAssetIds: async () => {
      access.calls.push("readableAssetIds");
      return [ASSET_A, ASSET_B, ASSET_FOREIGN];
    },
    canReadReportFile: async () => {
      access.calls.push("canReadReportFile");
      return scenario.canRead ?? true;
    },
  } as unknown as AccessControlService;

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
  } as unknown as ReportsService;

  const audit = { inputs: [] as AuditInput[], executors: [] as unknown[] };
  const auditFake = {
    write: async (input: AuditInput, executor: unknown) => {
      calls.push("audit");
      audit.inputs.push(input);
      audit.executors.push(executor);
    },
  } as unknown as MasterDataAuditService;

  const service = new ReportFilesService(tenant, fleet, client, { onDemandCap: CAP }, reportsFake, accessFake, auditFake);
  return {
    service,
    calls,
    putKeys,
    deleteKeys,
    inserted,
    executed,
    listWheres,
    access,
    reports,
    tenantTransactions: () => tenantTransactions,
    audit,
    tx,
  };
}

const UNCONFIGURED: StorageClient = { kind: "unconfigured" };
const BODY: SaveEnergyReportFileBody = { startDate: "2026-09-01", endDate: "2026-09-07", format: "pdf", organizationId: ORG_ID };

const LOCATION_ADMIN: Scenario = {
  writableLocationIds: [WC, FOREIGN_LOCATION],
  writableOrganizationIds: [ORG_ID],
  readScope: { kind: "location", organizationIds: [ORG_ID], locationIds: [WC, FOREIGN_LOCATION] },
  organizationLocations: [WC, OTHER_LOCATION],
};

const ORGANIZATION_ADMIN: Scenario = {
  writableLocationIds: [WC, OTHER_LOCATION],
  writableOrganizationIds: [ORG_ID],
  readScope: { kind: "organization", organizationIds: [ORG_ID] },
};

function save(h: Harness, body: SaveEnergyReportFileBody = BODY) {
  return h.service.saveOnDemand(JWT, body);
}

async function saveRejecting(scenario: Scenario, body: SaveEnergyReportFileBody = BODY) {
  const h = harness(scenario);
  const { result: err, warns } = await capturingWarns(() => captureRejection(() => save(h, body)));
  return { err, warns, h };
}

// ---------------------------------------------------------------------------
// The gate and the cap
// ---------------------------------------------------------------------------

export async function assertUnconfiguredRefusesBeforeAnyStorageCall(): Promise<void> {
  const { err, h } = await saveRejecting({ client: UNCONFIGURED });
  assert(errorName(err) === "ServiceUnavailableException", `unconfigured save threw ${errorName(err)}: ${errorMessage(err)}`);
  assert(!h.calls.includes("putObject"), `unconfigured save reached storage: ${h.calls.join(",")}`);
}

export async function assertUnconfiguredRefusesBeforeTheRoleGate(): Promise<void> {
  const { h } = await saveRejecting({ client: UNCONFIGURED });
  assert(h.access.calls.length === 0, `the storage gate is not first: access control saw ${h.access.calls.join(",")}`);
}

export async function assertRefusesAtTheCapBeforeTheRender(): Promise<void> {
  const { err, h } = await saveRejecting({ fleetCount: CAP });
  assert(errorName(err) === "ConflictException", `a count of ${CAP} threw ${errorName(err)}: ${errorMessage(err)}`);
  assert(
    h.reports.calls.length === 0 && !h.calls.includes("putObject"),
    `the cap refusal came after work: renders ${h.reports.calls.length}, calls ${h.calls.join(",")}`,
  );
}

/** Positive control for the cap row: one under the cap admits. */
export async function assertOneUnderTheCapAdmits(): Promise<void> {
  const h = harness({ fleetCount: CAP - 1, txCount: CAP - 1 });
  const dto = await save(h);
  assert(dto.byteSize === PDF_BYTES.length, `a count of ${CAP - 1} did not admit`);
}

export async function assertCapFailsClosedOnANonNumericCount(): Promise<void> {
  const { err, h } = await saveRejecting({ fleetCountRows: [{ count: "not a number" }] });
  assert(
    errorName(err) === "ConflictException" && h.reports.calls.length === 0,
    `a NaN count threw ${errorName(err)} after ${h.reports.calls.length} renders — the compare admits a non-number`,
  );
}

// ---------------------------------------------------------------------------
// Amendment 1 item 1 — the organization
// ---------------------------------------------------------------------------

export async function assertGlobalAdminMustNameTheOrganization(): Promise<void> {
  const { err } = await saveRejecting({}, { ...BODY, organizationId: undefined });
  assert(
    errorName(err) === "BadRequestException" && errorMessage(err).includes("organizationId"),
    `a global admin without a body id got ${errorName(err)}: ${errorMessage(err)}`,
  );
}

export async function assertGlobalAdminProceedsWithTheOrganization(): Promise<void> {
  const h = harness({});
  const dto = await save(h);
  assert(dto.organizationId === ORG_ID, `the row carries ${dto.organizationId}, not the body's organization`);
}

/**
 * U8 (plan gap): a well-formed uuid naming no organization is the caller's
 * 404, before the stamp, the cap pre-check and any storage call — not the FK
 * failure at insert time that `putObject` would otherwise precede. The
 * positive control is `assertGlobalAdminProceedsWithTheOrganization`, whose
 * fake answers the existence read with the row.
 */
export async function assertGlobalAdminNamingAnUnknownOrganizationIs404BeforeAnyWork(): Promise<void> {
  const { err, h } = await saveRejecting({ organizationExists: false });
  assert(
    errorName(err) === "NotFoundException" && errorMessage(err) === "Organization not found",
    `an unknown organization got ${errorName(err)}: ${errorMessage(err)}`,
  );
  assert(h.calls.includes("fleet:organizationExists"), `the existence read did not run: ${h.calls.join(",")}`);
  assert(
    h.calls.filter((c) => c === "putObject").length === 0 && h.reports.calls.length === 0 && !h.calls.includes("tx:begin"),
    `the 404 came after work: calls ${h.calls.join(",")}, renders ${h.reports.calls.length}`,
  );
}

export async function assertSingleOrganizationAdminNeedsNoBodyId(): Promise<void> {
  const h = harness(ORGANIZATION_ADMIN);
  const dto = await save(h, { ...BODY, organizationId: undefined });
  assert(dto.organizationId === ORG_ID, `the single organization was not resolved: ${dto.organizationId}`);
}

export async function assertAForeignBodyIdIs403(): Promise<void> {
  const { err, h } = await saveRejecting(ORGANIZATION_ADMIN, { ...BODY, organizationId: OTHER_ORG_ID });
  assert(
    errorName(err) === "ForbiddenException" && h.reports.calls.length === 0,
    `a foreign body id got ${errorName(err)} after ${h.reports.calls.length} renders`,
  );
}

export async function assertSeveralOrganizationsRequireTheBodyId(): Promise<void> {
  const { err } = await saveRejecting(
    { ...ORGANIZATION_ADMIN, writableOrganizationIds: [ORG_ID, OTHER_ORG_ID] },
    { ...BODY, organizationId: undefined },
  );
  const message = errorMessage(err);
  assert(
    errorName(err) === "BadRequestException" && message.includes("2") && !message.includes(ORG_ID),
    `several organizations without a body id got ${errorName(err)}: ${message}`,
  );
}

export async function assertNoOrganizationIs403(): Promise<void> {
  const { err } = await saveRejecting({ ...ORGANIZATION_ADMIN, writableOrganizationIds: [] });
  assert(errorName(err) === "ForbiddenException", `zero organizations got ${errorName(err)}: ${errorMessage(err)}`);
}

// ---------------------------------------------------------------------------
// Amendment 1 item 2 — the location_ids stamp
// ---------------------------------------------------------------------------

export async function assertOrganizationAdminStampsTheEmptyArray(): Promise<void> {
  const h = harness(ORGANIZATION_ADMIN);
  const dto = await save(h, { ...BODY, organizationId: undefined });
  assert(
    dto.locationIds.length === 0,
    `an organization admin stamped ${JSON.stringify(dto.locationIds)} instead of {} (Amendment 1 item 2)`,
  );
}

export async function assertLocationAdminStampsTheIntersection(): Promise<void> {
  const h = harness(LOCATION_ADMIN);
  const dto = await save(h, { ...BODY, organizationId: undefined });
  assert(
    JSON.stringify(dto.locationIds) === JSON.stringify([WC]),
    `a location admin stamped ${JSON.stringify(dto.locationIds)}; expected exactly [WC] — the foreign location leaked or the own one was dropped`,
  );
}

export async function assertLocationAdminWithNoIntersectionIs403(): Promise<void> {
  const { err, h } = await saveRejecting({ ...LOCATION_ADMIN, organizationLocations: [OTHER_LOCATION] });
  assert(
    errorName(err) === "ForbiddenException" && h.reports.calls.length === 0,
    `an empty intersection got ${errorName(err)} after ${h.reports.calls.length} renders`,
  );
}

// ---------------------------------------------------------------------------
// The render, the hash, the object and the row
// ---------------------------------------------------------------------------

export async function assertRendersUnderTheOrganizationScopedAssetIds(): Promise<void> {
  const h = harness({ readableInOrganization: [ASSET_B] });
  await save(h);
  const [call] = h.reports.calls;
  assert(
    call !== undefined && JSON.stringify(call.assetIds) === JSON.stringify([ASSET_B]),
    `the render received ${JSON.stringify(call?.assetIds)}; expected readableAssetIdsInOrganization's [ASSET_B]`,
  );
}

export async function assertTheRenderNeverReadsTheUnscopedAssetIds(): Promise<void> {
  const h = harness({});
  await save(h);
  assert(!h.access.calls.includes("readableAssetIds"), `the save path called readableAssetIds: ${h.access.calls.join(",")}`);
}

export async function assertTheRenderReceivesTheBodyRange(): Promise<void> {
  const h = harness({});
  await save(h);
  const [call] = h.reports.calls;
  assert(
    call?.method === "energyPdf" && JSON.stringify(call.query) === JSON.stringify({ startDate: "2026-09-01", endDate: "2026-09-07" }),
    `the render received ${call?.method} ${JSON.stringify(call?.query)}`,
  );
}

export async function assertHashAndSizeComeFromThePdfBuffer(): Promise<void> {
  const dto = await save(harness({}));
  const expected = createHash("sha256").update(PDF_BYTES).digest("hex");
  assert(
    dto.sha256 === expected && dto.byteSize === PDF_BYTES.length,
    `pdf sha256 ${dto.sha256} / byteSize ${dto.byteSize}; expected ${expected} / ${PDF_BYTES.length}`,
  );
}

export async function assertPdfFilenameAndContentType(): Promise<void> {
  const dto = await save(harness({}));
  assert(
    dto.filename === "energy-consumption-2026-09-01-to-2026-09-07.pdf" && dto.contentType === PDF_TYPE,
    `pdf filename ${dto.filename}, contentType ${dto.contentType}`,
  );
}

export async function assertXlsxHashSizeFilenameAndContentType(): Promise<void> {
  const h = harness({});
  const dto = await save(h, { ...BODY, format: "xlsx" });
  const expected = createHash("sha256").update(XLSX_BYTES).digest("hex");
  assert(
    dto.sha256 === expected &&
      dto.byteSize === XLSX_BYTES.length &&
      dto.filename === "energy-consumption-2026-09-01-to-2026-09-07.xlsx" &&
      dto.contentType === XLSX_TYPE &&
      h.reports.calls[0]?.method === "energyXlsx",
    `xlsx: sha256 ${dto.sha256}, byteSize ${dto.byteSize}, filename ${dto.filename}, contentType ${dto.contentType}, renderer ${h.reports.calls[0]?.method}`,
  );
}

export async function assertPutsTheObjectThenInsertsTheRowUnderTheTenant(): Promise<void> {
  const h = harness({});
  await save(h);
  // U8: the global admin's organization existence read precedes the render (the 404 before any work).
  const expected = ["fleet:organizationExists", "render", "putObject", "tx:begin", "tx:setTenant", "tx:advisoryLock", "tx:count", "tx:insert", "audit", "tx:commit"];
  assert(
    JSON.stringify(h.calls) === JSON.stringify(expected),
    `call order ${JSON.stringify(h.calls)}; expected ${JSON.stringify(expected)}`,
  );
}

export async function assertTheKeyIsBuiltFromTheOrganizationAndTheFileId(): Promise<void> {
  const h = harness({});
  const dto = await save(h);
  const expected = buildReportObjectKey({ organizationId: ORG_ID, fileId: dto.id });
  assert(
    h.putKeys.length === 1 && h.putKeys[0] === expected && h.inserted[0]?.objectKey === expected,
    `put key ${h.putKeys[0]} / row key ${String(h.inserted[0]?.objectKey)}; expected ${expected}`,
  );
}

export async function assertTheAdvisoryLockNamesTheOrganization(): Promise<void> {
  const h = harness({});
  await save(h);
  const lock = h.executed.find((statement) => statement.includes("pg_advisory_xact_lock"));
  assert(lock !== undefined && lock.includes("hashtextextended"), `no advisory lock statement among ${JSON.stringify(h.executed)}`);
}

export async function assertTheAuditPayloadCarriesIdsAndNumbersOnly(): Promise<void> {
  const h = harness({});
  const dto = await save(h);
  const [input] = h.audit.inputs;
  assert(input !== undefined, "no audit row was written");
  const payload = input.payload ?? {};
  const keys = Object.keys(payload).sort().join(",");
  assert(
    input.action === "report_file.create" &&
      input.entityType === "report_file" &&
      input.entityId === dto.id &&
      input.organizationId === ORG_ID &&
      keys === "byteSize,fileId,format,organizationId,periodEnd,periodStart,sha256" &&
      !Object.values(payload).includes(dto.filename) &&
      h.audit.executors[0] === h.tx,
    `audit ${input.action} ${input.entityType} org ${input.organizationId} keys ${keys} executor-is-tx ${h.audit.executors[0] === h.tx}`,
  );
}

export async function assertAFailedPutIs503WithOneWarnNamingTheId(): Promise<void> {
  const { err, warns, h } = await saveRejecting({ putObject: async () => { throw namedError("NetworkingError"); } });
  assert(errorName(err) === "ServiceUnavailableException", `a failed put threw ${errorName(err)}`);
  assert(h.tenantTransactions() === 0, `a failed put still opened ${h.tenantTransactions()} tenant transactions`);
  assert(
    warns.length === 1 && warns[0]!.includes("NetworkingError") && !warns[0]!.includes(OBJECT_KEY_PREFIX),
    `warns ${JSON.stringify(warns)}`,
  );
}

// ---------------------------------------------------------------------------
// R-12 — discard only when the row is proved absent
// ---------------------------------------------------------------------------

export async function assertAFailedRowDiscardsTheObjectWhenTheRowIsAbsent(): Promise<void> {
  const { err, h } = await saveRejecting({ insertError: namedError("InsertFailed") });
  assert(errorName(err) === "InsertFailed", `the original error was replaced by ${errorName(err)}`);
  assert(
    h.calls.includes("fleet:committedCheck") && h.deleteKeys.length === 1 && h.deleteKeys[0] === h.putKeys[0],
    `absent row: committed check ${h.calls.includes("fleet:committedCheck")}, deletes ${JSON.stringify(h.deleteKeys)}`,
  );
}

export async function assertAFailedRowKeepsTheObjectWhenTheRowCommitted(): Promise<void> {
  const { warns, h } = await saveRejecting({
    insertError: namedError("ConnectionDropped"),
    committedRows: [{ fileId: FILE_ID }],
  });
  assert(
    h.deleteKeys.length === 0,
    `the row committed and the object was still discarded (${h.deleteKeys.length} deletes) — the re-read is missing`,
  );
  assert(
    warns.length === 1 && warns[0]!.includes("row committed") && !warns[0]!.includes(OBJECT_KEY_PREFIX),
    `warns ${JSON.stringify(warns)}`,
  );
}

export async function assertAFailedReCheckKeepsTheObject(): Promise<void> {
  const { warns, h } = await saveRejecting({
    insertError: namedError("InsertFailed"),
    committedCheckError: namedError("PoolExhausted"),
  });
  assert(h.deleteKeys.length === 0 && warns.some((w) => w.includes("PoolExhausted")), `deletes ${h.deleteKeys.length}, warns ${JSON.stringify(warns)}`);
}

export async function assertACleanupFailureWarnsWithoutTheKey(): Promise<void> {
  const { warns, h } = await saveRejecting({
    insertError: namedError("InsertFailed"),
    deleteObject: async () => { throw namedError("AccessDenied"); },
  });
  const fileId = h.putKeys[0]!.split("/").pop();
  assert(
    warns.length === 1 && warns[0]!.includes("AccessDenied") && warns[0]!.includes(String(fileId)) && !warns[0]!.includes(OBJECT_KEY_PREFIX),
    `warns ${JSON.stringify(warns)}`,
  );
}

export async function assertDtoNeverCarriesObjectKey(): Promise<void> {
  const h = harness({});
  const dto = await save(h);
  assert(!("objectKey" in dto), "the DTO carries objectKey");
  assert(dto.id === h.inserted[0]?.id, `positive control: dto.id ${dto.id} is not the inserted id`);
}

// ---------------------------------------------------------------------------
// list — the location predicate only for the location kind, on both branches
// ---------------------------------------------------------------------------

export async function assertGlobalAdminListHasNoPredicate(): Promise<void> {
  const h = harness({ readScope: { kind: "global" } });
  await h.service.list(JWT, 50);
  assert(
    h.listWheres.length === 1 && h.listWheres[0]!.sql === "" && h.calls.includes("fleetTx:begin"),
    `global list where ${JSON.stringify(h.listWheres)} calls ${h.calls.join(",")}`,
  );
}

export async function assertOrganizationAdminListFiltersByOrganizationOnly(): Promise<void> {
  const h = harness({ readScope: { kind: "organization", organizationIds: [ORG_ID, OTHER_ORG_ID] } });
  await h.service.list(JWT, 50);
  const where = h.listWheres[0]!;
  assert(
    where.sql.includes("organization_id") && !where.sql.includes("cardinality") && !where.sql.includes("<@"),
    `organization-admin list where ${where.sql} — the location predicate must be absent`,
  );
}

export async function assertSingleOrganizationAdminListRunsOnTheTenantWithNoPredicate(): Promise<void> {
  const h = harness({ readScope: { kind: "organization", organizationIds: [ORG_ID] } });
  await h.service.list(JWT, 50);
  assert(
    h.tenantTransactions() === 1 && h.listWheres[0]!.sql === "",
    `single-org list: tenant transactions ${h.tenantTransactions()}, where ${h.listWheres[0]!.sql}`,
  );
}

export async function assertLocationAdminListAppliesThePredicateOnTheTenantBranch(): Promise<void> {
  const h = harness({ readScope: { kind: "location", organizationIds: [ORG_ID], locationIds: [WC] } });
  await h.service.list(JWT, 50);
  const where = h.listWheres[0]!;
  assert(
    h.tenantTransactions() === 1 && where.sql.includes("cardinality") && where.sql.includes("<@"),
    `one-org location admin: tenant transactions ${h.tenantTransactions()}, where ${where.sql}`,
  );
  assert(
    where.params.length === 1 && String(where.params[0]).includes(WC),
    `the writable set is not the <@ parameter (expected one uuid[] literal holding WC): ${JSON.stringify(where.params)}`,
  );
}

export async function assertLocationAdminListAppliesBothPredicatesOnTheFleetBranch(): Promise<void> {
  const h = harness({ readScope: { kind: "location", organizationIds: [ORG_ID, OTHER_ORG_ID], locationIds: [WC] } });
  await h.service.list(JWT, 50);
  const where = h.listWheres[0]!;
  assert(
    h.calls.includes("fleetTx:begin") && where.sql.includes("organization_id") && where.sql.includes("cardinality") && where.sql.includes("<@"),
    `two-org location admin: calls ${h.calls.join(",")}, where ${where.sql}`,
  );
}

export async function assertListMapsRowsThroughTheDto(): Promise<void> {
  const h = harness({ fileRows: [storedRow()] });
  const [dto] = await h.service.list(JWT, 50);
  assert(dto !== undefined && dto.id === FILE_ID && !("objectKey" in dto), `list dto ${JSON.stringify(dto)}`);
}

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

export async function assertDownloadParsesTheRowBeforeOpeningTheObject(): Promise<void> {
  const h = harness({ fileRows: [storedRow({ sha256: "not-hex" })] });
  const err = await captureRejection(() => h.service.download(JWT, FILE_ID));
  assert(
    errorName(err) === "InternalServerErrorException" && !h.calls.includes("getObject"),
    `a contract-breaking row threw ${errorName(err)} after calls ${h.calls.join(",")}`,
  );
}

export async function assertDownloadServesAValidRow(): Promise<void> {
  const h = harness({ fileRows: [storedRow()] });
  const { row, body } = await h.service.download(JWT, FILE_ID);
  assert(row.id === FILE_ID && h.calls.includes("getObject") && body instanceof Readable, `download row ${row.id}, calls ${h.calls.join(",")}`);
}

export async function assertDownloadOfAMissingRowIs404BeforeTheVerdict(): Promise<void> {
  const h = harness({ fileRows: [] });
  const err = await captureRejection(() => h.service.download(JWT, FILE_ID));
  assert(
    errorName(err) === "NotFoundException" && !h.access.calls.includes("canReadReportFile"),
    `a missing row threw ${errorName(err)}; access calls ${h.access.calls.join(",")}`,
  );
}

export async function assertDownloadOutOfScopeIs403WithTheOneSentence(): Promise<void> {
  const h = harness({ fileRows: [storedRow()], canRead: false });
  const err = await captureRejection(() => h.service.download(JWT, FILE_ID));
  assert(
    errorName(err) === "ForbiddenException" && errorMessage(err) === "Report file is outside your access scope" && !h.calls.includes("getObject"),
    `out of scope threw ${errorName(err)}: ${errorMessage(err)}; calls ${h.calls.join(",")}`,
  );
}

export async function assertDownloadRefusesALengthMismatchAndDestroysTheBody(): Promise<void> {
  const body = Readable.from([PDF_BYTES]);
  const destroy = vi.spyOn(body, "destroy");
  const h = harness({ fileRows: [storedRow()], getObject: async () => ({ body, contentLength: PDF_BYTES.length + 1 }) });
  const { result: err, warns } = await capturingWarns(() => captureRejection(() => h.service.download(JWT, FILE_ID)));
  assert(errorName(err) === "NotFoundException", `a length mismatch threw ${errorName(err)}`);
  assert(destroy.mock.calls.length === 1, `body.destroy was called ${destroy.mock.calls.length} times`);
  assert(warns.length === 1 && warns[0]!.includes(FILE_ID) && !warns[0]!.includes(OBJECT_KEY_PREFIX), `warns ${JSON.stringify(warns)}`);
}

export async function assertDownloadOfAMissingObjectIs404(): Promise<void> {
  const h = harness({ fileRows: [storedRow()], getObject: async () => null });
  const { result: err, warns } = await capturingWarns(() => captureRejection(() => h.service.download(JWT, FILE_ID)));
  assert(errorName(err) === "NotFoundException" && warns.length === 1 && warns[0]!.includes(FILE_ID), `missing object: ${errorName(err)}, warns ${JSON.stringify(warns)}`);
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

export async function assertRemoveDeletesTheRowCommitsThenTheObject(): Promise<void> {
  const h = harness({ fileRows: [storedRow()], deleteRows: [{ objectKey: FIXTURE_KEY }] });
  await h.service.remove(JWT, FILE_ID);
  const expected = ["fleet:readById", "tx:begin", "tx:setTenant", "tx:delete", "audit", "tx:commit", "deleteObject"];
  assert(JSON.stringify(h.calls) === JSON.stringify(expected), `remove order ${JSON.stringify(h.calls)}; expected ${JSON.stringify(expected)}`);
  assert(h.deleteKeys[0] === FIXTURE_KEY, `deleted key ${h.deleteKeys[0]}`);
}

export async function assertRemoveAuditsWithIdsOnly(): Promise<void> {
  const h = harness({ fileRows: [storedRow()], deleteRows: [{ objectKey: FIXTURE_KEY }] });
  await h.service.remove(JWT, FILE_ID);
  const [input] = h.audit.inputs;
  const keys = Object.keys(input?.payload ?? {}).sort().join(",");
  assert(
    input?.action === "report_file.delete" && input.organizationId === ORG_ID && keys === "fileId,organizationId" && h.audit.executors[0] === h.tx,
    `delete audit ${input?.action} org ${input?.organizationId} keys ${keys}`,
  );
}

export async function assertRemoveResolvesAndWarnsOnObjectFailure(): Promise<void> {
  const h = harness({
    fileRows: [storedRow()],
    deleteRows: [{ objectKey: FIXTURE_KEY }],
    deleteObject: async () => { throw namedError("AccessDenied"); },
  });
  const { warns } = await capturingWarns(() => h.service.remove(JWT, FILE_ID));
  assert(
    warns.length === 1 && warns[0]!.includes(FILE_ID) && warns[0]!.includes("AccessDenied") && warns[0]!.includes("orphan"),
    `warns ${JSON.stringify(warns)}`,
  );
  assert(!warns[0]!.includes(OBJECT_KEY_PREFIX), `the warn carries the key prefix: ${warns[0]}`);
}

export async function assertRemoveOutOfScopeIs403BeforeAnyWrite(): Promise<void> {
  const h = harness({ fileRows: [storedRow()], canRead: false });
  const err = await captureRejection(() => h.service.remove(JWT, FILE_ID));
  assert(
    errorName(err) === "ForbiddenException" && h.tenantTransactions() === 0 && h.deleteKeys.length === 0,
    `out-of-scope remove threw ${errorName(err)} with ${h.tenantTransactions()} transactions and ${h.deleteKeys.length} deletes`,
  );
}

export async function assertRemoveOfAVanishedRowIs404AndDeletesNoObject(): Promise<void> {
  const h = harness({ fileRows: [storedRow()], deleteRows: [] });
  const err = await captureRejection(() => h.service.remove(JWT, FILE_ID));
  assert(
    errorName(err) === "NotFoundException" && h.deleteKeys.length === 0 && !h.calls.includes("tx:commit"),
    `vanished row threw ${errorName(err)}; deletes ${h.deleteKeys.length}; calls ${h.calls.join(",")}`,
  );
}

/** One method per row, so the failure names which of the three reached access control or resolved. */
async function assertUnconfiguredRefusesBeforeAccessControl(method: string, run: (h: Harness) => Promise<unknown>): Promise<void> {
  const h = harness({ client: UNCONFIGURED });
  const err = await captureRejection(() => run(h));
  assert(
    errorName(err) === "ServiceUnavailableException" && h.access.calls.length === 0,
    `unconfigured ${method}: threw ${errorName(err)}; access calls ${h.access.calls.join(",")}`,
  );
}

export async function assertUnconfiguredListIs503(): Promise<void> {
  await assertUnconfiguredRefusesBeforeAccessControl("list", (h) => h.service.list(JWT, 50));
}

export async function assertUnconfiguredDownloadIs503(): Promise<void> {
  await assertUnconfiguredRefusesBeforeAccessControl("download", (h) => h.service.download(JWT, FILE_ID));
}

export async function assertUnconfiguredRemoveIs503(): Promise<void> {
  await assertUnconfiguredRefusesBeforeAccessControl("remove", (h) => h.service.remove(JWT, FILE_ID));
}
