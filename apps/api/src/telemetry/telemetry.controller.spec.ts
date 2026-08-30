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
  const calls: { pointRef: string; options: Record<string, unknown> }[] = [];
  const service = {
    pointAggregate: async (pointRef: string, options: Record<string, unknown>) => {
      calls.push({ pointRef, options });
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
