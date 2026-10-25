import { expect } from "vitest";

import type { JwtPayload, ReportScheduleDto } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { organizationOutOfScope } from "./copilot-tool-scope";
import { COPILOT_REPORT_SCHEDULES_ROLE_REFUSAL } from "./list-report-schedules.tool";

/**
 * `F4.280` (ADR 0099 Amendment 8 D7; owner ruling Q1) — `list_report_schedules`
 * over a fake of `ReportSchedulesService.list` that logs its calls. The model
 * looks a schedule's id up for `reportSchedule.update` and never guesses it.
 * Vitest entry point: the sibling `.test.ts`.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
const CHANNEL = "33333333-3333-4333-8333-333333333333";

function ctx(allowed: readonly string[], role: ResolvedIdentity["role"] = "admin"): CopilotToolContext {
  return {
    identity: { id: USER, role, organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date("2026-10-24T06:00:00Z"),
  };
}

function schedule(index: number, organizationId: string, over: Partial<ReportScheduleDto> = {}): ReportScheduleDto {
  const n = String(index).padStart(12, "0");
  return {
    id: `44444444-4444-4444-8444-${n}`,
    organizationId,
    name: `Schedule ${index}`,
    templateId: "energy_consumption",
    formats: ["pdf"],
    cadence: "weekly",
    runAtLocal: "07:00",
    timezone: "Asia/Kolkata",
    locationIds: [],
    channelId: null,
    enabled: true,
    nextRunAt: "2026-10-26T01:30:00.000Z",
    lastRunAt: null,
    createdBy: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function fake(rows: ReportScheduleDto[]) {
  const log: string[] = [];
  const services = {
    schedules: {
      list: async () => {
        log.push("schedules.list");
        return rows;
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), log };
}

type Listed = { organizations: { organizationId: string; items: Record<string, unknown>[] }[]; truncated: boolean };

async function list(tools: ReturnType<typeof fake>["tools"], args: Record<string, unknown>, c: CopilotToolContext) {
  const result: CopilotToolResult = await tools.dispatch("list_report_schedules", args, c);
  if (!result.ok) throw new Error(result.error);
  return result.result as unknown as Listed;
}

const itemsOf = (listed: Listed) => listed.organizations.flatMap((entry) => entry.items);

/** An `asset_group_admin` is refused before the service (the route's read scope refuses it). */
export async function anAssetGroupAdminIsRefusedBeforeTheService(): Promise<void> {
  const { tools, log } = fake([schedule(1, ORG_X)]);
  const result = await tools.dispatch("list_report_schedules", {}, ctx([ORG_X], "asset_group_admin"));
  expect([result, log]).toEqual([{ ok: false, error: COPILOT_REPORT_SCHEDULES_ROLE_REFUSAL }, []]);
}

/** A `location_admin` lists (positive control for the refusal above). */
export async function aLocationAdminLists(): Promise<void> {
  const { tools } = fake([schedule(1, ORG_X)]);
  expect(itemsOf(await list(tools, {}, ctx([ORG_X], "location_admin"))).length).toBe(1);
}

/** An organization outside the allowed set is refused, and the service is not called. */
export async function anOrganizationOutsideTheAllowedSetIsRefused(): Promise<void> {
  const { tools, log } = fake([schedule(1, ORG_X)]);
  const result = await tools.dispatch("list_report_schedules", { organizationId: ORG_B }, ctx([ORG_X]));
  expect([result, log]).toEqual([{ ok: false, error: organizationOutOfScope([ORG_X]) }, []]);
}

/** A row of an organization outside the turn's set is dropped. */
export async function aRowOfAnotherOrganizationIsDropped(): Promise<void> {
  const { tools } = fake([schedule(1, ORG_X), schedule(2, ORG_B)]);
  expect(itemsOf(await list(tools, {}, ctx([ORG_X]))).map((item) => item.name)).toEqual(["Schedule 1"]);
}

/** A row carries the fields the update needs, with the location count and no stamped ids. */
export async function aRowCarriesTheUpdateFields(): Promise<void> {
  const { tools } = fake([schedule(1, ORG_X, { locationIds: [ORG_B, ORG_X], channelId: CHANNEL, enabled: false })]);
  expect(itemsOf(await list(tools, {}, ctx([ORG_X])))[0]).toEqual({
    id: "44444444-4444-4444-8444-000000000001",
    name: "Schedule 1",
    cadence: "weekly",
    runAtLocal: "07:00",
    timezone: "Asia/Kolkata",
    formats: ["pdf"],
    enabled: false,
    nextRunAt: "2026-10-26T01:30:00.000Z",
    locationCount: 2,
    channelId: CHANNEL,
  });
}

/** Forty rows are cut to the 25-item cap and marked truncated. */
export async function fortyRowsAreCutToTheCap(): Promise<void> {
  const { tools } = fake(Array.from({ length: 40 }, (_, index) => schedule(index + 1, ORG_X)));
  const listed = await list(tools, {}, ctx([ORG_X]));
  expect([itemsOf(listed).length, listed.truncated]).toEqual([25, true]);
}

/** `search` narrows by name before the cap. */
export async function searchNarrowsBeforeTheCap(): Promise<void> {
  const { tools } = fake([...Array.from({ length: 30 }, (_, index) => schedule(index + 1, ORG_X)), schedule(99, ORG_X, { name: "Night energy" })]);
  const listed = await list(tools, { search: "night" }, ctx([ORG_X]));
  expect([itemsOf(listed).map((item) => item.name), listed.truncated]).toEqual([["Night energy"], false]);
}

/** The service is called once, whatever the organizations. */
export async function theServiceIsCalledOnce(): Promise<void> {
  const { tools, log } = fake([schedule(1, ORG_X), schedule(2, ORG_B)]);
  await list(tools, {}, ctx([ORG_X, ORG_B]));
  expect(log).toEqual(["schedules.list"]);
}

/** A stored row that breaks its contract is a failure, not a quiet pass (the parse runs). */
export async function aBrokenRowFailsTheParse(): Promise<void> {
  const { tools } = fake([schedule(1, ORG_X, { cadence: "hourly" as never })]);
  await expect(tools.dispatch("list_report_schedules", {}, ctx([ORG_X]))).rejects.toThrow();
}
