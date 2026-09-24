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
  const service = {
    pointAggregate: async (
      point: { assetId: string; pointKey: string },
      options: Record<string, unknown>,
    ) => {
      calls.push({ point, options });
      return RESPONSE;
    },
  } as unknown as TelemetryService;
  return { service, calls };
}

function accessStub(allow: boolean) {
  return {
    canReadAsset: async () => allow,
  } as unknown as AccessControlService;
}

function controllerWith(allow: boolean) {
  const { service, calls } = serviceStub();
  return { controller: new TelemetryController(service, accessStub(allow)), calls };
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
