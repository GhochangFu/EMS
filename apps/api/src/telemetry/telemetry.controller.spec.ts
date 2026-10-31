import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { encodePointRef, type JwtPayload, type PointAggregateResponse } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { TelemetryController } from "./telemetry.controller";
import type { TelemetryService } from "./telemetry.service";

/**
 * `F3.35` Stage A — `GET /telemetry/points/:pointRef/aggregate` (ADR 0048
 * decision 3). Assertions live here; `telemetry.controller.test.ts` is the
 * vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function rejects(
  run: () => Promise<unknown>,
  is: (err: unknown) => boolean,
  why: string,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    assert(is(err), `${why}: threw ${String(err)}`);
    return;
  }
  throw new Error(`${why}: it did not throw`);
}

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };

const ASSET_ID = "88888888-8888-4888-8888-888888888888";
// `TELEMETRY_POINT_REF_SEP` is `"::"`. Built through `encodePointRef` rather
// than written by hand, so a change to the separator fails here loudly instead
// of making every assertion below a 400 that looks like a bounds refusal.
const POINT_REF = encodePointRef(ASSET_ID, "kw");

const RESPONSE: PointAggregateResponse = {
  pointRef: POINT_REF,
  from: "2026-08-29T12:00:00.000Z",
  to: "2026-08-30T12:00:00.000Z",
  bucketSeconds: 60,
  stats: { sum: 100, average: 12.1, min: 0, max: 18.4, peakAt: null, sampleCount: 1_440 },
  compare: null,
  buckets: null,
};

/** Records every call so a test can assert a read did NOT happen, not only that it threw. */
function serviceStub() {
  const calls: { point: { assetId: string; pointKey: string }; options: Record<string, unknown> }[] = [];
  const recentCalls: string[] = [];
  const service = {
    pointAggregate: async (
      point: { assetId: string; pointKey: string },
      options: Record<string, unknown>,
    ) => {
      calls.push({ point, options });
      return RESPONSE;
    },
    recentForPoint: async (pointRef: string) => {
      recentCalls.push(pointRef);
      return [];
    },
  } as unknown as TelemetryService;
  return { service, calls, recentCalls };
}

function accessStub(allow: boolean) {
  return {
    canReadAsset: async () => allow,
  } as unknown as AccessControlService;
}

function controllerWith(allow: boolean) {
  const { service, calls, recentCalls } = serviceStub();
  return { controller: new TelemetryController(service, accessStub(allow)), calls, recentCalls };
}

/**
 * **The assertion this unit exists for.**
 *
 * `telemetry.point_values*` carry no Row Level Security — ADR 0043's policies
 * are on `bms.*` — so no pool filters them and this guard is the only
 * containment between a caller and another organization's telemetry. ADR 0048's
 * Consequences name it as the security-relevant part of the endpoint.
 *
 * The call count is asserted, not only the throw. **A guard that throws after
 * reading has already read**, and the read is the harm here: the rows would have
 * left the database, and only the response would have been withheld.
 */
export async function assertAPointOutsideScopeIsRefusedBeforeAnyRead(): Promise<void> {
  const { controller, calls } = controllerWith(false);
  await rejects(
    () => controller.aggregate(USER, POINT_REF, {}),
    (err) => err instanceof ForbiddenException,
    "a point outside the caller's scope must be refused",
  );
  assert(
    calls.length === 0,
    `the service was called ${calls.length} time(s) despite the refusal; the guard must run ` +
      "before the read, not after it",
  );
}

/** The other direction: a guard that always refuses is indistinguishable from one that works. */
export async function assertAPointInsideScopeIsRead(): Promise<void> {
  const { controller, calls } = controllerWith(true);
  const result = await controller.aggregate(USER, POINT_REF, {});
  assert(result.pointRef === POINT_REF, "the endpoint must return the point it was asked for");
  assert(calls.length === 1, `expected exactly one read, got ${calls.length}`);
  // The service receives the DECODED pair, so the id the guard approved is the
  // id the query binds — structurally, not by two decodes agreeing.
  assert(
    calls[0]?.point.assetId === ASSET_ID && calls[0]?.point.pointKey === "kw",
    "the service must be handed the decoded pair the access check ran on, not the raw string",
  );
}

/**
 * A malformed reference is a caller error and answers 400.
 *
 * Letting `decodePointRefParam` throw raw would answer it with a 500 and a stack
 * trace — and it would do so **before** the access check, so the shape of the
 * error would differ for a malformed reference and a well-formed one out of
 * scope. That difference is readable from outside.
 */
export async function assertAMalformedPointRefIsABadRequest(): Promise<void> {
  const { controller, calls } = controllerWith(true);
  await rejects(
    () => controller.aggregate(USER, "not-a-point-ref", {}),
    (err) => err instanceof BadRequestException,
    "a malformed point reference must be a 400, not a 500",
  );
  assert(calls.length === 0, "a malformed reference must not reach the service");
}

/**
 * The query bounds, refused at the controller rather than in SQL.
 *
 * `windowMinutes` past `MAX_WIDGET_WINDOW_MINUTES` would reach `granularityFor`,
 * which throws — a 500 where the caller made an ordinary mistake.
 */
export async function assertQueryBoundsAreEnforced(): Promise<void> {
  const { controller } = controllerWith(true);
  for (const query of [
    { windowMinutes: "525601" },
    { windowMinutes: "0" },
    { windowMinutes: "-60" },
    { windowMinutes: "12.5" },
    { bucketFunction: "median" },
  ]) {
    await rejects(
      () => controller.aggregate(USER, POINT_REF, query),
      (err) => err instanceof BadRequestException,
      `${JSON.stringify(query)} must be refused as a 400`,
    );
  }
}

/**
 * **`?compare=false` must not turn the compare on.**
 *
 * `z.coerce.boolean("false")` is `true` — every non-empty string is — so a
 * caller writing the explicit negative would get the delta they asked not to
 * have, and the tile would show a comparison nobody configured. The schema uses
 * a string enum for exactly this reason and this is the assertion that holds it
 * there.
 */
export async function assertTheCompareFlagReadsItsOwnNegative(): Promise<void> {
  const { controller, calls } = controllerWith(true);
  await controller.aggregate(USER, POINT_REF, { compare: "false" });
  assert(calls[0]?.options.compare === false, "?compare=false must mean false");

  await controller.aggregate(USER, POINT_REF, { compare: "true" });
  assert(calls[1]?.options.compare === true, "?compare=true must mean true");

  await controller.aggregate(USER, POINT_REF, {});
  assert(calls[2]?.options.compare === false, "an absent compare must mean false");
}

/**
 * A tile asks for no buckets and must not pay for up to 2,880 rows. The default
 * window is a day, which is what the mock's *Today* cards show.
 */
export async function assertTheDefaultsAreATileRequest(): Promise<void> {
  const { controller, calls } = controllerWith(true);
  await controller.aggregate(USER, POINT_REF, {});
  assert(calls[0]?.options.windowMinutes === 1_440, "the default window is one day");
  assert(
    calls[0]?.options.bucketFunction === undefined,
    "a request naming no bucket function must not ask for buckets",
  );

  await controller.aggregate(USER, POINT_REF, { bucketFunction: "avg", windowMinutes: "60" });
  assert(calls[1]?.options.bucketFunction === "avg", "a named bucket function must reach the service");
  assert(calls[1]?.options.windowMinutes === 60, "the window must be coerced from the query string");
}

// ---------------------------------------------------------------------------
// `F4.297` (ADR 0108 decisions 1.2 and 1.5) — a custom from/to, bucket stats,
// the UUID guard on `aggregate`, and the `/recent` malformed-ref 400.
// ---------------------------------------------------------------------------

/**
 * A custom `{ from, to }` with a `+05:30` offset reaches the service as the
 * same two instants, and its span becomes `windowMinutes`. Mutation: resolve
 * the range from `windowMinutes` only (ignore `from`/`to`) and `to` is now.
 */
export async function assertACustomRangeReachesTheServiceAsDates(): Promise<void> {
  const { controller, calls } = controllerWith(true);
  await controller.aggregate(USER, POINT_REF, {
    from: "2026-08-01T05:30:00+05:30",
    to: "2026-08-01T07:30:00+05:30",
  });
  const options = calls[0]?.options;
  assert(
    options?.from instanceof Date && options.from.toISOString() === "2026-08-01T00:00:00.000Z",
    `from must reach the service as the instant the offset names, got ${String(options?.from)}`,
  );
  assert(
    options?.to instanceof Date && options.to.toISOString() === "2026-08-01T02:00:00.000Z",
    `to must reach the service as the instant the offset names, got ${String(options?.to)}`,
  );
  assert(options?.windowMinutes === 120, `the span must become windowMinutes 120, got ${String(options?.windowMinutes)}`);
}

/** `?bucketStats=true` reaches the service as `true`, and an absent flag as `false`. */
export async function assertTheBucketStatsFlagReachesTheService(): Promise<void> {
  const { controller, calls } = controllerWith(true);
  await controller.aggregate(USER, POINT_REF, { bucketFunction: "avg", bucketStats: "true" });
  assert(calls[0]?.options.bucketStats === true, "?bucketStats=true must mean true");
  await controller.aggregate(USER, POINT_REF, { bucketFunction: "avg" });
  assert(calls[1]?.options.bucketStats === false, "an absent bucketStats must mean false");
}

/**
 * Every custom-range rule is a 400 before any read, and each case is refused by
 * ITS rule: the message names the rule, so a case refused by another guard
 * (for example the span cap catching a year-0000 `from`) does not pass for it.
 */
export async function assertCustomRangeBoundsAreEnforced(): Promise<void> {
  const ahead = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const cases: { query: Record<string, string>; names: string }[] = [
    { query: { from: "2026-08-01T00:00:00Z" }, names: "together" },
    { query: { to: "2026-08-01T00:00:00Z" }, names: "together" },
    {
      query: { from: "2026-08-01T00:00:00Z", to: "2026-08-01T01:00:00Z", windowMinutes: "60" },
      names: "exclusive",
    },
    { query: { from: "2026-08-01T01:00:00Z", to: "2026-08-01T01:00:00Z" }, names: "after from" },
    { query: { from: "2026-08-01T02:00:00Z", to: "2026-08-01T01:00:00Z" }, names: "after from" },
    { query: { from: "2025-01-01T00:00:00Z", to: "2026-01-01T00:01:00Z" }, names: "525600" },
    { query: { from: "0000-01-01T00:00:00Z", to: "0000-01-01T01:00:00Z" }, names: "from must lie" },
    { query: { from: hourAgo, to: ahead }, names: "to must lie" },
    { query: { from: "2026-08-01T00:00:00", to: "2026-08-01T01:00:00Z" }, names: "offset" },
    { query: { bucketStats: "yes" }, names: "bucketStats" },
  ];
  for (const { query, names } of cases) {
    const { controller, calls } = controllerWith(true);
    await rejects(
      () => controller.aggregate(USER, POINT_REF, query),
      (err) => err instanceof BadRequestException && err.message.includes(names),
      `${JSON.stringify(query)} must be refused as a 400 naming "${names}"`,
    );
    assert(calls.length === 0, `${JSON.stringify(query)} reached the service`);
  }
  // The positive control beside the refusals: the boundary span is admitted.
  const { controller, calls } = controllerWith(true);
  await controller.aggregate(USER, POINT_REF, { from: "2025-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" });
  assert(calls.length === 1, "a span of exactly 525,600 minutes must be read");
}

/**
 * **A non-UUID asset id is a 400, for a global admin too.** `canReadAsset`
 * answers a global admin without an asset lookup, so nothing else stops the id
 * before the `::uuid` cast — a 500. Mutation: remove the guard and the stub
 * answers, the service is called, and this reddens.
 */
export async function assertANonUuidAssetIdIsABadRequestNotA500(): Promise<void> {
  const { controller, calls } = controllerWith(true);
  await rejects(
    () => controller.aggregate(USER, encodePointRef("not-a-uuid", "kw"), {}),
    (err) => err instanceof BadRequestException && err.message.includes("UUID"),
    "a non-UUID asset id must be a 400 naming the UUID rule",
  );
  assert(calls.length === 0, "a non-UUID asset id must not reach the service");
}

/**
 * `F4.297` owner answer Q4 — `/recent` answered a malformed ref with a 500 (the
 * decode threw raw). It is a 400, before the scope check and the read.
 */
export async function assertARecentMalformedRefIsABadRequest(): Promise<void> {
  const { controller, recentCalls } = controllerWith(true);
  await rejects(
    () => controller.recent(USER, "not-a-point-ref"),
    (err) => err instanceof BadRequestException && err.message === "Invalid point reference",
    "a malformed /recent reference must be a 400, not a 500",
  );
  assert(recentCalls.length === 0, "a malformed /recent reference must not reach the service");
}

/** `/recent` refuses a non-UUID asset id with a 400 too, the same rule as `aggregate`. */
export async function assertARecentNonUuidRefIsABadRequest(): Promise<void> {
  const { controller, recentCalls } = controllerWith(true);
  await rejects(
    () => controller.recent(USER, encodePointRef("not-a-uuid", "kw")),
    (err) => err instanceof BadRequestException && err.message.includes("UUID"),
    "a non-UUID /recent asset id must be a 400",
  );
  assert(recentCalls.length === 0, "a non-UUID /recent asset id must not reach the service");
}

/** The positive case beside the two refusals: a well-formed in-scope `/recent` ref is read. */
export async function assertARecentWellFormedRefIsRead(): Promise<void> {
  const { controller, recentCalls } = controllerWith(true);
  await controller.recent(USER, POINT_REF, "1h");
  assert(recentCalls.length === 1 && recentCalls[0] === POINT_REF, "a well-formed /recent ref must be read");
}

// ---------------------------------------------------------------------------
// `F3.28` (ADR 0074 decision 2 / plan decision 2) — `GET /telemetry/points/at-instant`.
// ---------------------------------------------------------------------------

const FOREIGN_ASSET_ID = "99999999-9999-4999-8999-999999999999";
const AT = "2026-09-23T10:30:00.000Z";

type Point = { assetId: string; pointKey: string };

/**
 * The fake service answers each point with values derived from THAT point, so
 * a reorder, an index shift or a dropped item changes what the response says
 * at each position rather than leaving it looking right.
 */
function atInstantStubs(readable: string[] | null) {
  const calls: { points: readonly Point[]; at: Date }[] = [];
  const service = {
    pointValuesAt: async (points: readonly Point[], at: Date) => {
      calls.push({ points, at });
      return points.map((p) => ({
        time: AT,
        value: p.pointKey.length + (p.assetId === ASSET_ID ? 100 : 200),
        unit: `unit-${p.pointKey}`,
      }));
    },
  } as unknown as TelemetryService;
  const access = {
    readableAssetIds: async () => readable,
  } as unknown as AccessControlService;
  return { controller: new TelemetryController(service, access), calls };
}

/**
 * One of two refs is foreign → 403. The in-scope ref is FIRST, so a guard that
 * only checks `refs[0]` lets this through.
 */
export async function assertAtInstantRefusesWhenOneRefIsForeign(): Promise<void> {
  const { controller } = atInstantStubs([ASSET_ID]);
  await rejects(
    () =>
      controller.atInstant(USER, {
        at: AT,
        refs: [encodePointRef(ASSET_ID, "kw"), encodePointRef(FOREIGN_ASSET_ID, "kw")],
      }),
    (err) =>
      err instanceof ForbiddenException && err.message === "Asset is outside your access scope",
    "a request naming one foreign ref must be refused whole with the aggregate's 403",
  );
}

/**
 * **The read must not happen**, not only the response be withheld: the call
 * count is its own claim so the guard-after-read mutation reddens THIS case.
 */
export async function assertAtInstantRefusalRunsBeforeTheRead(): Promise<void> {
  const { controller, calls } = atInstantStubs([ASSET_ID]);
  try {
    await controller.atInstant(USER, {
      at: AT,
      refs: [encodePointRef(ASSET_ID, "kw"), encodePointRef(FOREIGN_ASSET_ID, "kw")],
    });
  } catch {
    // The 403 itself is the case above.
  }
  assert(
    calls.length === 0,
    `the service was called ${calls.length} time(s) despite the refusal; the guard must run before the read`,
  );
}

/** A ref with no separator → 400 from the decode guard, and no read. */
export async function assertAtInstantMalformedRefIsABadRequest(): Promise<void> {
  const { controller, calls } = atInstantStubs(null);
  await rejects(
    () => controller.atInstant(USER, { at: AT, refs: ["not-a-point-ref"] }),
    (err) => err instanceof BadRequestException && err.message === "Invalid point reference",
    "a ref with no separator must be the decode guard's 400",
  );
  assert(calls.length === 0, "a malformed ref must not reach the service");
}

/**
 * A ref WITH a separator whose asset id is not a UUID → 400 from the UUID
 * guard. Unchecked, it reaches `$1::uuid[]` and becomes a 500.
 */
export async function assertAtInstantNonUuidAssetIsABadRequest(): Promise<void> {
  const { controller, calls } = atInstantStubs(null);
  await rejects(
    () => controller.atInstant(USER, { at: AT, refs: [encodePointRef("not-a-uuid", "kw")] }),
    (err) =>
      err instanceof BadRequestException &&
      err.message === "Invalid point reference: the asset id is not a UUID",
    "a non-UUID asset id must be the UUID guard's 400",
  );
  assert(calls.length === 0, "a non-UUID asset id must not reach the service");
}

/** 51 VALID refs → 400 from the bound, not from a decode guard. */
export async function assertAtInstantRefusesMoreThanFiftyRefs(): Promise<void> {
  const { controller, calls } = atInstantStubs(null);
  const refs = Array.from({ length: 51 }, (_, i) => encodePointRef(ASSET_ID, `kw_${i}`));
  await rejects(
    () => controller.atInstant(USER, { at: AT, refs }),
    (err) =>
      err instanceof BadRequestException &&
      err.message.includes("50") &&
      !err.message.startsWith("Invalid point reference"),
    "51 refs must be refused by the MAX_AT_INSTANT_REFS bound",
  );
  assert(calls.length === 0, "an over-bound request must not reach the service");
}

/**
 * An `at` in year 0 → 400 from the schema's range refine, and no read.
 * Unbounded, it reaches `$2::timestamptz` and Postgres answers a 500. An
 * unrestricted admin, so no scope guard could be the one that refused.
 */
export async function assertAtInstantOutOfRangeAtIsABadRequest(): Promise<void> {
  const { controller, calls } = atInstantStubs(null);
  await rejects(
    () =>
      controller.atInstant(USER, { at: "0000-01-01T00:00:00Z", refs: [encodePointRef(ASSET_ID, "kw")] }),
    (err) =>
      err instanceof BadRequestException &&
      err.message === "at must lie between 1970-01-01T00:00:00Z and one day after now",
    "an `at` in year 0 must be the range refine's 400",
  );
  assert(calls.length === 0, "an out-of-range `at` must not reach the service");
}

/** An unrestricted admin (`readableAssetIds` → null) reads any asset. */
export async function assertAtInstantAdminPasses(): Promise<void> {
  const { controller, calls } = atInstantStubs(null);
  const result = await controller.atInstant(USER, {
    at: AT,
    refs: [encodePointRef(FOREIGN_ASSET_ID, "kw")],
  });
  assert(calls.length === 1, `an admin must be read, got ${calls.length} read(s)`);
  assert(result.items.length === 1, "an admin must get one item per ref");
}

/**
 * The response keeps request order, echoes each ref as sent and `at` as sent,
 * and the service receives the decoded pairs in that same order.
 */
export async function assertAtInstantKeepsRequestOrder(): Promise<void> {
  const { controller } = atInstantStubs([ASSET_ID, FOREIGN_ASSET_ID]);
  const refs = [
    encodePointRef(FOREIGN_ASSET_ID, "kwh_total"),
    encodePointRef(ASSET_ID, "kw"),
    encodePointRef(ASSET_ID, "kw"),
  ];
  const at = "2026-09-23T12:30:00+02:00";
  const result = await controller.atInstant(USER, { at, refs });
  const expected = {
    at,
    items: [
      { pointRef: refs[0], time: AT, value: 209, unit: "unit-kwh_total" },
      { pointRef: refs[1], time: AT, value: 102, unit: "unit-kw" },
      { pointRef: refs[2], time: AT, value: 102, unit: "unit-kw" },
    ],
  };
  assert(
    JSON.stringify(result) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`,
  );
}

/** The service receives `at` as the instant and the DECODED pairs, in request order. */
export async function assertAtInstantHandsTheDecodedPairsToTheService(): Promise<void> {
  const { controller, calls } = atInstantStubs(null);
  await controller.atInstant(USER, {
    // `12:30+02:00` is `10:30Z`, which is `AT`.
    at: "2026-09-23T12:30:00+02:00",
    refs: [encodePointRef(FOREIGN_ASSET_ID, "kwh_total"), encodePointRef(ASSET_ID, "kw")],
  });
  const got = JSON.stringify({ at: calls[0]?.at.toISOString(), points: calls[0]?.points });
  const expected = JSON.stringify({
    at: AT,
    points: [
      { assetId: FOREIGN_ASSET_ID, pointKey: "kwh_total" },
      { assetId: ASSET_ID, pointKey: "kw" },
    ],
  });
  assert(got === expected, `expected ${expected}, got ${got}`);
}

// ---------------------------------------------------------------------------
// `F4.176` (ADR 0074 Amendment 2) — `GET /telemetry/points/latest`.
// ---------------------------------------------------------------------------

type LatestCall = { assetIds: readonly string[]; pointKeys: readonly string[]; windowMinutes: number };

/**
 * The fake service answers one reading per asset id, its value derived from
 * that id, so a swapped or dropped id changes the response rather than leaving
 * it looking right.
 */
function latestStubs(readable: string[] | null) {
  const calls: LatestCall[] = [];
  const service = {
    latestPointValues: async (
      assetIds: readonly string[],
      pointKeys: readonly string[],
      windowMinutes: number,
    ) => {
      calls.push({ assetIds, pointKeys, windowMinutes });
      return assetIds.map((assetId) => ({
        time: AT,
        assetId,
        pointKey: pointKeys[0] ?? "kw",
        value: assetId === ASSET_ID ? 101 : 202,
        unit: "kW",
      }));
    },
  } as unknown as TelemetryService;
  const access = {
    readableAssetIds: async () => readable,
  } as unknown as AccessControlService;
  return { controller: new TelemetryController(service, access), calls };
}

/**
 * One of two ids is foreign → 403 for the whole request. The in-scope id is
 * FIRST, so a guard that only checks `assetIds[0]` lets this through.
 */
export async function assertLatestRefusesWhenOneIdIsForeign(): Promise<void> {
  const { controller } = latestStubs([ASSET_ID]);
  await rejects(
    () => controller.latest(USER, { assetIds: [ASSET_ID, FOREIGN_ASSET_ID], pointKeys: ["kw"] }),
    (err) =>
      err instanceof ForbiddenException && err.message === "Asset is outside your access scope",
    "a request naming one foreign id must be refused whole with the aggregate's 403",
  );
}

/**
 * **The read must not happen.** The call count is its own claim so the
 * guard-after-read mutation reddens THIS case.
 */
export async function assertLatestRefusalRunsBeforeTheRead(): Promise<void> {
  const { controller, calls } = latestStubs([ASSET_ID]);
  try {
    await controller.latest(USER, { assetIds: [ASSET_ID, FOREIGN_ASSET_ID], pointKeys: ["kw"] });
  } catch {
    // The 403 itself is the case above.
  }
  assert(
    calls.length === 0,
    `the service was called ${calls.length} time(s) despite the refusal; the guard must run before the read`,
  );
}

/** 51 valid ids → 400 from the bound, and no read. An admin, so no scope guard fired. */
export async function assertLatestRefusesMoreThanFiftyIds(): Promise<void> {
  const { controller, calls } = latestStubs(null);
  const assetIds = Array.from(
    { length: 51 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
  await rejects(
    () => controller.latest(USER, { assetIds, pointKeys: ["kw"] }),
    (err) => err instanceof BadRequestException && err.message.includes("50"),
    "51 ids must be refused by the MAX_LATEST_ASSET_IDS bound",
  );
  assert(calls.length === 0, "an over-bound request must not reach the service");
}

/** An unrestricted admin (`readableAssetIds` → null) reads any asset. */
export async function assertLatestAdminPasses(): Promise<void> {
  const { controller, calls } = latestStubs(null);
  const result = await controller.latest(USER, { assetIds: [FOREIGN_ASSET_ID], pointKeys: ["kw"] });
  assert(calls.length === 1, `an admin must be read, got ${calls.length} read(s)`);
  assert(result.items.length === 1, "an admin must get the service's items");
}

/**
 * The parsed query reaches the service — both lists in order and the default
 * window of 15 — and the response is `{ items }` exactly as the service
 * answered.
 */
export async function assertLatestHandsTheParsedQueryToTheService(): Promise<void> {
  const { controller, calls } = latestStubs([ASSET_ID, FOREIGN_ASSET_ID]);
  const result = await controller.latest(USER, {
    assetIds: [FOREIGN_ASSET_ID, ASSET_ID],
    pointKeys: ["pf", "kw"],
  });
  const gotCall = JSON.stringify(calls[0]);
  const expectedCall = JSON.stringify({
    assetIds: [FOREIGN_ASSET_ID, ASSET_ID],
    pointKeys: ["pf", "kw"],
    windowMinutes: 15,
  });
  assert(gotCall === expectedCall, `expected the service call ${expectedCall}, got ${gotCall}`);
  const expected = JSON.stringify({
    items: [
      { time: AT, assetId: FOREIGN_ASSET_ID, pointKey: "pf", value: 202, unit: "kW" },
      { time: AT, assetId: ASSET_ID, pointKey: "pf", value: 101, unit: "kW" },
    ],
  });
  assert(JSON.stringify(result) === expected, `expected ${expected}, got ${JSON.stringify(result)}`);
}

/** An explicit window reaches the service as a number. */
export async function assertLatestPassesAnExplicitWindow(): Promise<void> {
  const { controller, calls } = latestStubs(null);
  await controller.latest(USER, { assetIds: [ASSET_ID], pointKeys: ["kw"], windowMinutes: "60" });
  assert(calls[0]?.windowMinutes === 60, `expected windowMinutes 60, got ${calls[0]?.windowMinutes}`);
}
