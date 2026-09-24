import { BadRequestException } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { AlarmDetailsService } from "./alarm-details.service";
import type { AlarmEnrichmentService } from "./alarm-enrichment.service";
import { AlarmsController } from "./alarms.controller";
import type { AlarmsService } from "./alarms.service";

/**
 * `F3.28` (ADR 0074 decision 4) — the query-parse and scope-intersect wiring
 * of `GET /alarms`, with no database. Assertions live here;
 * `alarms.controller.test.ts` is the Vitest entry point (ADR 0014). The
 * harness follows `asset-health.controller.spec.ts`: a hand-rolled
 * `AccessControlService` stub and a call-recording service stub, cast
 * `as unknown as`, since nothing here needs DI.
 *
 * The database-backed proof that a foreign asset returns nothing is in
 * `alarms.service.rls.integration.spec.ts`; this file holds the same wiring
 * without `DATABASE_URL`, so a local run without the stack still gates it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const READABLE_A = "11111111-1111-4111-8111-111111111111";
const READABLE_B = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";

type ListCall = Parameters<AlarmsService["list"]>[0];

function harness(readable: string[] | null) {
  const listCalls: ListCall[] = [];
  let scopeReads = 0;
  const service = {
    list: async (opts: ListCall) => {
      listCalls.push(opts);
      return { items: [], nextCursor: null };
    },
  } as unknown as AlarmsService;
  const accessControl = {
    readableAssetIds: async () => {
      scopeReads += 1;
      return readable;
    },
  } as unknown as AccessControlService;
  const controller = new AlarmsController(
    service,
    accessControl,
    {} as unknown as AlarmDetailsService,
    {} as unknown as AlarmEnrichmentService,
  );
  return { controller, listCalls, scopeReads: () => scopeReads };
}

/** A requested id outside the readable set is dropped: the service gets only the overlap. */
export async function assertARequestedForeignAssetNeverWidensTheList(): Promise<void> {
  const h = harness([READABLE_A, READABLE_B]);
  await h.controller.list(USER, { assetIds: [READABLE_B, FOREIGN] });
  assert(h.listCalls.length === 1, `list was called ${h.listCalls.length} times, not once`);
  const passed = h.listCalls[0]?.assetIds;
  assert(
    JSON.stringify(passed) === JSON.stringify([READABLE_B]),
    `the service got ${JSON.stringify(passed)}, not the intersection [READABLE_B]`,
  );
}

/** Only a foreign id requested → `[]`, never `null` (which would mean every row). */
export async function assertAnAllForeignRequestBecomesAnEmptyScope(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.list(USER, { assetIds: FOREIGN });
  const passed = h.listCalls[0]?.assetIds;
  assert(
    Array.isArray(passed) && passed.length === 0,
    `the service got ${JSON.stringify(passed)}, not an empty scope []`,
  );
}

/** No request → the caller's readable set, untouched; `state` defaults to `all`, `limit` to 20. */
export async function assertAnEmptyQueryKeepsTodaysRead(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.list(USER, {});
  const call = h.listCalls[0];
  assert(
    JSON.stringify(call) ===
      JSON.stringify({ cursor: undefined, limit: 20, state: "all", assetIds: [READABLE_A] }),
    `an empty query reached the service as ${JSON.stringify(call)}`,
  );
}

/** An unrestricted reader stays unrestricted when they ask for nothing in particular. */
export async function assertAnUnrestrictedScopeStaysNull(): Promise<void> {
  const h = harness(null);
  await h.controller.list(USER, {});
  const call = h.listCalls[0];
  assert(call?.assetIds === null, `the admin scope reached the service as ${String(call?.assetIds)}`);
}

/** `state=active` reaches the service as `"active"`. */
export async function assertStateActiveIsPassedThrough(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.list(USER, { state: "active" });
  const state = h.listCalls[0]?.state;
  assert(state === "active", `state reached the service as ${String(state)}`);
}

/** `limit` arrives as a string; it is coerced, and the service still owns the clamp. */
export async function assertLimitIsCoercedAndPassedThrough(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.list(USER, { limit: "500" });
  const limit = h.listCalls[0]?.limit;
  assert(limit === 500, `limit reached the service as ${String(limit)}, not 500 (the service clamps)`);
}

async function listRejection(h: ReturnType<typeof harness>, query: Record<string, unknown>) {
  try {
    await h.controller.list(USER, query);
  } catch (err) {
    return err;
  }
  return undefined;
}

/** A malformed query is a 400 (the file's ZodError → BadRequestException convention). */
export async function assertAMalformedListQueryIsABadRequest(): Promise<void> {
  const h = harness([READABLE_A]);
  const thrown = await listRejection(h, { state: "open" });
  assert(thrown instanceof BadRequestException, `state=open threw ${String(thrown)}, not a 400`);
}

/** A malformed query reads no scope and lists nothing. */
export async function assertAMalformedListQueryRunsNothing(): Promise<void> {
  const h = harness([READABLE_A]);
  await listRejection(h, { assetIds: "not-a-uuid" });
  assert(h.scopeReads() === 0, "readableAssetIds ran on a malformed query");
  assert(h.listCalls.length === 0, "the service ran on a malformed query");
}
