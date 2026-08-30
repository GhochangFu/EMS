import { BadRequestException, ForbiddenException } from "@nestjs/common";

import type { AssetHealthResponse, HealthSummaryResponse, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { AssetHealthController } from "./asset-health.controller";
import type { AssetHealthService } from "./asset-health.service";

/**
 * Closes a review-found gap: `asset-health.controller.ts` had no test at all.
 * Assertions live here; `asset-health.controller.test.ts` is the Vitest entry
 * point (ADR 0014). The pattern below follows
 * `telemetry.controller.spec.ts` — a hand-rolled stub for `AccessControlService`
 * and a call-recording stub for the service, both `as unknown as` cast rather
 * than built through Nest's testing module, since nothing here needs DI.
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
const LOCATION_ID = "99999999-9999-4999-8999-999999999999";

const FOR_ASSET_RESPONSE: AssetHealthResponse = {
  assetId: ASSET_ID,
  score: 0.5,
  band: null,
  scoredTags: [],
  unscoredTags: [],
  windowFrom: "2026-08-28T00:00:00.000Z",
  windowTo: "2026-08-29T00:00:00.000Z",
  bucketSeconds: 60,
  computedAt: null,
};

const SUMMARY_RESPONSE: HealthSummaryResponse = {
  score: null,
  assetCount: 0,
  scoredAssetCount: 0,
  unbandedAssetCount: 0,
  unscoredAssetCount: 0,
  bandCounts: [],
  windowFrom: "2026-08-28T00:00:00.000Z",
  windowTo: "2026-08-29T00:00:00.000Z",
  bucketSeconds: 60,
  computedAt: null,
};

/** A distinct array reference, so a test can assert `===`, not merely `toEqual([])`. */
const SCOPE = [ASSET_ID, "77777777-7777-4777-8777-777777777777"];

/** Records every call so a test can assert a read did NOT happen, not only that it threw. */
function serviceStub() {
  const forAssetCalls: { assetId: string; windowMinutes: number }[] = [];
  const summaryCalls: { assetIds: readonly string[] | null; locationId: string | undefined }[] = [];
  const service = {
    forAsset: async (assetId: string, windowMinutes: number) => {
      forAssetCalls.push({ assetId, windowMinutes });
      return FOR_ASSET_RESPONSE;
    },
    summary: async (assetIds: readonly string[] | null, locationId: string | undefined) => {
      summaryCalls.push({ assetIds, locationId });
      return SUMMARY_RESPONSE;
    },
  } as unknown as AssetHealthService;
  return { service, forAssetCalls, summaryCalls };
}

function accessStub(opts: { canReadAsset?: boolean; readableAssetIds?: readonly string[] | null }) {
  const canReadAssetCalls: string[] = [];
  const readableAssetIdsCalls: number[] = [];
  const access = {
    canReadAsset: async (_user: JwtPayload, assetId: string) => {
      canReadAssetCalls.push(assetId);
      return opts.canReadAsset ?? true;
    },
    readableAssetIds: async () => {
      readableAssetIdsCalls.push(1);
      return opts.readableAssetIds ?? null;
    },
  } as unknown as AccessControlService;
  return { access, canReadAssetCalls, readableAssetIdsCalls };
}

/**
 * **Assertion 1 — a denied asset never reaches the service.**
 *
 * The same shape as `telemetry.controller.spec.ts`'s
 * `assertAPointOutsideScopeIsRefusedBeforeAnyRead`: the call COUNT is asserted,
 * not only the throw, because a guard that throws after reading has already
 * read.
 */
export async function assertADeniedAssetNeverReachesTheService(): Promise<void> {
  const { service, forAssetCalls } = serviceStub();
  const { access } = accessStub({ canReadAsset: false });
  const controller = new AssetHealthController(service, access);

  await rejects(
    () => controller.forAsset(USER, ASSET_ID, {}),
    (err) => err instanceof ForbiddenException,
    "an asset outside the caller's scope must be refused",
  );
  assert(
    forAssetCalls.length === 0,
    `the service was called ${forAssetCalls.length} time(s) despite the refusal; the guard must run ` +
      "before the read, not after it",
  );
}

/**
 * **Assertion 2 — the scope value the reviewer flagged actually flows through.**
 *
 * A handler that calls `readableAssetIds(user)` and then passes `null` (or
 * `[]`) to `summary()` regardless of what the stub returned would pass every
 * OTHER test here while quietly widening the caller's scope to "everything" —
 * `AssetHealthService.summary` treats `null` as "no restriction" (its own
 * docblock). `toEqual` would not catch that substitution when the stub
 * returns `[]`, since `[] `and a hand-built `[]` are deep-equal; `===` against
 * a named constant is the assertion that actually distinguishes "the same
 * array" from "an array that happens to look the same".
 */
export async function assertTheReadableScopeFlowsThroughByReference(): Promise<void> {
  const { service, summaryCalls } = serviceStub();
  const { access } = accessStub({ readableAssetIds: SCOPE });
  const controller = new AssetHealthController(service, access);

  await controller.summary(USER, {});
  assert(summaryCalls.length === 1, `expected exactly one summary() call, got ${summaryCalls.length}`);
  assert(
    summaryCalls[0]?.assetIds === SCOPE,
    "the exact array readableAssetIds() returned must reach summary(), not a copy or a substitute",
  );
}

/** The other half: an unrestricted admin's `null` must survive as `null`, not `undefined` or `[]`. */
export async function assertAnUnrestrictedScopeStaysNull(): Promise<void> {
  const { service, summaryCalls } = serviceStub();
  const { access } = accessStub({ readableAssetIds: null });
  const controller = new AssetHealthController(service, access);

  await controller.summary(USER, {});
  assert(
    summaryCalls[0]?.assetIds === null,
    `an unrestricted admin's null scope must reach summary() as null, got ${JSON.stringify(summaryCalls[0]?.assetIds)}`,
  );
}

/**
 * **Assertion 3 — a malformed query is a 400, and the service is never called.**
 *
 * `forAsset`'s access check runs BEFORE the query is parsed (`controller.ts:54`
 * precedes `:58`), so this uses an ALLOWING access stub — a denying one would
 * throw `ForbiddenException` regardless of the query and prove nothing about
 * the 400 path.
 */
export async function assertAMalformedForAssetQueryIsABadRequest(): Promise<void> {
  const { service, forAssetCalls } = serviceStub();
  const { access } = accessStub({ canReadAsset: true });
  const controller = new AssetHealthController(service, access);

  await rejects(
    () => controller.forAsset(USER, ASSET_ID, { windowMinutes: "abc" }),
    (err) => err instanceof BadRequestException,
    "a non-numeric windowMinutes must be a 400, not a 500",
  );
  assert(forAssetCalls.length === 0, "a malformed query must not reach the service");
}

/**
 * `summary`'s ordering is the reverse of `forAsset`'s: the query is parsed
 * BEFORE `readableAssetIds` is even called (`controller.ts:82` precedes
 * `:87`), so a malformed `locationId` must refuse without touching access
 * control at all — asserted here, not only that the service was not called.
 */
export async function assertAMalformedSummaryQueryIsABadRequestBeforeAccessControl(): Promise<void> {
  const { service, summaryCalls } = serviceStub();
  const { access, readableAssetIdsCalls } = accessStub({});
  const controller = new AssetHealthController(service, access);

  await rejects(
    () => controller.summary(USER, { locationId: "not-a-uuid" }),
    (err) => err instanceof BadRequestException,
    "a non-uuid locationId must be a 400, not a 500",
  );
  assert(summaryCalls.length === 0, "a malformed query must not reach the service");
  assert(
    readableAssetIdsCalls.length === 0,
    "a malformed query must be refused before readableAssetIds is even called",
  );
}

/**
 * **Assertion 4 — `locationId` reaches the service unchanged when valid, and
 * `undefined` when absent.** Read together with assertion 2: the scope comes
 * from access control, but the narrowing filter is ordinary query input, and
 * the two must not be conflated.
 */
export async function assertLocationIdIsPassedThroughOrUndefined(): Promise<void> {
  const { service, summaryCalls } = serviceStub();
  const { access } = accessStub({ readableAssetIds: SCOPE });
  const controller = new AssetHealthController(service, access);

  await controller.summary(USER, { locationId: LOCATION_ID });
  assert(
    summaryCalls[0]?.locationId === LOCATION_ID,
    `a valid locationId must reach the service unchanged, got ${String(summaryCalls[0]?.locationId)}`,
  );

  await controller.summary(USER, {});
  assert(
    summaryCalls[1]?.locationId === undefined,
    `an absent locationId must reach the service as undefined, got ${String(summaryCalls[1]?.locationId)}`,
  );
}
