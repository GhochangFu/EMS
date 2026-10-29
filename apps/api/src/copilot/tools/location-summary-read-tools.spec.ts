import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { LocationAssetScope } from "../../auth/location-asset-scope.service";
import { runToolCall } from "../../llm/tool-registry";
import { succeed, TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import type { LocationSummaryKey, LocationSummaryRow, LocationSummaryRows } from "../../reports/location-summary.service";
import type { ReportRange } from "../../reports/reports.service";
import { scrubToolResult } from "../copilot-secret-scrub";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_GUARDS } from "../copilot-turn.service";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import {
  COPILOT_TOOL_LOCATION_OUT_OF_SCOPE,
  COPILOT_TOOL_LOCATION_OUTSIDE_GRANT,
  COPILOT_TOOL_LOCATIONS_HOLD_NO_READABLE_ASSET,
} from "./copilot-tool-scope";

/**
 * `F4.290` PR 2 (ADR 0099 Amendment 9 E4) — `get_location_summary` over fake
 * services that log their calls. Placement and refusal claims check the
 * summary log stays empty; the page claims read the tool as the model
 * receives it (`succeed(scrubToolResult(result))`): whole JSON, every row
 * once, and a normal estate in one call (`F4.296`). One `it()` per claim in
 * the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const SITE = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-29T06:00:00.000Z");

const uuid = (prefix: string, i: number) => `${prefix}-4b4b-4c4c-8d8d-${String(i).padStart(12, "0")}`;

const GLOBAL_ADMIN = { id: USER, email: "u@x.test", displayName: "U", role: "admin", organizationId: null, oidcSubject: null, disabledAt: null } as ResolvedIdentity;
const JWT = { sub: USER, email: "u@x.test", role: "admin" } as JwtPayload;

function ctx(allowed: readonly string[] = [ORG_X]): CopilotToolContext {
  return { identity: GLOBAL_ADMIN, user: JWT, conversationId: CONVERSATION, conversationOrganizationId: null, allowedOrganizationIds: allowed, turnKind: "user", now: NOW };
}

/** A seeded-estate row: an ESKOM-length site name, two short no-data codes, three severities. */
function typical(key: LocationSummaryKey): LocationSummaryRow {
  return {
    id: key.id,
    name: key.name,
    assets: 42,
    kwh: 123_456.78,
    raised: { critical: 12, warning: 30, info: 4 },
    open: { critical: 3, warning: 9 },
    noData: 7,
    noDataCodes: ["WC-UPS-01", "WC-HVAC-12", "WC-PV-03"],
  };
}

/** The worst case: every column at its maximum (an 80-character name, three 64-character codes, five-digit counts). */
function widest(key: LocationSummaryKey): LocationSummaryRow {
  return {
    id: key.id,
    name: "N".repeat(80),
    assets: 99_999,
    kwh: 9_876_543.21,
    raised: { critical: 99_999, warning: 99_999, info: 99_999 },
    open: { critical: 99_999, warning: 99_999, info: 99_999 },
    noData: 99_999,
    noDataCodes: ["C".repeat(64), "D".repeat(64), "E".repeat(64)],
  };
}

type FakeOptions = {
  readonly rows?: (organizationId: string) => LocationSummaryRows;
  readonly location?: LocationAssetScope;
  readonly row?: (key: LocationSummaryKey) => LocationSummaryRow;
  readonly scope?: readonly string[] | null;
};

/** `count` roots per organization named like the seeded ESKOM sites. */
function roots(count: number) {
  return (organizationId: string): LocationSummaryRows => ({
    ok: true,
    rows: Array.from({ length: count }, (_, i) => ({ id: uuid(organizationId.slice(-8), i), name: `Western Cape Distribution Site ${String(i).padStart(2, "0")}` })),
  });
}

function fake(options: FakeOptions = {}) {
  const log = {
    location: [] as Array<readonly string[]>,
    rows: [] as Array<{ organizationId: string; scope: readonly string[] | null; locationIds: readonly string[] | undefined }>,
    summarise: [] as Array<{ organizationId: string; page: readonly LocationSummaryKey[]; assetIds: readonly string[]; range: Pick<ReportRange, "start" | "end"> }>,
  };
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => [`asset-of-${organizationId}`],
      readableLocationIds: async () => (options.scope === undefined ? null : options.scope),
    },
    locationScope: {
      readableAssetIdsInLocations: async (_user: JwtPayload, _candidates: readonly string[], locationIds: readonly string[]) => {
        log.location.push(locationIds);
        return options.location ?? { ok: true, organizationId: ORG_X, assetIds: ["asset-of-site"] };
      },
    },
    locationSummary: {
      rows: async (organizationId: string, scope: readonly string[] | null, locationIds?: readonly string[]) => {
        log.rows.push({ organizationId, scope, locationIds });
        return (options.rows ?? roots(13))(organizationId);
      },
      summarise: async (organizationId: string, page: readonly LocationSummaryKey[], assetIds: readonly string[], range: Pick<ReportRange, "start" | "end">) => {
        log.summarise.push({ organizationId, page, assetIds, range });
        return page.map(options.row ?? typical);
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), log };
}

type Page = { truncated: boolean; nextCursor: string | null; organizations: Array<{ organizationId: string; startDate?: string; endDate?: string; locationCount?: number; items: LocationSummaryRow[] }> };

const WEEK = { startDate: "2026-10-22", endDate: "2026-10-28" };

const call = (tools: ReturnType<typeof fake>["tools"], args: Record<string, unknown>, allowed?: readonly string[]) =>
  tools.dispatch("get_location_summary", args, ctx(allowed));

function content(out: CopilotToolResult): string {
  if (!out.ok) throw new Error(`F4.290: refused: ${out.error}`);
  return succeed(scrubToolResult(out.result)).content;
}

/** Every page from no cursor to `nextCursor: null`, as the model receives it. */
async function walk(options: FakeOptions, args: Record<string, unknown>, allowed?: readonly string[]) {
  const f = fake(options);
  const contents: string[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < 30; n += 1) {
    const text = content(await call(f.tools, cursor === undefined ? args : { ...args, cursor }, allowed));
    contents.push(text);
    const next = (JSON.parse(text) as Page).nextCursor;
    if (next == null) break;
    cursor = next;
  }
  const pages = contents.map((text) => JSON.parse(text) as Page);
  return { ...f, contents, pages, ids: pages.flatMap((p) => p.organizations.flatMap((entry) => entry.items.map((row) => row.id))) };
}

/** The schema's answer: `dispatched` stays false when the arguments are refused before any call. */
async function refuse(args: Record<string, unknown>) {
  let dispatched = false;
  const out = await runToolCall(
    fake().tools.registry,
    toolCall("get_location_summary", args),
    async () => {
      dispatched = true;
      return succeed({});
    },
    COPILOT_TOOL_GUARDS,
  );
  return { ok: out.ok, dispatched, content: out.content };
}

// --- the range ----------------------------------------------------------------------------------

/** A 32-day range is refused by the schema before any call; 31 days dispatches. */
export async function aRangeOverThirtyOneDaysIsRefused(): Promise<void> {
  const over = await refuse({ startDate: "2026-09-01", endDate: "2026-10-02" });
  const { tools, log } = fake();
  content(await call(tools, { startDate: "2026-09-01", endDate: "2026-10-01" }));
  expect([over.ok, over.dispatched, log.summarise.length]).toEqual([false, false, 1]);
  expect(over.content).toContain("range is over 31 days");
}

/** `endDate` before `startDate` is refused by the schema. */
export async function aReversedRangeIsRefused(): Promise<void> {
  const reversed = await refuse({ startDate: "2026-10-28", endDate: "2026-10-22" });
  expect([reversed.ok, reversed.dispatched]).toEqual([false, false]);
  expect(reversed.content).toContain("is before startDate");
}

/** No range, or `lastDays` beside a date, is refused by the schema. */
export async function aMissingOrDoubleRangeIsRefused(): Promise<void> {
  const none = await refuse({});
  const both = await refuse({ lastDays: 7, startDate: "2026-10-22" });
  expect([none.ok, none.dispatched, both.ok, both.dispatched]).toEqual([false, false, false, false]);
}

/** `lastDays: 7` is the seven whole UTC days ending on the turn's own date, read over the report's bounds. */
export async function lastDaysIsWholeDaysEndingOnTheTurnsDate(): Promise<void> {
  const { tools, log } = fake();
  const page = JSON.parse(content(await call(tools, { lastDays: 7 }))) as Page;
  expect([page.organizations[0]?.startDate, page.organizations[0]?.endDate]).toEqual(["2026-10-23", "2026-10-29"]);
  const range = log.summarise[0]?.range;
  expect([range?.start.toISOString(), range?.end.toISOString()]).toEqual(["2026-10-23T00:00:00.000Z", "2026-10-29T23:59:59.999Z"]);
}

// --- scope ----------------------------------------------------------------------------------------

/** Without locationIds: the organization's readable ids and the caller's readable locations reach the service; the location helper is not asked. */
export async function theCallersReadableIdsAndLocationsReachTheService(): Promise<void> {
  const { tools, log } = fake({ scope: [SITE] });
  content(await call(tools, WEEK));
  expect(log.rows).toEqual([{ organizationId: ORG_X, scope: [SITE], locationIds: undefined }]);
  expect(log.summarise.map((entry) => entry.assetIds)).toEqual([[`asset-of-${ORG_X}`]]);
  expect(log.location).toEqual([]);
}

/** Named sites are placed by the location helper and read with its ids. */
export async function namedSitesArePlacedByTheLocationHelper(): Promise<void> {
  const { tools, log } = fake();
  content(await call(tools, { ...WEEK, locationIds: [SITE] }));
  expect(log.location).toEqual([[SITE]]);
  expect(log.summarise.map((entry) => entry.assetIds)).toEqual([["asset-of-site"]]);
}

/** A site the helper does not find is refused with the not-found sentence, and nothing is summarised. */
export async function aSiteNotFoundIsRefusedAndNothingIsRead(): Promise<void> {
  const { tools, log } = fake({ location: { ok: false, reason: "not_found" } });
  expect(await call(tools, { ...WEEK, locationIds: [SITE] })).toEqual({ ok: false, error: COPILOT_TOOL_LOCATION_OUT_OF_SCOPE });
  expect([log.rows, log.summarise]).toEqual([[], []]);
}

/** Named sites holding no readable asset are refused (owner ruling P6), and nothing is summarised. */
export async function sitesHoldingNoReadableAssetAreRefused(): Promise<void> {
  const { tools, log } = fake({ location: { ok: true, organizationId: ORG_X, assetIds: [] } });
  expect(await call(tools, { ...WEEK, locationIds: [SITE] })).toEqual({ ok: false, error: COPILOT_TOOL_LOCATIONS_HOLD_NO_READABLE_ASSET });
  expect(log.summarise).toEqual([]);
}

/** A named site the service finds outside the caller's readable locations is refused with the grant sentence, and nothing is summarised. */
export async function aSiteOutsideTheReadableLocationsIsRefused(): Promise<void> {
  const { tools, log } = fake({ rows: () => ({ ok: false, reason: "outside_grant" }) });
  expect(await call(tools, { ...WEEK, locationIds: [SITE] })).toEqual({ ok: false, error: COPILOT_TOOL_LOCATION_OUTSIDE_GRANT });
  expect(log.summarise).toEqual([]);
}

// --- pages ----------------------------------------------------------------------------------------

/** `F4.296`: ESKOM's 13 roots at seeded lengths are one call: every row, no cursor, under the cut. */
export async function aSeededEstateIsOneCall(): Promise<void> {
  const { pages, contents, ids } = await walk({ rows: roots(13) }, WEEK);
  expect([pages.length, ids.length, pages[0]?.nextCursor]).toEqual([1, 13, null]);
  expect(contents[0]!.length).toBeLessThan(TOOL_RESULT_MAX_CHARS);
}

/**
 * The measured worst case: a page of rows with every column at its maximum
 * holds {@link WORST_CASE_ROWS_PER_PAGE} rows; the walk still reads every row
 * once, each page whole JSON under the cut.
 */
export const WORST_CASE_ROWS_PER_PAGE = 14;
export async function aWorstCasePageHoldsTheMeasuredRowsAndTheWalkIsWhole(): Promise<void> {
  const { pages, contents, ids } = await walk({ rows: roots(30), row: widest }, WEEK);
  expect(pages[0]?.organizations[0]?.items).toHaveLength(WORST_CASE_ROWS_PER_PAGE);
  expect(new Set(ids).size).toBe(30);
  expect(ids).toHaveLength(30);
  expect(contents.every((text) => text.length < TOOL_RESULT_MAX_CHARS)).toBe(true);
}

/** Two organizations of 13 roots each, no organizationId: the walk reads all 26 once, each page under the cut. */
export async function twoOrganizationsAreWalkedWhole(): Promise<void> {
  const { contents, ids } = await walk({ rows: roots(13) }, WEEK, [ORG_X, ORG_Y]);
  expect([ids.length, new Set(ids).size]).toEqual([26, 26]);
  expect(contents.every((text) => text.length < TOOL_RESULT_MAX_CHARS)).toBe(true);
}
