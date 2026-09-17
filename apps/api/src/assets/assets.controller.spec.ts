import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AdminAssetPointDto, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { repoRoot } from "../testing/repo-root";
import { methodBody } from "../testing/source-scan";
import { AssetsController } from "./assets.controller";
import type { AssetsService } from "./assets.service";

/**
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 3) — `GET /assets/:assetId/points`,
 * the point read that is not master-data administration. Assertions live
 * here; `assets.controller.test.ts` is the Vitest entry point (§4.6/ADR 0014).
 *
 * Two halves, the `asset-images.controller.spec.ts` shape:
 *
 *  - **behavioural**: the controller is constructed by hand over an
 *    `accessStub` and a call-recording `assetsStub`, so "denied → 403 and
 *    the service is never called" and "a non-uuid segment never reaches the
 *    guard" are measured rather than read, with the positive control that an
 *    allowed call reaches the service once with the parsed id;
 *  - **a source scan**: `canReadAsset` precedes `this.assets.listPoints` in
 *    the handler body (a guard that throws after reading has already read —
 *    the `asset-health.controller.ts` rule), with the positive control that
 *    the scan reads the right handler: `list`'s body still names
 *    `readableAssetIds` and `listPoints`' does not.
 *
 * Why a scan as well as the stubs: `F4.20` records that esbuild emits no
 * `design:paramtypes`, so the module cannot be booted to ask the router; the
 * text is what proves the declaration order the router reads.
 */
const CONTROLLER = join(repoRoot(), "apps/api/src/assets/assets.controller.ts");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function source(): string {
  return readFileSync(CONTROLLER, "utf8");
}

/** `list` runs from its `async list(` to the points route's decorator. */
function listBody(text: string): string {
  return methodBody(text, "async list(", '@Get(":assetId/points")');
}

/** `listPoints` is the last handler, so its body runs to the end of the file. */
function listPointsBody(text: string): string {
  const from = text.indexOf("async listPoints(");
  assert(from > -1, "the controller must declare async listPoints(");
  return text.slice(from);
}

// ---------------------------------------------------------------------------
// Behavioural: the guard refuses before the service, over stubs
// ---------------------------------------------------------------------------

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "asset_group_admin" };
const ASSET_ID = "22222222-2222-4222-8222-222222222222";

const POINT: AdminAssetPointDto = {
  id: "33333333-3333-4333-8333-333333333333",
  assetId: ASSET_ID,
  assetCode: "CR-HVAC-1",
  assetName: "Chiller 1",
  locationId: "44444444-4444-4444-8444-444444444444",
  locationName: "Western Cape",
  pointKey: "supply_temp",
  sourceDataKey: "supply_temp",
  sensorCode: null,
  unit: "°C",
  active: true,
  sourceKind: "measured",
  rtuId: null,
  createdAt: "2026-09-18T10:00:00.000Z",
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

function accessStub(opts: { canReadAsset: boolean }) {
  const canReadAssetCalls: string[] = [];
  const access = {
    canReadAsset: async (_user: JwtPayload, assetId: string) => {
      canReadAssetCalls.push(assetId);
      return opts.canReadAsset;
    },
  } as unknown as AccessControlService;
  return { access, canReadAssetCalls };
}

/** Records every call so a test can assert a read did NOT happen, not only that it threw. */
function assetsStub() {
  const calls: string[] = [];
  const assets = {
    listPoints: async (assetId: string) => {
      calls.push(`listPoints ${assetId}`);
      return { items: [POINT] };
    },
  } as unknown as AssetsService;
  return { assets, calls };
}

async function rejects(run: () => Promise<unknown>): Promise<unknown> {
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

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null ? String((err as { name?: unknown }).name) : String(err);
}

async function runDenied() {
  const { access } = accessStub({ canReadAsset: false });
  const { assets, calls } = assetsStub();
  const controller = new AssetsController(assets, access);
  const err = await rejects(() => controller.listPoints(USER, ASSET_ID));
  return { err, calls };
}

export async function assertDeniedAssetThrowsForbidden(): Promise<void> {
  const { err } = await runDenied();
  assert(errorName(err) === "ForbiddenException", `listPoints on a denied asset threw ${errorName(err)}`);
}

export async function assertDeniedAssetNeverReachesTheService(): Promise<void> {
  const { calls } = await runDenied();
  assert(calls.length === 0, `listPoints on a denied asset reached the service: ${calls.join(", ")}`);
}

/** The positive control: allowed, the service is called once with the parsed id. */
export async function assertAllowedAssetReachesTheServiceOnce(): Promise<void> {
  const { access } = accessStub({ canReadAsset: true });
  const { assets, calls } = assetsStub();
  const controller = new AssetsController(assets, access);
  const result = await controller.listPoints(USER, ASSET_ID);
  assert(
    calls.length === 1 && calls[0] === `listPoints ${ASSET_ID}` && result.items.length === 1,
    `expected one listPoints call and one item, got calls ${calls.join(", ")} and ${result.items.length} items`,
  );
}

/** The positive control for the guard counter: an allowed uuid does reach `canReadAsset`, once, with the parsed id. */
export async function assertAllowedAssetReachesTheGuardOnce(): Promise<void> {
  const { access, canReadAssetCalls } = accessStub({ canReadAsset: true });
  const { assets } = assetsStub();
  const controller = new AssetsController(assets, access);
  await controller.listPoints(USER, ASSET_ID);
  assert(
    canReadAssetCalls.length === 1 && canReadAssetCalls[0] === ASSET_ID,
    `expected one canReadAsset call with ${ASSET_ID}, got ${canReadAssetCalls.join(", ")}`,
  );
}

async function runNonUuid() {
  const { access, canReadAssetCalls } = accessStub({ canReadAsset: true });
  const { assets, calls } = assetsStub();
  const controller = new AssetsController(assets, access);
  const err = await rejects(() => controller.listPoints(USER, "not-a-uuid"));
  return { err, canReadAssetCalls, calls };
}

/** A non-uuid segment is a `ZodError` — the global `ZodErrorFilter` turns it into a 400. */
export async function assertNonUuidSegmentThrowsZodError(): Promise<void> {
  const { err } = await runNonUuid();
  assert(errorName(err) === "ZodError", `listPoints on a non-uuid segment threw ${errorName(err)}`);
}

export async function assertNonUuidSegmentNeverReachesTheGuard(): Promise<void> {
  const { canReadAssetCalls } = await runNonUuid();
  assert(
    canReadAssetCalls.length === 0,
    `listPoints on a non-uuid segment reached canReadAsset with: ${canReadAssetCalls.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// The guard runs before the service, in the text the router reads
// ---------------------------------------------------------------------------

export function assertListPointsChecksAccessBeforeTheService(): void {
  const body = listPointsBody(source());
  const guard = body.indexOf("canReadAsset");
  const service = body.indexOf("this.assets.listPoints(");
  assert(guard > -1 && service > -1, "the scan must find both canReadAsset and this.assets.listPoints( in listPoints");
  assert(guard < service, `listPoints calls this.assets.listPoints( (at ${service}) before canReadAsset (at ${guard})`);
}

export function assertListPointsRefusesWithTheScopeMessage(): void {
  assert(
    listPointsBody(source()).includes('"Asset is outside your access scope"'),
    "listPoints must refuse with the asset-health 403 message",
  );
}

/** The positive control that the scan reads the right handler: `list` still lists through `readableAssetIds`, and `listPoints` does not. */
export function assertScanFindsTheListHandlerOnReadableAssetIds(): void {
  const text = source();
  assert(listBody(text).includes("readableAssetIds"), "list must still narrow through readableAssetIds");
  assert(!listPointsBody(text).includes("readableAssetIds"), "listPoints must gate on canReadAsset, not readableAssetIds");
}
