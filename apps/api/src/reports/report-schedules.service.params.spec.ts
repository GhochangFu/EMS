import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { createReportScheduleBodySchema } from "@bms/shared";

import {
  ACTOR_ID,
  CHANNEL_ID,
  CREATE_BODY,
  JWT,
  ORG_ID,
  OTHER_LOCATION,
  SCHEDULE_ID,
  WC,
  assert,
  channelRow,
  errorMessage,
  errorName,
  harness,
  storedSchedule,
  type Harness,
  type Scenario,
} from "./report-schedules.service.spec";
import type { CreateReportScheduleBodyInput } from "./report-schedules.schema";

/**
 * `F4.303` U11 (ADR 0108 Amendment 6 item 6; plan C17) — the schedule create and update with a
 * template and params, over `report-schedules.service.spec.ts`'s fakes (that file is at its line
 * cap, so the claims live here). Assertions live here; the sibling `.test.ts` is the Vitest entry
 * point (§4.6).
 *
 * The point check (`trend-points-schedule-check.ts`) reads through the service's own `fleetDb`
 * and `accessControl`, so {@link withPointFakes} replaces those two fields on the harness's
 * service with wrappers that answer the check's two reads (the assets select by its projection
 * `assetId,locationId,pointKey`, the subtree walk by `execute`) and `readableAssetIds`, and
 * delegate every other read to the harness's fakes. The check itself is measured against
 * Postgres in `trend-points-schedule-check.integration.spec.ts`; here it is only "was it run,
 * when, with what".
 */

const ASSET_1 = "66666666-6666-4666-8666-666666666666";
const ASSET_2 = "67676767-6767-4676-8676-676767676767";
const POINTS = [
  { assetId: ASSET_1, pointKey: "kw" },
  { assetId: ASSET_2, pointKey: "pf" },
];
const TREND_BODY: CreateReportScheduleBodyInput = {
  ...CREATE_BODY,
  locationIds: [WC],
  templateId: "trend_points",
  params: { points: POINTS, compare: true },
};
const PAIRING_400 = {
  trendWithoutParams: "a trend_points schedule needs params.points",
  energyWithTrendArm: "an energy_consumption schedule takes params.compare only",
} as const;

const dialect = new PgDialect();

type PointFakes = {
  /** The asset ids bound by each assets select, in call order. */
  readonly assetSelects: unknown[][];
  /** The parameters of each subtree walk. */
  readonly subtreeParams: unknown[][];
};

function thenable(resolve: () => Promise<unknown>, onCall?: (method: string, args: unknown[]) => void): unknown {
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

/** Every pair registered on its asset, both assets at `WC`, readable by everyone. */
function withPointFakes(h: Harness): PointFakes {
  const fakes: PointFakes = { assetSelects: [], subtreeParams: [] };
  const service = h.service as unknown as { fleetDb: Record<string, unknown>; accessControl: Record<string, unknown> };
  const baseFleet = service.fleetDb;
  const baseSelect = baseFleet.select as (projection?: Record<string, unknown>) => unknown;
  const fleetDb = {
    ...baseFleet,
    select: (projection?: Record<string, unknown>) => {
      const shape = projection === undefined ? "" : Object.keys(projection).sort().join(",");
      if (shape !== "assetId,locationId,pointKey") return baseSelect(projection);
      let whereArg: unknown;
      return thenable(
        async () => {
          h.calls.push("fleet:trendPoints");
          fakes.assetSelects.push(dialect.sqlToQuery(whereArg as SQL).params);
          return POINTS.map((p) => ({ assetId: p.assetId, locationId: WC, pointKey: p.pointKey }));
        },
        (method, args) => {
          if (method === "where") whereArg = args[0];
        },
      );
    },
    execute: async (statement: SQL) => {
      h.calls.push("fleet:subtree");
      fakes.subtreeParams.push(dialect.sqlToQuery(statement).params);
      return { rows: [{ id: WC }] };
    },
  };
  const accessControl = {
    ...service.accessControl,
    readableAssetIds: async () => {
      h.access.calls.push("readableAssetIds");
      return null;
    },
  };
  Object.assign(h.service, { fleetDb, accessControl });
  return fakes;
}

function pointHarness(scenario: Scenario = {}): Harness & { fakes: PointFakes } {
  const h = harness(scenario);
  return Object.assign(h, { fakes: withPointFakes(h) });
}

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject, and it resolved");
}

// ---------------------------------------------------------------------------
// create — the stored template and params
// ---------------------------------------------------------------------------

/** S1: a body parsed without `templateId`/`params` stores `energy_consumption` and `NULL`. */
export async function aBodyWithoutTemplateStoresEnergyAndNull(): Promise<void> {
  const { templateId: _t, ...raw } = CREATE_BODY;
  const parsed = createReportScheduleBodySchema.parse(raw);
  const h = harness();
  await h.service.create(JWT, parsed);
  const row = h.inserted[0] ?? {};
  assert(row.templateId === "energy_consumption", `templateId must be energy_consumption, got ${String(row.templateId)}`);
  assert(row.params === null, `params must be NULL, got ${JSON.stringify(row.params)}`);
}

/** S2: the energy arm with compare off is stored as `NULL` — the same row as a schedule made before `0122`. */
export async function energyWithCompareOffStoresNull(): Promise<void> {
  const h = harness();
  await h.service.create(JWT, { ...CREATE_BODY, params: { compare: false } });
  const row = h.inserted[0] ?? {};
  assert(row.params === null, `compare off must store NULL, got ${JSON.stringify(row.params)}`);
}

/** S3: the energy arm with compare on is stored as given. */
export async function energyWithCompareOnStoresTheArm(): Promise<void> {
  const h = harness();
  await h.service.create(JWT, { ...CREATE_BODY, params: { compare: true } });
  const row = h.inserted[0] ?? {};
  assert(JSON.stringify(row.params) === JSON.stringify({ compare: true }), `got ${JSON.stringify(row.params)}`);
}

/** A `trend_points` create stores the template and the trend arm as given. */
export async function trendPointsStoresTheTemplateAndTheArm(): Promise<void> {
  const h = pointHarness();
  await h.service.create(JWT, TREND_BODY);
  const row = h.inserted[0] ?? {};
  assert(row.templateId === "trend_points", `templateId must be trend_points, got ${String(row.templateId)}`);
  assert(JSON.stringify(row.params) === JSON.stringify(TREND_BODY.params), `got ${JSON.stringify(row.params)}`);
}

// ---------------------------------------------------------------------------
// create — the pairing check (S4–S7)
// ---------------------------------------------------------------------------

type PairingCase = "trendWithoutParams" | "trendWithEnergyArm" | "energyWithTrendArm";

function pairingBody(kind: PairingCase): CreateReportScheduleBodyInput {
  if (kind === "trendWithoutParams") return { ...TREND_BODY, params: undefined };
  if (kind === "trendWithEnergyArm") return { ...TREND_BODY, params: { compare: true } };
  return { ...CREATE_BODY, locationIds: [WC], params: { points: POINTS, compare: false } };
}

function pairingSentence(kind: PairingCase): string {
  return kind === "energyWithTrendArm" ? PAIRING_400.energyWithTrendArm : PAIRING_400.trendWithoutParams;
}

/** S4–S6: each mismatched template and arm is a 400 with its sentence, and nothing is inserted. */
export async function aMismatchedArmIs400(kind: PairingCase): Promise<void> {
  const h = pointHarness();
  const err = await rejection(() => h.service.create(JWT, pairingBody(kind)));
  assert(errorName(err) === "BadRequestException", `${kind}: expected 400, got ${errorName(err)}: ${errorMessage(err)}`);
  assert(errorMessage(err) === pairingSentence(kind), `${kind}: expected "${pairingSentence(kind)}", got "${errorMessage(err)}"`);
  assert(h.inserted.length === 0, `${kind}: nothing may be inserted`);
}

/** S7: the pairing 400 runs before `checkWriteScope`'s channel read and before the point check. */
export async function theMismatchIsRefusedBeforeTheChannelRead(kind: PairingCase): Promise<void> {
  const h = pointHarness({ channel: channelRow() });
  await rejection(() => h.service.create(JWT, { ...pairingBody(kind), channelId: CHANNEL_ID }));
  assert(h.channels.calls.length === 0, `${kind}: the channel was read: ${JSON.stringify(h.channels.calls)}`);
  assert(!h.calls.includes("fleet:trendPoints"), `${kind}: the point check ran: ${JSON.stringify(h.calls)}`);
}

// ---------------------------------------------------------------------------
// create — the point check's place
// ---------------------------------------------------------------------------

/** A `trend_points` create runs the point check once, after the location read and before the transaction. */
export async function trendPointsRunsThePointCheckBeforeTheTransaction(): Promise<void> {
  const h = pointHarness();
  await h.service.create(JWT, TREND_BODY);
  const order = h.calls.filter((call) => ["fleet:organizationLocations", "fleet:trendPoints", "tx:begin"].includes(call));
  const expected = ["fleet:organizationLocations", "fleet:trendPoints", "tx:begin"];
  assert(JSON.stringify(order) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(h.calls)}`);
  const bound = JSON.stringify(h.fakes.assetSelects[0] ?? []);
  assert(bound.includes(ASSET_1) && bound.includes(ASSET_2), `the select must bind both asset ids, got ${bound}`);
}

/** An `energy_consumption` create runs no point check (the negative beside the one above). */
export async function energyRunsNoPointCheck(): Promise<void> {
  const h = pointHarness();
  await h.service.create(JWT, { ...CREATE_BODY, params: { compare: true } });
  assert(!h.calls.includes("fleet:trendPoints"), `an energy create ran the point check: ${JSON.stringify(h.calls)}`);
  assert(!h.access.calls.includes("readableAssetIds"), `an energy create read the readable assets: ${JSON.stringify(h.access.calls)}`);
}

// ---------------------------------------------------------------------------
// update — the PATCH recheck
// ---------------------------------------------------------------------------

const TREND_ROW = storedSchedule({ templateId: "trend_points", params: { points: POINTS, compare: false }, locationIds: [WC] });

/** A `PATCH locationIds` on a `trend_points` row re-runs the check with the stored points against the new list. */
export async function patchLocationIdsOnATrendRowRechecksThePoints(): Promise<void> {
  const h = pointHarness({ scheduleRows: [TREND_ROW] });
  await h.service.update(JWT, SCHEDULE_ID, { locationIds: [OTHER_LOCATION] });
  assert(h.calls.filter((c) => c === "fleet:trendPoints").length === 1, `expected one point check, got ${JSON.stringify(h.calls)}`);
  const walked = JSON.stringify(h.fakes.subtreeParams[0] ?? []);
  assert(walked.includes(OTHER_LOCATION) && !walked.includes(WC), `the walk must start at the new list only, got ${walked}`);
  assert(h.calls.indexOf("fleet:trendPoints") < h.calls.indexOf("tx:begin"), `the check must precede the write: ${JSON.stringify(h.calls)}`);
}

/** The same PATCH on an `energy_consumption` row runs no point check. */
export async function patchLocationIdsOnAnEnergyRowRunsNoPointCheck(): Promise<void> {
  const h = pointHarness({ scheduleRows: [storedSchedule({ locationIds: [WC] })] });
  await h.service.update(JWT, SCHEDULE_ID, { locationIds: [OTHER_LOCATION] });
  assert(!h.calls.includes("fleet:trendPoints"), `an energy PATCH ran the point check: ${JSON.stringify(h.calls)}`);
}

/** A PATCH without `locationIds` on a `trend_points` row runs no point check. */
export async function patchOfNameOnATrendRowRunsNoPointCheck(): Promise<void> {
  const h = pointHarness({ scheduleRows: [TREND_ROW] });
  await h.service.update(JWT, SCHEDULE_ID, { name: "renamed" });
  assert(!h.calls.includes("fleet:trendPoints"), `a name PATCH ran the point check: ${JSON.stringify(h.calls)}`);
}

// ---------------------------------------------------------------------------
// audit and DTO (S8, S9)
// ---------------------------------------------------------------------------

/** S8: the create audit payload carries `templateId` and `pointCount`, and never a point. */
export async function theAuditPayloadCarriesTheTemplateAndThePointCount(): Promise<void> {
  const h = pointHarness();
  await h.service.create(JWT, TREND_BODY);
  const payload = h.audit.inputs[0]?.payload ?? {};
  assert(payload.templateId === "trend_points", `templateId: got ${JSON.stringify(payload.templateId)}`);
  assert(payload.pointCount === 2, `pointCount: got ${JSON.stringify(payload.pointCount)}`);
  const text = JSON.stringify(payload);
  assert(!text.includes(ASSET_1) && !text.includes("pointKey") && !("params" in payload), `the payload carries a point: ${text}`);
}

/** S8's energy side: an energy create's payload carries `pointCount: 0`. */
export async function anEnergyAuditPayloadCarriesPointCountZero(): Promise<void> {
  const h = harness();
  await h.service.create(JWT, CREATE_BODY);
  const payload = h.audit.inputs[0]?.payload ?? {};
  assert(payload.templateId === "energy_consumption" && payload.pointCount === 0, `got ${JSON.stringify(payload)}`);
}

/** S9: the DTO carries the stored `params`. */
export async function theDtoCarriesTheStoredParams(): Promise<void> {
  const h = harness({ scheduleRows: [TREND_ROW] });
  const dto = await h.service.get(JWT, SCHEDULE_ID);
  assert(JSON.stringify(dto.params) === JSON.stringify(TREND_ROW.params), `got ${JSON.stringify(dto.params)}`);
  assert(dto.templateId === "trend_points" && dto.organizationId === ORG_ID && dto.createdBy === ACTOR_ID, "the row's fields pass through");
}
