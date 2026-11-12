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

const SITE = "55555555-5555-4555-8555-555555555555";
const READABLE_LOCATIONS = [SITE, "66666666-6666-4666-8666-666666666666"];
const READABLE_ORGANIZATIONS = ["77777777-7777-4777-8777-777777777777"];

function harness(readable: string[] | null) {
  const listCalls: ListCall[] = [];
  const summaryCalls: (string[] | null | undefined)[] = [];
  const summaryOrgs: (string | undefined)[] = [];
  const summaryLocations: unknown[] = [];
  let scopeReads = 0;
  let locationReads = 0;
  const service = {
    list: async (opts: ListCall) => {
      listCalls.push(opts);
      return { items: [], nextCursor: null };
    },
    activeCountsBySeverity: async (
      assetIds: string[] | null | undefined,
      organizationId?: string,
      location?: unknown,
    ) => {
      summaryCalls.push(assetIds);
      summaryOrgs.push(organizationId);
      summaryLocations.push(location);
      return { items: [], total: 0 };
    },
  } as unknown as AlarmsService;
  const accessControl = {
    readableAssetIds: async () => {
      scopeReads += 1;
      return readable;
    },
    // F4.357 U2: the two sets a `locationId` filter carries (owner rulings P2, P3).
    readableLocationIds: async () => {
      locationReads += 1;
      return READABLE_LOCATIONS;
    },
    readableOrganizationIds: async () => READABLE_ORGANIZATIONS,
  } as unknown as AccessControlService;
  const controller = new AlarmsController(
    service,
    accessControl,
    {} as unknown as AlarmDetailsService,
    {} as unknown as AlarmEnrichmentService,
  );
  return {
    controller,
    listCalls,
    summaryCalls,
    summaryOrgs,
    summaryLocations,
    scopeReads: () => scopeReads,
    locationReads: () => locationReads,
  };
}

/** `GET /alarms/summary`: a requested id outside the readable set is dropped, as on the list. */
export async function assertARequestedForeignAssetNeverWidensTheSummary(): Promise<void> {
  const h = harness([READABLE_A, READABLE_B]);
  await h.controller.summary(USER, { assetIds: [READABLE_A, FOREIGN] });
  const passed = h.summaryCalls[0];
  assert(
    JSON.stringify(passed) === JSON.stringify([READABLE_A]),
    `the summary got ${JSON.stringify(passed)}, not the intersection [READABLE_A]`,
  );
}

/** `GET /alarms/summary` with no filter reads the caller's whole readable set. */
export async function assertAnEmptySummaryQueryUsesTheReadableScope(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.summary(USER, {});
  const passed = h.summaryCalls[0];
  assert(
    JSON.stringify(passed) === JSON.stringify([READABLE_A]),
    `the summary got ${JSON.stringify(passed)}, not the readable set`,
  );
}

/** The summary takes no `state`: it is an unknown key there, and a 400. */
export async function assertAMalformedSummaryQueryIsABadRequest(): Promise<void> {
  const h = harness([READABLE_A]);
  let thrown: unknown;
  try {
    await h.controller.summary(USER, { state: "active" });
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof BadRequestException, `state on the summary threw ${String(thrown)}, not a 400`);
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

/** Plan decision 4: `limit=abc` is still a 400 at the controller, as before. */
export async function assertANonNumericLimitIsABadRequest(): Promise<void> {
  const h = harness([READABLE_A]);
  const thrown = await listRejection(h, { limit: "abc" });
  assert(thrown instanceof BadRequestException, `limit=abc threw ${String(thrown)}, not a 400`);
}

/** A malformed query reads no scope and lists nothing. */
export async function assertAMalformedListQueryRunsNothing(): Promise<void> {
  const h = harness([READABLE_A]);
  await listRejection(h, { assetIds: "not-a-uuid" });
  assert(h.scopeReads() === 0, "readableAssetIds ran on a malformed query");
  assert(h.listCalls.length === 0, "the service ran on a malformed query");
}

/*
 * `F3.66` (step-5 fix) — `organizationId` narrows both reads and never widens
 * them: the readable set still reaches the service beside it.
 */

const ORG = "44444444-4444-4444-8444-444444444444";

/** `GET /alarms?organizationId=`: the service gets the organization id. */
export async function assertListPassesTheOrganizationIdThrough(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.list(USER, { organizationId: ORG });
  const passed = h.listCalls[0]?.organizationId;
  assert(passed === ORG, `the list got organizationId ${String(passed)}, not ${ORG}`);
}

/** `GET /alarms?organizationId=`: the readable set still reaches the service — never dropped. */
export async function assertListOrganizationIdKeepsTheReadableScope(): Promise<void> {
  const h = harness([READABLE_A, READABLE_B]);
  await h.controller.list(USER, { organizationId: ORG });
  const passed = h.listCalls[0]?.assetIds;
  assert(
    JSON.stringify(passed) === JSON.stringify([READABLE_A, READABLE_B]),
    `the list got assetIds ${JSON.stringify(passed)}, not the readable set`,
  );
}

/** `GET /alarms?organizationId=not-a-uuid` is a 400. */
export async function assertListNonUuidOrganizationIdIsABadRequest(): Promise<void> {
  const h = harness([READABLE_A]);
  const thrown = await listRejection(h, { organizationId: "not-a-uuid" });
  assert(thrown instanceof BadRequestException, `organizationId=not-a-uuid threw ${String(thrown)}, not a 400`);
}

/** `GET /alarms` with no `organizationId` passes none — today's read. */
export async function assertListAbsentOrganizationIdPassesNone(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.list(USER, {});
  const passed = h.listCalls[0]?.organizationId;
  assert(passed === undefined, `an absent organizationId reached the list as ${String(passed)}`);
}

/** `GET /alarms/summary?organizationId=`: the summary gets the organization id. */
export async function assertSummaryPassesTheOrganizationIdThrough(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.summary(USER, { organizationId: ORG });
  const passed = h.summaryOrgs[0];
  assert(passed === ORG, `the summary got organizationId ${String(passed)}, not ${ORG}`);
}

/** `GET /alarms/summary?organizationId=`: the readable set still reaches the summary. */
export async function assertSummaryOrganizationIdKeepsTheReadableScope(): Promise<void> {
  const h = harness([READABLE_A, READABLE_B]);
  await h.controller.summary(USER, { organizationId: ORG });
  const passed = h.summaryCalls[0];
  assert(
    JSON.stringify(passed) === JSON.stringify([READABLE_A, READABLE_B]),
    `the summary got assetIds ${JSON.stringify(passed)}, not the readable set`,
  );
}

/** `GET /alarms/summary?organizationId=not-a-uuid` is a 400. */
export async function assertSummaryNonUuidOrganizationIdIsABadRequest(): Promise<void> {
  const h = harness([READABLE_A]);
  let thrown: unknown;
  try {
    await h.controller.summary(USER, { organizationId: "not-a-uuid" });
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof BadRequestException, `organizationId=not-a-uuid threw ${String(thrown)}, not a 400`);
}

/*
 * `F4.357` U2 (ADR 0130 decision 15) — `locationId` narrows both reads to a
 * location and its sub-locations. The controller passes the node with the
 * caller's readable locations and organizations (the `asset-health` filter's
 * shape, owner rulings P2 and P3), and `assetIds` stays the intersected set.
 */

const LOCATION_FILTER = { id: SITE, readableLocationIds: READABLE_LOCATIONS, readableOrganizationIds: READABLE_ORGANIZATIONS };

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `GET /alarms?locationId=`: the service gets the filter and the unchanged intersected scope. */
export async function assertListPassesTheLocationFilter(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.list(USER, { locationId: SITE, assetIds: [READABLE_A, FOREIGN] });
  const call = h.listCalls[0];
  assert(same(call?.location, LOCATION_FILTER), `the list got location ${JSON.stringify(call?.location)}`);
  assert(same(call?.assetIds, [READABLE_A]), `the list's assetIds became ${JSON.stringify(call?.assetIds)}`);
}

/** `GET /alarms` with no `locationId`: no filter, and no location read. */
export async function assertListWithoutLocationIdReadsNoLocations(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.list(USER, {});
  assert(h.listCalls[0]?.location === undefined, "an absent locationId reached the list as a filter");
  assert(h.locationReads() === 0, "readableLocationIds ran without a locationId");
}

/** `GET /alarms/summary?locationId=`: the summary gets the same filter, the scope still intersected. */
export async function assertSummaryPassesTheLocationFilter(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.summary(USER, { locationId: SITE, assetIds: [READABLE_A, FOREIGN] });
  assert(same(h.summaryLocations[0], LOCATION_FILTER), `the summary got location ${JSON.stringify(h.summaryLocations[0])}`);
  assert(same(h.summaryCalls[0], [READABLE_A]), `the summary's assetIds became ${JSON.stringify(h.summaryCalls[0])}`);
}

/** `GET /alarms/summary` with no `locationId`: no filter, and no location read. */
export async function assertSummaryWithoutLocationIdReadsNoLocations(): Promise<void> {
  const h = harness([READABLE_A]);
  await h.controller.summary(USER, {});
  assert(h.summaryLocations[0] === undefined, "an absent locationId reached the summary as a filter");
  assert(h.locationReads() === 0, "readableLocationIds ran without a locationId");
}
