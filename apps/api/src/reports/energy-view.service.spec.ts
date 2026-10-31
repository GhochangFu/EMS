import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import { locations, organizations } from "@bms/db";
import type { EnergyView, EnergyViewQuery, JwtPayload } from "@bms/shared";

import {
  ENERGY_VIEW_ORGANIZATION_MISMATCH,
  ENERGY_VIEW_ORGANIZATION_REQUIRED,
  EnergyViewService,
} from "./energy-view.service";

/**
 * `F4.298` U4 (ADR 0108 decisions 2.2, 2.5, 2.8 and 2.9) — `EnergyViewService`
 * over fakes with call logs (the `report-scope.spec.ts` style). What the
 * database answers is `energy-view-read.integration.spec.ts`'s and
 * `energy-view.integration.spec.ts`'s; this file holds the order of the checks,
 * the zone chain, the asset-id bound and what leaves the server. Vitest entry
 * point: the sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const ADMIN = { sub: "22222222-2222-4222-8222-222222222222", role: "admin" } as JwtPayload;
const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const SITE_1 = "40000000-0000-4000-8000-000000000001";
const SITE_2 = "40000000-0000-4000-8000-000000000002";
const SITE_HIDDEN = "40000000-0000-4000-8000-0000000000ff";
const ASSET_1 = "30000000-0000-4000-8000-000000000001";
const ASSET_2 = "30000000-0000-4000-8000-000000000002";

type Place = { organizationId: string; assetIds: string[] };

type Options = {
  readableOrganizations?: string[] | null;
  readableLocations?: string[] | null;
  /** `readableAssetIdsInOrganization`'s answer. */
  organizationAssets?: string[];
  /** `placeForCaller`'s answer, or the refusal it throws. */
  place?: Place | Error;
  organizationZone?: string | null;
  locationZone?: string | null;
  /** `expandLocationSubtrees`'s answer (the named locations' subtree). */
  subtree?: string[];
  /** The organization's active locations (no location named). */
  organizationLocations?: string[];
  /** The fake telemetry answers: `true` returns one bucket of data. */
  withData?: boolean;
};

type Statement = { text: string; params: unknown[] };

function periodRow() {
  return {
    total_kwh: 120,
    solar_kwh: 20,
    peak_kw: 15,
    peak_at: "2026-10-31T03:00:00.000Z",
    bucket_count: 1,
    series: [{ t: "2026-10-31T03:00:00.000Z", total_kw: 15, solar_kw: 2 }],
  };
}

function fake(options: Options = {}) {
  const calls: string[] = [];
  const statements: Statement[] = [];
  const access = {
    readableOrganizationIds: async () => {
      calls.push("readableOrganizationIds");
      return options.readableOrganizations === undefined ? [ORG_A] : options.readableOrganizations;
    },
    readableLocationIds: async () => {
      calls.push("readableLocationIds");
      return options.readableLocations === undefined ? [SITE_1, SITE_2] : options.readableLocations;
    },
    readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => {
      calls.push(`readableAssetIdsInOrganization:${organizationId}`);
      return options.organizationAssets ?? [ASSET_1, ASSET_2];
    },
  };
  const scope = {
    placeForCaller: async (_user: JwtPayload, locationIds: readonly string[]) => {
      calls.push(`placeForCaller:${locationIds.join(",")}`);
      const place = options.place ?? { organizationId: ORG_A, assetIds: [ASSET_1] };
      if (place instanceof Error) throw place;
      return place;
    },
  };
  const fleetDb = {
    select: (columns: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: async () => {
          const keys = Object.keys(columns).join(",");
          if (table === organizations) {
            calls.push("select:organizations");
            const zone = options.organizationZone === undefined ? "Europe/London" : options.organizationZone;
            return zone === null ? [] : [{ timezone: zone }];
          }
          if (table === locations && keys === "timezone") {
            calls.push("select:locations.timezone");
            return [{ timezone: options.locationZone === undefined ? null : options.locationZone }];
          }
          if (table === locations) {
            calls.push("select:locations");
            return (options.organizationLocations ?? [SITE_1, SITE_2]).map((id) => ({ id }));
          }
          throw new Error("unexpected select");
        },
      }),
    }),
    execute: async () => {
      calls.push("execute:subtree");
      return { rows: (options.subtree ?? [SITE_1]).map((id) => ({ id })) };
    },
  };
  const pool = {
    query: async (text: string, params: unknown[]) => {
      calls.push("pool");
      statements.push({ text, params });
      if (!options.withData) return { rows: [] };
      if (text.includes("bucket_count")) return { rows: [periodRow()] };
      if (text.includes("avg_pf")) return { rows: [{ avg_pf: 0.9 }] };
      if (text.includes("LIMIT $3")) {
        return { rows: [{ id: ASSET_1, code: "M-1", name: "Meter 1", site_name: "Site 1", avg_kw: "10" }] };
      }
      return { rows: [] };
    },
  };
  const tariffs = { resolveForAssets: async () => new Map<string, number>() };
  const service = new EnergyViewService(pool as never, fleetDb as never, tariffs, access, scope);
  return { service, calls, statements };
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("resolved, expected a refusal");
}

const TODAY: EnergyViewQuery = { range: "today" };

/** The statements that read the period (`energyPeriodRead`), by their one marker. */
function periodReads(statements: readonly Statement[]): Statement[] {
  return statements.filter((s) => s.text.includes("bucket_count"));
}

/** Every array bound to any telemetry statement. */
function boundLists(statements: readonly Statement[]): unknown[] {
  return statements.flatMap((s) => s.params.filter((p) => Array.isArray(p)));
}

// --- the organization rule (decision 2.2) ---------------------------------

/** A global admin naming nothing is a 400 naming `organizationId` — there is no fleet-wide view. */
export async function aGlobalAdminNamingNothingIsA400(): Promise<void> {
  const f = fake({ readableOrganizations: null });
  const err = await refusal(f.service.view(ADMIN, TODAY));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err.message).toBe(ENERGY_VIEW_ORGANIZATION_REQUIRED);
  expect(err.message).toContain("organizationId");
}

/** A caller who reads exactly one organization and names nothing gets that organization. */
export async function aSingleOrganizationCallerGetsThatOrganization(): Promise<void> {
  const f = fake({ readableOrganizations: [ORG_B] });
  const view = await f.service.view(USER, TODAY);
  expect(view.organizationId).toBe(ORG_B);
  expect(f.calls).toContain(`readableAssetIdsInOrganization:${ORG_B}`);
}

/** An `organizationId` the caller does not read is a 403, and no telemetry is read. */
export async function anUnreadableOrganizationIsA403(): Promise<void> {
  const f = fake({ readableOrganizations: [ORG_A] });
  const err = await refusal(f.service.view(USER, { ...TODAY, organizationId: ORG_B }));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(f.statements).toEqual([]);
}

/** Readable locations of organization A with `organizationId` B are a 400. */
export async function readableLocationsOfAnotherOrganizationAreA400(): Promise<void> {
  const f = fake({ place: { organizationId: ORG_A, assetIds: [ASSET_1] } });
  const err = await refusal(f.service.view(USER, { ...TODAY, locationIds: [SITE_1], organizationId: ORG_B }));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err.message).toBe(ENERGY_VIEW_ORGANIZATION_MISMATCH);
  expect(f.statements).toEqual([]);
}

/**
 * Locations the caller cannot read are a 403 before the organization is
 * compared: the scope refusal propagates, and nothing after the place —
 * the organization list, the zone read, a telemetry read — runs.
 */
export async function unreadableLocationsAreA403BeforeTheOrganizationIsCompared(): Promise<void> {
  const f = fake({ place: new ForbiddenException("locationIds is outside your access scope") });
  const err = await refusal(f.service.view(USER, { ...TODAY, locationIds: [SITE_HIDDEN], organizationId: ORG_B }));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(f.calls).toEqual([`placeForCaller:${SITE_HIDDEN}`]);
}

// --- the zone chain (decision 2.8) ----------------------------------------

/** One location named: its own zone. */
export async function oneLocationNamedUsesItsZone(): Promise<void> {
  const f = fake({ locationZone: "Asia/Kolkata", organizationZone: "Europe/London" });
  const view = await f.service.view(USER, { ...TODAY, locationIds: [SITE_1] });
  expect(view.timeZone).toBe("Asia/Kolkata");
}

/** One location named with no zone: the organization's. */
export async function aLocationWithNoZoneUsesTheOrganizations(): Promise<void> {
  const f = fake({ locationZone: null, organizationZone: "Europe/London" });
  const view = await f.service.view(USER, { ...TODAY, locationIds: [SITE_1] });
  expect(view.timeZone).toBe("Europe/London");
}

/** A stored `UTC` is reported as `UTC` and computed on `Etc/UTC`: today starts at UTC midnight. */
export async function aStoredUtcIsComputedOnEtcUtc(): Promise<void> {
  const f = fake({ organizationZone: "UTC" });
  const view = await f.service.view(USER, TODAY);
  expect(view.timeZone).toBe("UTC");
  const midnight = new Date(view.current.to);
  midnight.setUTCHours(0, 0, 0, 0);
  expect(view.current.from).toBe(midnight.toISOString());
}

/** Two locations named, both in one zone: still the organization's zone. */
export async function twoLocationsUseTheOrganizationsZone(): Promise<void> {
  const f = fake({ locationZone: "Asia/Kolkata", organizationZone: "Europe/London" });
  const view = await f.service.view(USER, { ...TODAY, locationIds: [SITE_1, SITE_2] });
  expect(view.timeZone).toBe("Europe/London");
  expect(f.calls).not.toContain("select:locations.timezone");
}

/** A stored zone that fails `isValidTimeZone` falls to the next link, never a 500. */
export async function anInvalidZoneFallsToTheNextLink(): Promise<void> {
  const f = fake({ locationZone: "not-a-zone", organizationZone: "Asia/Kolkata" });
  const view = await f.service.view(USER, { ...TODAY, locationIds: [SITE_1] });
  expect(view.timeZone).toBe("Asia/Kolkata");
}

// --- compare and partial --------------------------------------------------

/** No `compare`: `compare: null` and one period read. */
export async function noCompareReadsOnePeriod(): Promise<void> {
  const f = fake({ withData: true });
  const view = await f.service.view(USER, TODAY);
  expect(view.compare).toBeNull();
  expect(periodReads(f.statements)).toHaveLength(1);
}

/** `compare=previous`: the compare period is read, and it ends before the current start. */
export async function compareReadsTwoPeriods(): Promise<void> {
  const f = fake({ withData: true });
  const view = await f.service.view(USER, { range: "24h", compare: "previous" });
  expect(periodReads(f.statements)).toHaveLength(2);
  expect(view.compare).not.toBeNull();
  expect(new Date(view.compare!.to).getTime()).toBeLessThan(new Date(view.current.from).getTime());
}

/** A caller who reads every location gets no partial note. */
export async function aGlobalReaderGetsNoPartial(): Promise<void> {
  const f = fake({ readableOrganizations: null, readableLocations: null });
  const view = await f.service.view(ADMIN, { ...TODAY, organizationId: ORG_A });
  expect(view.partial).toBeNull();
}

/** A scoped caller gets the counts of the organization's sites they read. */
export async function aScopedCallerGetsTheCounts(): Promise<void> {
  const f = fake({ readableLocations: [SITE_1], organizationLocations: [SITE_1, SITE_2] });
  const view = await f.service.view(USER, TODAY);
  expect(view.partial).toEqual({ readableSites: 1, selectedSites: 2 });
}

// --- the asset-id bound (decision 2.5) ------------------------------------

/** The reads receive exactly the scope's asset ids, never a raw request id. */
export async function theReadsReceiveTheScopesAssetIds(): Promise<void> {
  const f = fake({ withData: true, place: { organizationId: ORG_A, assetIds: [ASSET_2] } });
  await f.service.view(USER, { ...TODAY, locationIds: [SITE_1] });
  const lists = boundLists(f.statements);
  expect(lists.length).toBeGreaterThan(0);
  for (const list of lists) expect(list).toEqual([ASSET_2]);
  expect(JSON.stringify(f.statements.map((s) => s.params))).not.toContain(SITE_1);
}

/** A global admin with `organizationId` reads that organization's explicit list, never `null`. */
export async function aGlobalAdminReadsTheExplicitList(): Promise<void> {
  const f = fake({ readableOrganizations: null, readableLocations: null, organizationAssets: [ASSET_1, ASSET_2] });
  await f.service.view(ADMIN, { ...TODAY, organizationId: ORG_A, compare: "previous" });
  expect(f.calls).toContain(`readableAssetIdsInOrganization:${ORG_A}`);
  expect(f.statements.length).toBeGreaterThan(0);
  for (const s of f.statements) expect(s.params).not.toContain(null);
  for (const list of boundLists(f.statements)) expect(list).toEqual([ASSET_1, ASSET_2]);
}

/** A scope of `[]` reads nothing: no statement, no data, no top consumer. */
export async function anEmptyScopeTouchesNoPool(): Promise<void> {
  const f = fake({ withData: true, organizationAssets: [] });
  const view = await f.service.view(USER, { ...TODAY, compare: "previous" });
  expect(f.statements).toEqual([]);
  expect(view.current.hasData).toBe(false);
  expect(view.compare?.hasData).toBe(false);
  expect(view.topConsumers).toEqual([]);
}

/** The paired positive: one asset in scope reads the pool and reports its data. */
export async function aNonEmptyScopeReadsThePool(): Promise<void> {
  const f = fake({ withData: true, organizationAssets: [ASSET_1] });
  const view = await f.service.view(USER, TODAY);
  expect(f.statements.length).toBeGreaterThan(0);
  expect(view.current.hasData).toBe(true);
  expect(view.current.avgPf).toBe(0.9);
  expect(view.topConsumers.map((c) => c.assetId)).toEqual([ASSET_1]);
}

// --- counts, never ids (decision 2.9) -------------------------------------

/** A scoped caller with one unreadable child site sees two counts, and nothing of that site. */
export async function theResponseCarriesCountsNeverIds(): Promise<void> {
  const f = fake({
    withData: true,
    readableLocations: [SITE_1],
    subtree: [SITE_1, SITE_HIDDEN],
    place: { organizationId: ORG_A, assetIds: [ASSET_1] },
  });
  const view: EnergyView = await f.service.view(USER, { ...TODAY, locationIds: [SITE_1], compare: "previous" });
  expect(view.partial).toEqual({ readableSites: 1, selectedSites: 2 });
  expect(Object.keys(view.partial ?? {}).sort()).toEqual(["readableSites", "selectedSites"]);
  expect(JSON.stringify(view)).not.toContain(SITE_HIDDEN);
}
