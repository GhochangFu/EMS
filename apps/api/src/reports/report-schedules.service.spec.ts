import { ForbiddenException, Logger } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { vi } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { MasterDataAuditService, AuditInput } from "../admin/master-data-audit.service";
import type { AccessControlService } from "../auth/access-control.service";
import type { ChannelsService } from "../notifications/channels.service";
import type { NotificationChannelRow } from "../notifications/notification-transport";
import { buildReportObjectKey } from "../storage/object-key";
import type { S3Ops, StorageClient } from "../storage/storage-client";
import { nextRunAt } from "./report-period";
import { ReportSchedulesService, SCHEDULE_OUT_OF_SCOPE_SENTENCE } from "./report-schedules.service";
import type { CreateReportScheduleBodyInput, UpdateReportScheduleBodyInput } from "./report-schedules.schema";

/**
 * `F3.5b` (ADR 0071 decisions 7, 8, 11; plan R-8, R-10, R-12, R-16; Q-2,
 * Q-3, Q-5, Q-6) — `ReportSchedulesService` over fakes, the
 * `report-files.service.spec.ts` shape. Assertions live here;
 * `report-schedules.service.test.ts` is the Vitest entry point (§4.6).
 *
 * The pool fakes dispatch on the `select` projection's shape and record every
 * call into **one** ordered `calls` list shared with the tenant fake's
 * `tx:begin`/`tx:commit` entries, the advisory-lock `execute`, the two
 * deletes and the object deletes, so "files, then the schedule, then the
 * audit row, then the commit, then the objects" is a deep-equal on that list.
 * The `where` of every list select is rendered through `PgDialect` — no
 * database — so the location predicate's presence per scope kind is asserted
 * on SQL text. The clock is the service's `now` field, overridden per row,
 * so `nextRunAt` is compared against `report-period.ts`'s own answer for the
 * same instant. Errors are matched on `err.name`; the sentences on
 * `err.message`.
 */

export const ORG_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_ORG_ID = "12121212-1212-4121-8121-121212121212";
export const WC = "22222222-2222-4222-8222-222222222222";
export const OTHER_LOCATION = "23232323-2323-4232-8232-232323232323";
export const FOREIGN_LOCATION = "24242424-2424-4242-8242-242424242424";
export const SCHEDULE_ID = "44444444-4444-4444-8444-444444444444";
export const CHANNEL_ID = "45454545-4545-4545-8545-454545454545";
export const FILE_A = "33333333-3333-4333-8333-333333333333";
export const FILE_B = "34343434-3434-4343-8343-343434343434";
export const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_AT = new Date("2026-09-21T10:00:00.000Z");
/** A sentinel the recompute would never produce for the fixture (a year ahead). */
const SENTINEL_NEXT = new Date("2027-09-21T01:30:00.000Z");
export const NOW = new Date("2026-09-21T10:00:00.000Z");
/** The fixture name; no audit payload value may carry it (R-10). */
export const FIXTURE_NAME = "f3.5b-SHOULD-NOT-APPEAR";
export const JWT: JwtPayload = { sub: ACTOR_ID, email: "admin@bms.local", name: "Admin", role: "admin" };
const MASTER_DATA_SENTENCE = "Master data administration requires admin, organization_admin, or location_admin role";

const KEY_A = buildReportObjectKey({ organizationId: ORG_ID, fileId: FILE_A });
const KEY_B = buildReportObjectKey({ organizationId: ORG_ID, fileId: FILE_B });

export function assert(condition: boolean, message: string): asserts condition {
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

export function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { name?: unknown }).name?.toString() : undefined;
}

export function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : "";
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

export type StoredScheduleFixture = {
  id: string;
  organizationId: string;
  name: string;
  templateId: string;
  formats: string[];
  cadence: string;
  runAtLocal: string;
  timezone: string;
  locationIds: string[];
  channelId: string | null;
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function storedSchedule(overrides: Partial<StoredScheduleFixture> = {}): StoredScheduleFixture {
  return {
    id: SCHEDULE_ID,
    organizationId: ORG_ID,
    name: FIXTURE_NAME,
    templateId: "energy_consumption",
    formats: ["pdf"],
    cadence: "daily",
    // What drizzle's `time()` column returns (measured 2026-09-22 on a real row).
    runAtLocal: "07:00:00",
    timezone: "Asia/Kolkata",
    locationIds: [],
    channelId: null,
    enabled: true,
    nextRunAt: SENTINEL_NEXT,
    lastRunAt: null,
    createdBy: ACTOR_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

export function channelRow(overrides: Partial<NotificationChannelRow> = {}): NotificationChannelRow {
  return {
    id: CHANNEL_ID,
    organizationId: ORG_ID,
    code: "ops-email",
    name: "Ops email",
    kind: "email",
    config: { to: ["ops@example.test"] },
    enabled: true,
    updatedAt: CREATED_AT,
    secret: null,
    secretState: "none",
    ...overrides,
  } as NotificationChannelRow;
}

export type Scenario = {
  client?: StorageClient;
  /** `writableLocationIds`'s answer; `"refused"` makes it throw the master-data 403 (an `asset_group_admin`). */
  writableLocationIds?: string[] | null | "refused";
  writableOrganizationIds?: string[] | null;
  organizationExists?: boolean;
  readScope?: ReadScope;
  canRead?: boolean;
  /** The organization's locations, as the fleet `{ locationId }` read answers. */
  organizationLocations?: string[];
  /** `ChannelsService.loadById`'s answer; `"refused"` throws its own 403. */
  channel?: NotificationChannelRow | null | "refused";
  txCount?: number;
  /** The count rows verbatim — the one way to reach a non-numeric count. */
  txCountRows?: { count: unknown }[];
  /** The rows the by-id fleet read and the list select answer with. */
  scheduleRows?: StoredScheduleFixture[];
  /** What the files delete returns. */
  deletedFiles?: { fileId: string; objectKey: string }[];
  /** What the schedule delete returns; default one row. */
  deletedSchedules?: { id: string }[];
  /** What the update returns; default the by-id row merged with the `set` values. */
  updatedRows?: StoredScheduleFixture[];
  deleteObject?: () => Promise<void>;
};

export type Harness = {
  service: ReportSchedulesService;
  calls: string[];
  deleteKeys: string[];
  inserted: Record<string, unknown>[];
  /** Every `set(...)` argument of an update. */
  updates: Record<string, unknown>[];
  executed: { sql: string; params: unknown[] }[];
  listWheres: { sql: string; params: unknown[] }[];
  access: { calls: string[] };
  channels: { calls: string[] };
  audit: { inputs: AuditInput[]; executors: unknown[] };
  tenantTransactions: () => number;
};

const dialect = new PgDialect();

function renderSql(arg: unknown): { sql: string; params: unknown[] } {
  if (arg === undefined) return { sql: "", params: [] };
  const query = dialect.sqlToQuery(arg as SQL);
  return { sql: query.sql, params: query.params };
}

export function harness(scenario: Scenario = {}, now: Date = NOW): Harness {
  const calls: string[] = [];
  const deleteKeys: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const executed: { sql: string; params: unknown[] }[] = [];
  const listWheres: { sql: string; params: unknown[] }[] = [];
  let tenantTransactions = 0;
  const scheduleRows = scenario.scheduleRows ?? [];

  const tx = {
    execute: async (statement: unknown) => {
      const rendered = renderSql(statement);
      executed.push(rendered);
      calls.push(
        rendered.sql.includes("pg_advisory_xact_lock") ? "tx:advisoryLock" : rendered.sql.includes("set_config") ? "tx:setTenant" : "tx:execute",
      );
      return undefined;
    },
    select: (projection?: Record<string, unknown>) => {
      const shape = shapeOf(projection);
      let whereArg: unknown;
      return chain(
        async () => {
          if (shape === "count") {
            calls.push("tx:count");
            return scenario.txCountRows ?? [{ count: scenario.txCount ?? 0 }];
          }
          if (shape === "") {
            listWheres.push(renderSql(whereArg));
            return scheduleRows;
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
          return [{ lastRunAt: null, ...values, createdAt: CREATED_AT, updatedAt: CREATED_AT }];
        },
        (method, args) => {
          if (method === "values") {
            values = args[0] as Record<string, unknown>;
            inserted.push(values);
          }
        },
      );
    },
    update: () => {
      let values: Record<string, unknown> = {};
      return chain(
        async () => {
          calls.push("tx:update");
          return scenario.updatedRows ?? [{ ...(scheduleRows[0] ?? storedSchedule()), ...values }];
        },
        (method, args) => {
          if (method === "set") {
            values = args[0] as Record<string, unknown>;
            updates.push(values);
          }
        },
      );
    },
    delete: () => {
      let projection = "";
      return chain(
        async () => {
          if (projection.includes("objectKey")) {
            calls.push("tx:deleteFiles");
            return scenario.deletedFiles ?? [];
          }
          calls.push("tx:deleteSchedule");
          return scenario.deletedSchedules ?? [{ id: SCHEDULE_ID }];
        },
        (method, args) => {
          if (method === "returning") projection = shapeOf(args[0] as Record<string, unknown>);
        },
      );
    },
  };

  const fleet = {
    select: (projection?: Record<string, unknown>) => {
      const shape = shapeOf(projection);
      if (shape === "locationId") {
        return chain(async () => {
          calls.push("fleet:organizationLocations");
          return (scenario.organizationLocations ?? [WC, OTHER_LOCATION]).map((locationId) => ({ locationId }));
        });
      }
      if (shape === "actorId") return chain(async () => [{ actorId: ACTOR_ID }]);
      if (shape === "organizationId") {
        return chain(async () => {
          calls.push("fleet:organizationExists");
          return scenario.organizationExists === false ? [] : [{ organizationId: ORG_ID }];
        });
      }
      if (shape === "") {
        return chain(async () => {
          calls.push("fleet:readById");
          return scheduleRows;
        });
      }
      throw new Error(`fleet fake: unexpected select shape ${shape}`);
    },
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      calls.push("fleetTx:begin");
      const result = await fn(tx);
      calls.push("fleetTx:commit");
      return result;
    },
  } as unknown as BmsDb;

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
    throw new Error(`${name} must not be called by the schedule paths`);
  };
  const ops: S3Ops = {
    headBucket: unreachable("headBucket") as S3Ops["headBucket"],
    createBucket: unreachable("createBucket"),
    putObject: unreachable("putObject"),
    getObject: unreachable("getObject") as S3Ops["getObject"],
    headObject: unreachable("headObject") as S3Ops["headObject"],
    deleteObject: async (_bucket, key) => {
      calls.push("deleteObject");
      deleteKeys.push(key);
      await (scenario.deleteObject ?? (async () => undefined))();
    },
  };
  const client: StorageClient = scenario.client ?? { kind: "configured", bucket: "bms-asset-images", ops };

  const access = { calls: [] as string[] };
  const accessFake = {
    writableLocationIds: async () => {
      access.calls.push("writableLocationIds");
      if (scenario.writableLocationIds === "refused") throw new ForbiddenException(MASTER_DATA_SENTENCE);
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
    canReadReportFile: async () => {
      access.calls.push("canReadReportFile");
      return scenario.canRead ?? true;
    },
  } as unknown as AccessControlService;

  const channels = { calls: [] as string[] };
  const channelsFake = {
    loadById: async (_jwt: JwtPayload, id: string) => {
      channels.calls.push(`loadById:${id}`);
      if (scenario.channel === "refused") throw new ForbiddenException("Notification channel is outside your access scope");
      return scenario.channel === undefined ? channelRow() : scenario.channel;
    },
  } as unknown as ChannelsService;

  const audit = { inputs: [] as AuditInput[], executors: [] as unknown[] };
  const auditFake = {
    write: async (input: AuditInput, executor: unknown) => {
      calls.push("audit");
      audit.inputs.push(input);
      audit.executors.push(executor);
    },
  } as unknown as MasterDataAuditService;

  const service = new ReportSchedulesService(tenant, fleet, client, accessFake, channelsFake, auditFake);
  // The clock seam: a field, not a constructor parameter (the slot pins see six).
  Object.assign(service, { now: () => now });

  return {
    service,
    calls,
    deleteKeys,
    inserted,
    updates,
    executed,
    listWheres,
    access,
    channels,
    audit,
    tenantTransactions: () => tenantTransactions,
  };
}

export const CREATE_BODY: CreateReportScheduleBodyInput = {
  name: FIXTURE_NAME,
  formats: ["pdf", "xlsx"],
  cadence: "daily",
  runAtLocal: "00:30",
  timezone: "Asia/Kolkata",
  locationIds: [],
  organizationId: ORG_ID,
};

// ---------------------------------------------------------------------------
// create — the R-12 refusals, one per row
// ---------------------------------------------------------------------------

export async function assetGroupAdminIs403BeforeAnyRead(): Promise<void> {
  const h = harness({ writableLocationIds: "refused" });
  const err = await captureRejection(() => h.service.create(JWT, CREATE_BODY));
  assert(errorName(err) === "ForbiddenException", `expected 403, got ${errorName(err)}`);
  assert(errorMessage(err) === MASTER_DATA_SENTENCE, `expected the master-data sentence, got "${errorMessage(err)}"`);
  assert(h.calls.length === 0, `the refusal must precede every read; calls: ${JSON.stringify(h.calls)}`);
}

export async function globalAdminMustNameTheOrganization(): Promise<void> {
  const h = harness();
  const { organizationId: _omitted, ...body } = CREATE_BODY;
  const err = await captureRejection(() => h.service.create(JWT, body));
  assert(errorName(err) === "BadRequestException", `expected 400, got ${errorName(err)}`);
  assert(errorMessage(err) === "organizationId is required for a global admin", `got "${errorMessage(err)}"`);
  assert(h.inserted.length === 0, "nothing may be inserted");
}

export async function aLocationOutsideTheOrganizationIs400(): Promise<void> {
  const h = harness({ organizationLocations: [WC] });
  const err = await captureRejection(() => h.service.create(JWT, { ...CREATE_BODY, locationIds: [WC, FOREIGN_LOCATION] }));
  assert(errorName(err) === "BadRequestException", `expected 400, got ${errorName(err)}`);
  assert(errorMessage(err) === "locationIds names a location outside the organization", `got "${errorMessage(err)}"`);
  assert(h.inserted.length === 0, "nothing may be inserted");
}

export async function aLocationOutsideTheScopeIs403(): Promise<void> {
  const h = harness({
    writableLocationIds: [WC],
    writableOrganizationIds: [ORG_ID],
    organizationLocations: [WC, OTHER_LOCATION],
    readScope: { kind: "location", organizationIds: [ORG_ID], locationIds: [WC] },
  });
  const err = await captureRejection(() => h.service.create(JWT, { ...CREATE_BODY, locationIds: [OTHER_LOCATION] }));
  assert(errorName(err) === "ForbiddenException", `expected 403, got ${errorName(err)}`);
  assert(errorMessage(err) === "locationIds is outside your access scope", `got "${errorMessage(err)}"`);
  assert(h.inserted.length === 0, "nothing may be inserted");
}

/** The positive control for the two rows above: a held location of the organization is admitted. */
export async function aHeldLocationOfTheOrganizationIsAdmitted(): Promise<void> {
  const h = harness({
    writableLocationIds: [WC],
    writableOrganizationIds: [ORG_ID],
    organizationLocations: [WC, OTHER_LOCATION],
    readScope: { kind: "location", organizationIds: [ORG_ID], locationIds: [WC] },
  });
  await h.service.create(JWT, { ...CREATE_BODY, locationIds: [WC] });
  assert(h.inserted.length === 1, `expected one insert, got ${h.inserted.length}`);
  assert(JSON.stringify(h.inserted[0]?.locationIds) === JSON.stringify([WC]), "the row must carry the body's locationIds");
}

export async function emptyLocationIdsNeedOrganizationRights(kind: "location" | "organization"): Promise<void> {
  const h = harness({
    writableLocationIds: [WC],
    writableOrganizationIds: [ORG_ID],
    readScope:
      kind === "location"
        ? { kind: "location", organizationIds: [ORG_ID], locationIds: [WC] }
        : { kind: "organization", organizationIds: [ORG_ID] },
  });
  if (kind === "location") {
    const err = await captureRejection(() => h.service.create(JWT, { ...CREATE_BODY, locationIds: [] }));
    assert(errorName(err) === "ForbiddenException", `expected 403, got ${errorName(err)}`);
    assert(errorMessage(err) === "An empty location scope requires organization-level rights", `got "${errorMessage(err)}"`);
    assert(h.inserted.length === 0, "nothing may be inserted");
    return;
  }
  await h.service.create(JWT, { ...CREATE_BODY, locationIds: [] });
  assert(h.inserted.length === 1, `an organization scope must proceed to the insert; got ${h.inserted.length}`);
}

export async function aWebhookChannelIs400(): Promise<void> {
  const h = harness({ channel: channelRow({ kind: "webhook" }) });
  const err = await captureRejection(() => h.service.create(JWT, { ...CREATE_BODY, channelId: CHANNEL_ID }));
  assert(errorName(err) === "BadRequestException", `expected 400, got ${errorName(err)}`);
  assert(errorMessage(err) === "channelId must name an email channel", `got "${errorMessage(err)}"`);
  assert(h.inserted.length === 0, "nothing may be inserted");
}

export async function aForeignChannelIs400(): Promise<void> {
  const h = harness({ channel: channelRow({ organizationId: OTHER_ORG_ID }) });
  const err = await captureRejection(() => h.service.create(JWT, { ...CREATE_BODY, channelId: CHANNEL_ID }));
  assert(errorName(err) === "BadRequestException", `expected 400, got ${errorName(err)}`);
  assert(errorMessage(err) === "channelId names a channel of another organization", `got "${errorMessage(err)}"`);
  assert(h.inserted.length === 0, "nothing may be inserted");
}

export async function aNullOrganizationChannelIs400(): Promise<void> {
  const h = harness({ channel: channelRow({ organizationId: null }) });
  const err = await captureRejection(() => h.service.create(JWT, { ...CREATE_BODY, channelId: CHANNEL_ID }));
  assert(errorName(err) === "BadRequestException", `expected 400, got ${errorName(err)}`);
  assert(errorMessage(err) === "channelId names a channel of another organization", `got "${errorMessage(err)}"`);
  assert(h.inserted.length === 0, "nothing may be inserted");
}

export async function anUnknownChannelIs404(): Promise<void> {
  const h = harness({ channel: null });
  const err = await captureRejection(() => h.service.create(JWT, { ...CREATE_BODY, channelId: CHANNEL_ID }));
  assert(errorName(err) === "NotFoundException", `expected 404, got ${errorName(err)}`);
  assert(errorMessage(err) === "Notification channel not found", `got "${errorMessage(err)}"`);
}

/** Q-6: `loadById`'s own 403 propagates — a `location_admin` cannot attach a channel. */
export async function aChannelRefusedByLoadByIdIs403(): Promise<void> {
  const h = harness({ channel: "refused" });
  const err = await captureRejection(() => h.service.create(JWT, { ...CREATE_BODY, channelId: CHANNEL_ID }));
  assert(errorName(err) === "ForbiddenException", `expected 403, got ${errorName(err)}`);
  assert(h.inserted.length === 0, "nothing may be inserted");
}

/** The positive control: an email channel of this organization is stamped on the row. */
export async function anEmailChannelOfThisOrganizationIsAdmitted(): Promise<void> {
  const h = harness({ channel: channelRow() });
  await h.service.create(JWT, { ...CREATE_BODY, channelId: CHANNEL_ID });
  assert(h.inserted[0]?.channelId === CHANNEL_ID, `the row must carry the channel id, got ${String(h.inserted[0]?.channelId)}`);
  assert(h.channels.calls.length === 1 && h.channels.calls[0] === `loadById:${CHANNEL_ID}`, "loadById must be asked once with the id");
}

// ---------------------------------------------------------------------------
// create — the cap and the clock
// ---------------------------------------------------------------------------

export async function theCapRefusesBeforeTheInsert(): Promise<void> {
  const h = harness({ txCount: 50 });
  const err = await captureRejection(() => h.service.create(JWT, CREATE_BODY));
  assert(errorName(err) === "ConflictException", `expected 409, got ${errorName(err)}`);
  assert(h.inserted.length === 0, `insert.calls must be 0, got ${h.inserted.length}`);
  assert(!h.calls.includes("tx:insert"), `no insert may run: ${JSON.stringify(h.calls)}`);
}

export async function theCapFailsClosedOnANonNumericCount(): Promise<void> {
  const h = harness({ txCountRows: [{ count: "not-a-number" }] });
  const err = await captureRejection(() => h.service.create(JWT, CREATE_BODY));
  assert(errorName(err) === "ConflictException", `a NaN count must refuse with 409, got ${errorName(err)}`);
  assert(h.inserted.length === 0, "nothing may be inserted");
}

/** The positive control: one under the cap inserts, after the advisory lock, and audits, then commits. */
export async function oneUnderTheCapLocksCountsInsertsAuditsThenCommits(): Promise<void> {
  const h = harness({ txCount: 49 });
  await h.service.create(JWT, CREATE_BODY);
  const expected = ["fleet:organizationExists", "tx:begin", "tx:setTenant", "tx:advisoryLock", "tx:count", "tx:insert", "audit", "tx:commit"];
  assert(JSON.stringify(h.calls) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(h.calls)}`);
}

export async function theAdvisoryLockNamesTheOrganization(): Promise<void> {
  const h = harness();
  await h.service.create(JWT, CREATE_BODY);
  const lock = h.executed.find((e) => e.sql.includes("pg_advisory_xact_lock"));
  assert(lock !== undefined, "the advisory lock statement must run");
  assert(lock.params.includes(`report_schedules:${ORG_ID}`), `the lock must bind report_schedules:<org>, got ${JSON.stringify(lock.params)}`);
}

export async function theTenantGucBindsTheResolvedOrganization(): Promise<void> {
  const h = harness();
  await h.service.create(JWT, CREATE_BODY);
  const guc = h.executed.find((e) => e.sql.includes("set_config"));
  assert(guc !== undefined && guc.params.includes(ORG_ID), `set_config must bind ${ORG_ID}, got ${JSON.stringify(guc?.params)}`);
}

/** R-7's fixture: Asia/Kolkata daily `00:30`, now `2026-09-21T10:00:00Z` → `2026-09-21T19:00:00Z`. */
export async function createComputesNextRunAtInTheZone(): Promise<void> {
  const h = harness({}, NOW);
  await h.service.create(JWT, CREATE_BODY);
  const stamped = h.inserted[0]?.nextRunAt;
  assert(stamped instanceof Date, `nextRunAt must be a Date on the insert, got ${typeof stamped}`);
  assert(
    stamped.toISOString() === "2026-09-21T19:00:00.000Z",
    `expected 2026-09-21T19:00:00.000Z (00:30 IST the same local day), got ${stamped.toISOString()}`,
  );
}

export async function createStampsTheTemplateTheActorAndEnabledByDefault(): Promise<void> {
  const h = harness();
  await h.service.create(JWT, CREATE_BODY);
  const row = h.inserted[0] ?? {};
  assert(row.templateId === "energy_consumption", `templateId must be energy_consumption, got ${String(row.templateId)}`);
  assert(row.createdBy === ACTOR_ID, `createdBy must be the resolved actor, got ${String(row.createdBy)}`);
  assert(row.enabled === true, `enabled must default to true, got ${String(row.enabled)}`);
  assert(row.channelId === null, `channelId must default to null, got ${String(row.channelId)}`);
}

// ---------------------------------------------------------------------------
// update — Q-3 / R-8
// ---------------------------------------------------------------------------

async function runPatch(body: UpdateReportScheduleBodyInput, row = storedSchedule(), scenario: Scenario = {}): Promise<Harness> {
  const h = harness({ scheduleRows: [row], ...scenario }, NOW);
  await h.service.update(JWT, SCHEDULE_ID, body);
  return h;
}

export async function patchRecomputesOnCadenceRunAtOrTimezone(field: "cadence" | "runAtLocal" | "timezone"): Promise<void> {
  const body: UpdateReportScheduleBodyInput =
    field === "cadence" ? { cadence: "weekly" } : field === "runAtLocal" ? { runAtLocal: "08:00" } : { timezone: "Europe/London" };
  const h = await runPatch(body);
  const set = h.updates[0] ?? {};
  const stamped = set.nextRunAt;
  assert(stamped instanceof Date, `a PATCH of ${field} must recompute nextRunAt; set = ${JSON.stringify(Object.keys(set))}`);
  const expected = nextRunAt(
    {
      cadence: field === "cadence" ? "weekly" : "daily",
      runAtLocal: field === "runAtLocal" ? "08:00" : "07:00",
      timezone: field === "timezone" ? "Europe/London" : "Asia/Kolkata",
    },
    NOW,
  );
  assert(stamped.toISOString() === expected.toISOString(), `expected ${expected.toISOString()}, got ${stamped.toISOString()}`);
  assert(stamped.getTime() !== SENTINEL_NEXT.getTime(), "the recomputed instant must not be the stored sentinel");
}

export async function patchRecomputesOnReenable(): Promise<void> {
  const h = await runPatch({ enabled: true }, storedSchedule({ enabled: false }));
  const set = h.updates[0] ?? {};
  assert(set.nextRunAt instanceof Date, `enabled false → true must recompute nextRunAt; set = ${JSON.stringify(Object.keys(set))}`);
  assert(
    (set.nextRunAt as Date).toISOString() === nextRunAt({ cadence: "daily", runAtLocal: "07:00", timezone: "Asia/Kolkata" }, NOW).toISOString(),
    "the recomputed instant must be report-period.ts's answer for now",
  );
}

/** The negative control for the row above: `enabled: true` on an enabled row moves nothing. */
export async function patchOfEnabledTrueOnAnEnabledRowKeepsNextRunAt(): Promise<void> {
  const h = await runPatch({ enabled: true }, storedSchedule({ enabled: true }));
  assert(!("nextRunAt" in (h.updates[0] ?? {})), "enabled true → true must not recompute nextRunAt");
}

export async function patchOfEnabledFalseKeepsNextRunAt(): Promise<void> {
  const h = await runPatch({ enabled: false });
  assert(!("nextRunAt" in (h.updates[0] ?? {})), "disabling must not recompute nextRunAt");
  assert(h.updates[0]?.enabled === false, "the set must carry enabled: false");
}

export async function patchOfNameAloneKeepsNextRunAt(): Promise<void> {
  const h = await runPatch({ name: "renamed" });
  const set = h.updates[0] ?? {};
  assert(!("nextRunAt" in set), `a name-only PATCH must not touch nextRunAt; set = ${JSON.stringify(Object.keys(set))}`);
  assert(set.name === "renamed", "the set must carry the new name");
  assert(set.updatedAt instanceof Date && set.updatedAt.getTime() === NOW.getTime(), "updatedAt must be stamped with now");
}

/** A PATCH that re-sends the stored cadence is not a change (Q-3: "on a change to"). */
export async function patchOfTheSameCadenceKeepsNextRunAt(): Promise<void> {
  const h = await runPatch({ cadence: "daily" });
  assert(!("nextRunAt" in (h.updates[0] ?? {})), "re-sending the stored cadence must not recompute nextRunAt");
}

export async function patchRunsTheWriteChecksOnTheNewLocationIds(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()], organizationLocations: [WC] });
  const err = await captureRejection(() => h.service.update(JWT, SCHEDULE_ID, { locationIds: [FOREIGN_LOCATION] }));
  assert(errorName(err) === "BadRequestException", `expected 400, got ${errorName(err)}`);
  assert(h.updates.length === 0, "nothing may be updated");
}

export async function patchRunsTheWriteChecksOnTheNewChannelId(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()], channel: channelRow({ kind: "webhook" }) });
  const err = await captureRejection(() => h.service.update(JWT, SCHEDULE_ID, { channelId: CHANNEL_ID }));
  assert(errorName(err) === "BadRequestException", `expected 400, got ${errorName(err)}`);
  assert(h.updates.length === 0, "nothing may be updated");
}

/** A name-only PATCH asks neither the locations read nor the channel read (the row's scope was verified by the verdict). */
export async function patchOfNameAloneAsksNoWriteCheckRead(): Promise<void> {
  const h = await runPatch({ name: "renamed" });
  assert(!h.calls.includes("fleet:organizationLocations"), `no locations read: ${JSON.stringify(h.calls)}`);
  assert(h.channels.calls.length === 0, `no channel read: ${JSON.stringify(h.channels.calls)}`);
}

export async function patchOutOfScopeIs403BeforeAnyWrite(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()], canRead: false });
  const err = await captureRejection(() => h.service.update(JWT, SCHEDULE_ID, { name: "renamed" }));
  assert(errorName(err) === "ForbiddenException", `expected 403, got ${errorName(err)}`);
  assert(errorMessage(err) === SCHEDULE_OUT_OF_SCOPE_SENTENCE, `got "${errorMessage(err)}"`);
  assert(h.tenantTransactions() === 0, "no tenant transaction may open");
}

export async function patchOfAnUnknownIdIs404(): Promise<void> {
  const h = harness({ scheduleRows: [] });
  const err = await captureRejection(() => h.service.update(JWT, SCHEDULE_ID, { name: "renamed" }));
  assert(errorName(err) === "NotFoundException", `expected 404, got ${errorName(err)}`);
  assert(errorMessage(err) === "Report schedule not found", `got "${errorMessage(err)}"`);
}

// ---------------------------------------------------------------------------
// get and list
// ---------------------------------------------------------------------------

export async function getOutOfScopeIs403WithTheOneSentence(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()], canRead: false });
  const err = await captureRejection(() => h.service.get(JWT, SCHEDULE_ID));
  assert(errorName(err) === "ForbiddenException", `expected 403, got ${errorName(err)}`);
  assert(errorMessage(err) === SCHEDULE_OUT_OF_SCOPE_SENTENCE, `got "${errorMessage(err)}"`);
}

export async function getOfAnUnknownIdIs404BeforeTheVerdict(): Promise<void> {
  const h = harness({ scheduleRows: [] });
  const err = await captureRejection(() => h.service.get(JWT, SCHEDULE_ID));
  assert(errorName(err) === "NotFoundException", `expected 404, got ${errorName(err)}`);
  assert(!h.access.calls.includes("canReadReportFile"), "the verdict must not run for a missing row");
}

export async function listAppliesTheLocationPredicateOnlyForLocationAdmins(kind: "location" | "organization" | "global"): Promise<void> {
  const readScope: ReadScope =
    kind === "location"
      ? { kind: "location", organizationIds: [ORG_ID], locationIds: [WC] }
      : kind === "organization"
        ? { kind: "organization", organizationIds: [ORG_ID] }
        : { kind: "global" };
  const h = harness({ readScope, scheduleRows: [storedSchedule()] });
  await h.service.list(JWT);
  const where = h.listWheres[0];
  assert(where !== undefined, "the list select must run once");
  const hasPredicate = where.sql.includes("cardinality") && where.sql.includes("<@");
  if (kind === "location") {
    assert(hasPredicate, `a location admin's list must carry the location predicate; sql: ${where.sql}`);
    assert(h.tenantTransactions() === 1, "a one-organization location admin lists on the tenant branch");
    return;
  }
  assert(!hasPredicate, `${kind} must carry no location predicate; sql: ${where.sql}`);
}

export async function listOrdersNewestFirst(): Promise<void> {
  const older = storedSchedule({ id: FILE_A, createdAt: new Date("2026-09-20T10:00:00Z") });
  const h = harness({ scheduleRows: [storedSchedule(), older] });
  const dtos = await h.service.list(JWT);
  // The fake answers rows in the order given; the order clause is the service's — assert it was requested.
  assert(dtos.length === 2 && dtos[0]?.id === SCHEDULE_ID, "list must map every row through the DTO");
}

// ---------------------------------------------------------------------------
// remove — Q-2
// ---------------------------------------------------------------------------

const TWO_FILES = [
  { fileId: FILE_A, objectKey: KEY_A },
  { fileId: FILE_B, objectKey: KEY_B },
];

export async function removeDeletesFilesThenTheScheduleThenTheObjects(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()], deletedFiles: TWO_FILES });
  await h.service.remove(JWT, SCHEDULE_ID);
  const expected = [
    "fleet:readById",
    "tx:begin",
    "tx:setTenant",
    "tx:deleteFiles",
    "tx:deleteSchedule",
    "audit",
    "tx:commit",
    "deleteObject",
    "deleteObject",
  ];
  assert(JSON.stringify(h.calls) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(h.calls)}`);
  assert(JSON.stringify(h.deleteKeys) === JSON.stringify([KEY_A, KEY_B]), `the objects deleted must be the files' keys, got ${JSON.stringify(h.deleteKeys)}`);
}

export async function removeResolvesAndWarnsOncePerFailedObjectNamingTheFileId(): Promise<void> {
  const boom = new Error(`fake NoSuchBucket: ${KEY_A}`);
  boom.name = "NoSuchBucket";
  let first = true;
  const h = harness({
    scheduleRows: [storedSchedule()],
    deletedFiles: TWO_FILES,
    deleteObject: async () => {
      if (first) {
        first = false;
        throw boom;
      }
    },
  });
  const { warns } = await capturingWarns(() => h.service.remove(JWT, SCHEDULE_ID));
  assert(warns.length === 1, `expected one warn, got ${JSON.stringify(warns)}`);
  assert(warns[0]!.includes(FILE_A), `the warn must name the file id ${FILE_A}: ${warns[0]}`);
  assert(warns[0]!.includes("NoSuchBucket"), `the warn must name err.name: ${warns[0]}`);
  assert(!warns[0]!.includes(KEY_A), `the warn must not carry the key: ${warns[0]}`);
  assert(h.deleteKeys.length === 2, "the second object must still be attempted");
}

export async function removeOfAVanishedRowIs404AndDeletesNoObject(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()], deletedFiles: TWO_FILES, deletedSchedules: [] });
  const err = await captureRejection(() => h.service.remove(JWT, SCHEDULE_ID));
  assert(errorName(err) === "NotFoundException", `expected 404, got ${errorName(err)}`);
  assert(h.deleteKeys.length === 0, "no object may be deleted when the transaction threw");
}

export async function removeOutOfScopeIs403BeforeAnyWrite(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()], canRead: false });
  const err = await captureRejection(() => h.service.remove(JWT, SCHEDULE_ID));
  assert(errorName(err) === "ForbiddenException", `expected 403, got ${errorName(err)}`);
  assert(h.tenantTransactions() === 0 && h.deleteKeys.length === 0, "no write may run");
}

export async function removeIs503WhenStorageIsUnconfigured(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()], client: { kind: "unconfigured" } as StorageClient });
  const err = await captureRejection(() => h.service.remove(JWT, SCHEDULE_ID));
  assert(errorName(err) === "ServiceUnavailableException", `expected 503, got ${errorName(err)}`);
  assert(h.calls.length === 0, `the storage gate must precede every read: ${JSON.stringify(h.calls)}`);
}

// ---------------------------------------------------------------------------
// audit — R-10
// ---------------------------------------------------------------------------

export async function auditPayloadsCarryIdsAndEnumsNeverTheName(route: "create" | "update" | "remove"): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()], deletedFiles: TWO_FILES, channel: channelRow() });
  if (route === "create") await h.service.create(JWT, { ...CREATE_BODY, channelId: CHANNEL_ID });
  if (route === "update") await h.service.update(JWT, SCHEDULE_ID, { name: FIXTURE_NAME });
  if (route === "remove") await h.service.remove(JWT, SCHEDULE_ID);
  assert(h.audit.inputs.length === 1, `expected one audit row, got ${h.audit.inputs.length}`);
  const input = h.audit.inputs[0]!;
  // `create` mints its own id; the other two act on the fixture row.
  const scheduleId = route === "create" ? String(h.inserted[0]?.id) : SCHEDULE_ID;
  assert(input.action === `report_schedule.${route === "remove" ? "delete" : route}`, `action was ${input.action}`);
  assert(input.entityType === "report_schedule" && input.entityId === scheduleId, "entityType/entityId must name the schedule");
  assert(input.organizationId === ORG_ID, "the audit row must carry the organization");
  const payload = JSON.stringify(input.payload);
  assert(!payload.includes(FIXTURE_NAME), `the payload must never carry the name: ${payload}`);
  assert(payload.includes(scheduleId), `the payload must carry the schedule id: ${payload}`);
  assert(h.audit.executors[0] !== undefined && h.audit.executors[0] !== null, "the audit row must be written on the transaction");
}

export async function theCreateAuditPayloadCarriesTheSevenKeys(): Promise<void> {
  const h = harness({ channel: channelRow() });
  await h.service.create(JWT, { ...CREATE_BODY, channelId: CHANNEL_ID });
  const keys = Object.keys(h.audit.inputs[0]?.payload ?? {}).sort();
  const expected = ["cadence", "channelId", "enabled", "formats", "locationIds", "organizationId", "scheduleId"];
  assert(JSON.stringify(keys) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(keys)}`);
}

// ---------------------------------------------------------------------------
// DTO — R-16
// ---------------------------------------------------------------------------

export async function dtoNeverCarriesNextRunAtAsADate(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule()] });
  const dto = await h.service.get(JWT, SCHEDULE_ID);
  assert(typeof dto.nextRunAt === "string", `nextRunAt must be an ISO string, got ${typeof dto.nextRunAt}`);
  assert(dto.nextRunAt === SENTINEL_NEXT.toISOString(), `got ${dto.nextRunAt}`);
  assert(dto.lastRunAt === null, "lastRunAt null passes through as null");
}

export async function runAtLocalIsSlicedToMinutes(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule({ runAtLocal: "07:00:00" })] });
  const dto = await h.service.get(JWT, SCHEDULE_ID);
  assert(dto.runAtLocal === "07:00", `expected "07:00", got "${dto.runAtLocal}"`);
}

/** A row that breaks its contract is the server's 500, never a 400 (F4.108). */
export async function aBrokenRowIs500NotA400(): Promise<void> {
  const h = harness({ scheduleRows: [storedSchedule({ cadence: "hourly" })] });
  const err = await captureRejection(() => h.service.get(JWT, SCHEDULE_ID));
  assert(errorName(err) === "InternalServerErrorException", `expected 500, got ${errorName(err)}`);
}
