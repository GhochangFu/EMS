import "reflect-metadata";

import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { JwtPayload, SystemStatusResponse } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MapController } from "../map/map.controller";
import { SystemStatusController } from "./system-status.controller";
import type { SystemStatusService } from "./system-status.service";

/**
 * `F3.30` (ADR 0075 decision 4) — `GET /api/v1/system/status`. Assertions
 * live here; `system-status.controller.test.ts` is the Vitest entry point
 * (§4.6 / ADR 0014).
 *
 * Two halves:
 *
 *  - **behavioural**: the controller is constructed by hand over an
 *    `accessStub` and a call-recording `serviceStub`, so "the caller's scope
 *    reaches `read` by reference" and "no role gate runs" are measured;
 *  - **decorator metadata**: the route, the verb and `JwtAuthGuard` are read
 *    from the same metadata keys Nest's router and guard consumer read at
 *    boot. `F4.20` records that esbuild emits no `design:paramtypes`, so the
 *    module cannot be booted here; the decorators themselves still run, and
 *    their metadata is the declaration the router reads. The positive control
 *    for the guard read is a neighbour, `MapController`, which carries the
 *    same guard — so a read that finds nothing cannot pass.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "asset_group_admin" };

const BODY: SystemStatusResponse = {
  status: "operational",
  components: [
    { key: "queue", state: "ok" },
    { key: "storage", state: "not_configured" },
    { key: "field_data", state: "not_monitored" },
  ],
  dataQuality: { percent: null, freshAssets: 0, streamingAssets: 0, windowSeconds: 25 },
  checkedAt: "2026-09-25T00:00:00.000Z",
};

function accessStub(readable: string[] | null) {
  const readableCalls: JwtPayload[] = [];
  const roleGateCalls: string[] = [];
  const access = {
    readableAssetIds: async (user: JwtPayload) => {
      readableCalls.push(user);
      return readable;
    },
    assertMasterDataRole: () => {
      roleGateCalls.push("assertMasterDataRole");
    },
    assertOperationsWriteRole: async () => {
      roleGateCalls.push("assertOperationsWriteRole");
    },
  } as unknown as AccessControlService;
  return { access, readableCalls, roleGateCalls };
}

/** Records the scope each `read` call received. */
function serviceStub() {
  const calls: (string[] | null | undefined)[] = [];
  const service = {
    read: async (assetIds: string[] | null | undefined): Promise<SystemStatusResponse> => {
      calls.push(assetIds);
      return BODY;
    },
  } as unknown as SystemStatusService;
  return { service, calls };
}

async function run(readable: string[] | null) {
  const stubs = accessStub(readable);
  const svc = serviceStub();
  const controller = new SystemStatusController(svc.service, stubs.access);
  const result = await controller.status(USER);
  return { ...stubs, calls: svc.calls, result };
}

// ---------------------------------------------------------------------------
// Behavioural: the scope reaches the service by reference
// ---------------------------------------------------------------------------

/** A scoped caller's `readableAssetIds` array reaches `read` as the same array. */
export async function assertScopedReaderPassesItsArrayByReference(): Promise<void> {
  const readable = ["x"];
  const { calls } = await run(readable);
  assert(
    calls.length === 1 && calls[0] === readable,
    `expected one read call with the readableAssetIds array itself, got ${JSON.stringify(calls)}`,
  );
}

/** An unrestricted reader (`readableAssetIds` null) reaches `read(null)`. */
export async function assertUnrestrictedReaderPassesNull(): Promise<void> {
  const { calls } = await run(null);
  assert(calls.length === 1 && calls[0] === null, `expected one read call with null, got ${JSON.stringify(calls)}`);
}

/** The handler returns the service's body unchanged. */
export async function assertHandlerReturnsTheServiceBody(): Promise<void> {
  const { result } = await run(["x"]);
  assert(result === BODY, "the handler must return the service's body");
}

/** The scope is resolved from the request's user, once. */
export async function assertScopeIsResolvedForTheCaller(): Promise<void> {
  const { readableCalls } = await run(["x"]);
  assert(
    readableCalls.length === 1 && readableCalls[0] === USER,
    `expected one readableAssetIds call with the caller, got ${readableCalls.length}`,
  );
}

/** Open to every role: no master-data or operations-write gate runs. */
export async function assertNoRoleGateRuns(): Promise<void> {
  const { roleGateCalls, readableCalls } = await run(["x"]);
  assert(readableCalls.length === 1, "positive control: the handler must have run and resolved the scope");
  assert(roleGateCalls.length === 0, `the route must be open to every role, but called ${roleGateCalls.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Decorator metadata: the route and the guard the router reads
// ---------------------------------------------------------------------------

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];
}

/** Positive control: the read finds `JwtAuthGuard` on a neighbour controller. */
export function assertGuardReadFindsTheNeighbourGuard(): void {
  assert(guardsOf(MapController).includes(JwtAuthGuard), "the guard read must find JwtAuthGuard on MapController");
}

/** The class carries `@UseGuards(JwtAuthGuard)`: this is tenant data, not `/health`'s liveness. */
export function assertControllerIsBehindJwtAuthGuard(): void {
  const guards = guardsOf(SystemStatusController);
  assert(guards.includes(JwtAuthGuard), `SystemStatusController must carry @UseGuards(JwtAuthGuard), found ${guards.length} guard(s)`);
}

/** The controller path is `system`, not `health`. */
export function assertControllerPathIsSystem(): void {
  const path = Reflect.getMetadata(PATH_METADATA, SystemStatusController) as unknown;
  assert(path === "system", `expected controller path "system", got ${JSON.stringify(path)}`);
}

/** The handler is `GET status`. */
export function assertHandlerIsGetStatus(): void {
  const handler = SystemStatusController.prototype.status;
  const path = Reflect.getMetadata(PATH_METADATA, handler) as unknown;
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as unknown;
  assert(
    path === "status" && method === RequestMethod.GET,
    `expected GET "status", got ${String(method)} ${JSON.stringify(path)}`,
  );
}
