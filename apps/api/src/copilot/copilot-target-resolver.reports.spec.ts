import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F4.280` (ADR 0099 Amendment 8 D2) — the `reportSchedule` target and
 * `organization` with `manage: "report"`. The schedule row mirrors
 * `ReportSchedulesService.readRowForVerdict` (after the route's role gate):
 * `requireMasterDataUser` (it refuses an `asset_group_admin`, an `operator`
 * and a `viewer` with a 403), then `canReadReportFile` on the row's
 * organization and stamped locations. The create gate mirrors
 * `writableLocationIds` then `resolveReportOrganization`: the body's
 * organization must be in the writable set (`null`: every one). Vitest entry
 * point: the sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const ROW = "22222222-2222-4222-8222-222222222222";
const SITE_A = "44444444-4444-4444-8444-444444444444";
const SITE_B = "55555555-5555-4555-8555-555555555555";
const JWT = { sub: "f4280-resolver-unit", role: "admin" } as JwtPayload;

/** A database whose every `select … limit` answers one row holding only the columns that select named. */
function oneRowDb(row: Record<string, unknown>): never {
  let selected: string[] = [];
  const chain = {
    select: (columns: Record<string, unknown> = {}) => {
      selected = Object.keys(columns);
      return chain;
    },
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    limit: async () => [Object.fromEntries(selected.map((key) => [key, row[key]]))],
    execute: async () => undefined,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(chain),
  };
  return chain as never;
}

type Caller = {
  role: string;
  /** The organizations the caller may write (absent: every one). */
  writable?: string[];
  /** The locations the caller manages (absent: every one). */
  locations?: string[];
};

const REFUSED_ROLES = ["asset_group_admin", "operator", "viewer"];

/** The calls the routes make, answered for one caller; `asked` records each, with its arguments. */
function reportAccess(caller: Caller, asked: string[] = []): never {
  const refused = REFUSED_ROLES.includes(caller.role);
  return {
    requireMasterDataUser: async () => {
      asked.push("requireMasterDataUser");
      if (refused) throw new Error("403");
      return { id: "u1", role: caller.role };
    },
    writableOrganizationIds: async () => {
      asked.push("writableOrganizationIds");
      if (refused) throw new Error("403");
      return caller.writable ?? null;
    },
    canReadReportFile: async (_user: unknown, file: { organizationId: string; locationIds: readonly string[] }) => {
      asked.push(`canReadReportFile:${file.organizationId}:${file.locationIds.join(",")}`);
      if (caller.writable !== undefined && !caller.writable.includes(file.organizationId)) return false;
      if (caller.locations === undefined) return true;
      const held = caller.locations;
      return file.locationIds.length > 0 && file.locationIds.every((id) => held.includes(id));
    },
  } as never;
}

async function resolveAs(id: string, caller: Caller, options: { body?: Record<string, unknown>; asked?: string[] } = {}) {
  const resolver = new CopilotTargetResolver(
    oneRowDb({ name: "Weekly energy", locationIds: [SITE_A, SITE_B] }),
    reportAccess(caller, options.asked),
    {} as never,
    {} as never,
  );
  const entry = catalogEntry(id)!;
  const params: Record<string, string> = entry.path.includes(":id") ? { id: ROW } : {};
  return resolver.resolve(entry, params, options.body ?? { organizationId: ORG }, [ORG], JWT, ORG);
}

const SAVE_BODY = { organizationId: ORG, startDate: "2026-09-01", endDate: "2026-09-30", format: "pdf" };

/** The route's role gate refuses an `asset_group_admin`. */
export async function anAssetGroupAdminIsRefusedTheSchedule(): Promise<void> {
  expect(await resolveAs("reportSchedule.update", { role: "asset_group_admin" })).toBeNull();
}

/** The route's role gate refuses an `operator`. */
export async function anOperatorIsRefusedTheSchedule(): Promise<void> {
  expect(await resolveAs("reportSchedule.update", { role: "operator" })).toBeNull();
}

/** The route's role gate refuses a `viewer`. */
export async function aViewerIsRefusedTheSchedule(): Promise<void> {
  expect(await resolveAs("reportSchedule.update", { role: "viewer" })).toBeNull();
}

/** A `location_admin` whose scope misses one stamped location is refused (`canReadReportFile` false). */
export async function aLocationAdminMissingAStampedLocationIsRefused(): Promise<void> {
  expect(await resolveAs("reportSchedule.update", { role: "location_admin", writable: [ORG], locations: [SITE_A] })).toBeNull();
}

/** A `location_admin` whose scope covers every stamped location resolves. */
export async function aLocationAdminCoveringEveryStampedLocationResolves(): Promise<void> {
  const resolved = await resolveAs("reportSchedule.update", { role: "location_admin", writable: [ORG], locations: [SITE_A, SITE_B] });
  expect(resolved?.targetName).toBe("Weekly energy");
}

/** An `organization_admin` of another organization is refused. */
export async function anOrganizationAdminOfAnotherOrganizationIsRefused(): Promise<void> {
  expect(await resolveAs("reportSchedule.update", { role: "organization_admin", writable: [OTHER_ORG] })).toBeNull();
}

/** A global admin resolves the schedule, named by its own name. */
export async function anAdminResolvesTheScheduleByName(): Promise<void> {
  expect((await resolveAs("reportSchedule.update", { role: "admin" }))?.targetName).toBe("Weekly energy");
}

/** The gate asks the role gate, then the verdict with the row's organization and stamped locations. */
export async function theScheduleGateAsksInTheRoutesOrder(): Promise<void> {
  const asked: string[] = [];
  await resolveAs("reportSchedule.update", { role: "organization_admin", writable: [ORG] }, { asked });
  expect(asked).toEqual(["requireMasterDataUser", `canReadReportFile:${ORG}:${SITE_A},${SITE_B}`]);
}

/** A `location_admin` whose writable organizations hold the body's resolves a schedule create. */
export async function aLocationAdminCreatesInItsOrganization(): Promise<void> {
  expect((await resolveAs("reportSchedule.create", { role: "location_admin", writable: [ORG] }))?.organizationId).toBe(ORG);
}

/** A create naming an organization outside the writable set is refused. */
export async function aCreateOutsideTheWritableSetIsRefused(): Promise<void> {
  expect(await resolveAs("reportSchedule.create", { role: "organization_admin", writable: [OTHER_ORG] })).toBeNull();
}

/** An `asset_group_admin` is refused a create (the route's role gate). */
export async function anAssetGroupAdminIsRefusedTheCreate(): Promise<void> {
  expect(await resolveAs("reportSchedule.create", { role: "asset_group_admin" })).toBeNull();
}

/** The file save resolves on the same report gate. */
export async function theFileSaveResolvesOnTheReportGate(): Promise<void> {
  const resolved = await resolveAs("reportFile.save", { role: "location_admin", writable: [ORG] }, { body: SAVE_BODY });
  expect(resolved?.organizationId).toBe(ORG);
}

/** The file save outside the writable set is refused (adjacent control). */
export async function theFileSaveOutsideTheWritableSetIsRefused(): Promise<void> {
  expect(await resolveAs("reportFile.save", { role: "location_admin", writable: [OTHER_ORG] }, { body: SAVE_BODY })).toBeNull();
}
