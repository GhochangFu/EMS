import { NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import { encodePointRef, type JwtPayload } from "@bms/shared";

import { calls, FakeLlmProvider, toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { LlmMessage } from "../../llm/llm-port";
import { runToolCall } from "../../llm/tool-registry";
import { TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_REDACTED } from "../copilot-secret-scrub";
import { COPILOT_TOOL_GUARDS } from "../copilot-turn.service";
import { harness } from "../copilot-turn.service.spec";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import {
  COPILOT_TOOL_ORGANIZATION_OUT_OF_SCOPE,
  COPILOT_TOOL_RECORD_OUT_OF_SCOPE,
  organizationOutOfScope,
} from "./copilot-tool-scope";
import { getAlarmDetailsTool } from "./get-alarm-details.tool";
import { boundAlarmKb, COPILOT_ALARM_KB_BUDGET, COPILOT_ALARM_KB_WRONG_ORGANIZATION } from "./get-alarm-kb.tool";

/**
 * `F4.276` (ADR 0099 decisions 1, 10) — the copilot's `get_alarm_details` and
 * `get_alarm_kb` over fake services that log their calls. The details tool
 * reads once over the union of the readable asset ids of the allowed
 * organizations and checks the alarm's organization against the one that
 * placed its asset; the KB tool reads once with the allowed organization set,
 * never `null` (the unrestricted-admin scope) or `[]`. Each refusal claim
 * checks the data log beside a positive call that reaches it. One `it()` per
 * claim in the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
/** An organization with its own key: never in a platform-scope allowed set. */
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
/** An allowed organization in which the caller reads no asset. */
const ORG_EMPTY = "00000000-0000-4000-8000-0000000000dd";
const ASSET_X = "30000000-0000-4000-8000-0000000000aa";
const ASSET_Y = "30000000-0000-4000-8000-0000000000bb";
const ASSET_B = "30000000-0000-4000-8000-0000000000cc";
const ALARM_X = "40000000-0000-4000-8000-0000000000aa";
const ALARM_B = "40000000-0000-4000-8000-0000000000cc";
const NOW = new Date("2026-10-11T06:00:00Z");

const ASSETS_BY_ORG: Record<string, string[]> = {
  [ORG_X]: [ASSET_X],
  [ORG_Y]: [ASSET_Y],
  [ORG_B]: [ASSET_B],
  [ORG_EMPTY]: [],
};
const ORG_OF_ASSET: Record<string, string> = { [ASSET_X]: ORG_X, [ASSET_Y]: ORG_Y, [ASSET_B]: ORG_B };

const GLOBAL_ADMIN = {
  id: USER,
  email: "u@x.test",
  displayName: "U",
  role: "admin",
  organizationId: null,
  oidcSubject: null,
  disabledAt: null,
} as ResolvedIdentity;
const JWT = { sub: USER, email: "u@x.test", role: "admin" } as JwtPayload;

function ctx(allowed: readonly string[]): CopilotToolContext {
  return {
    identity: GLOBAL_ADMIN,
    user: JWT,
    conversationId: CONVERSATION,
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: NOW,
  };
}

type Enrichment = { correctiveActions?: string | null; affected?: number; longText?: number } | null;
type Philosophy = { longText: number } | null;

/** A complete details DTO (the web fixture's shape) plus a key the contract must strip. */
function detailsRow(
  alarmId: string,
  assetId: string,
  enrichment: Enrichment = null,
  organizationId = ORG_OF_ASSET[assetId],
  philosophy: Philosophy = null,
) {
  const long = (n: number | undefined, c: string) => (n === undefined ? null : c.repeat(n));
  return {
    id: alarmId,
    assetId,
    organizationId,
    assetCode: "CH-01",
    assetName: "Chiller 1",
    assetDomain: "hvac",
    locationName: "Plant A",
    siteName: "Site A",
    severity: "major",
    message: "High discharge temperature",
    raisedAt: "2026-10-11T05:00:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    ruleId: "rule-1",
    rulePointKey: "discharge_temp",
    thresholdOperator: "gte",
    thresholdValue: 95,
    currentValue: 100,
    currentValueUnit: "C",
    currentValueAt: "2026-10-11T05:59:00.000Z",
    enrichment:
      enrichment === null
        ? null
        : {
            rootCause: long(enrichment.longText, "r"),
            impact: long(enrichment.longText, "i"),
            correctiveActions: enrichment.correctiveActions ?? long(enrichment.longText, "c"),
            energyImpact: long(enrichment.longText, "e"),
            waterImpact: long(enrichment.longText, "w"),
            productionImpact: long(enrichment.longText, "p"),
            etrAt: null,
            skillCode: null,
            updatedBy: null,
            updatedAt: "2026-10-11T05:10:00.000Z",
            affectedAssets: Array.from({ length: enrichment.affected ?? 0 }, (_, i) => ({
              assetId: `a-${i}`,
              assetCode: `C-${i}`,
              assetName: `Asset ${i}`,
            })),
          },
    classPhilosophy:
      philosophy === null
        ? null
        : {
            templateId: "t-CHILLER",
            templateVersion: 1,
            templateName: "Template CHILLER",
            alarmCode: "CH_HIGH_DISCHARGE",
            cause: "k".repeat(philosophy.longText),
            impact: "m".repeat(philosophy.longText),
            action: "n".repeat(philosophy.longText),
            skillCode: null,
            skillLabel: null,
          },
    internalNote: "not in the contract",
  };
}

type KbEntry = {
  alarmCode: string;
  message: string | null;
  severity: string | null;
  cause: string | null;
  impact: string | null;
  action: string | null;
  skillCode: string | null;
  skillLabel: string | null;
};

function kbEntry(alarmCode: string, overrides: Partial<KbEntry> = {}): KbEntry {
  return {
    alarmCode,
    message: `Message ${alarmCode}`,
    severity: "major",
    cause: `Cause ${alarmCode}`,
    impact: `Impact ${alarmCode}`,
    action: `Action ${alarmCode}`,
    skillCode: "hvac",
    skillLabel: "HVAC",
    ...overrides,
  };
}

function kbClass(templateCode: string, organizationId: string, alarms: KbEntry[]) {
  return {
    templateId: `t-${templateCode}`,
    templateCode,
    templateName: `Template ${templateCode}`,
    templateVersion: 1,
    organizationId,
    domain: "hvac",
    alarms,
    internalNote: "not in the contract",
  };
}

const CHILLER_KB = kbClass("CHILLER", ORG_X, [
  kbEntry("CH_HIGH_DISCHARGE", { message: "High discharge temperature", cause: "Fouled condenser", action: "Clean the condenser coil." }),
  kbEntry("CH_LOW_SUCTION", { message: "Low suction pressure", cause: "Low refrigerant charge" }),
]);
const PUMP_KB = kbClass("PUMP", ORG_Y, [kbEntry("PMP_BEARING", { message: "Bearing temperature high" })]);

type FakeOptions = {
  /** Alarms by id: the asset they sit on, and what `get` answers. */
  alarms?: Record<string, ReturnType<typeof detailsRow>>;
  detailsThrows?: Error;
  kb?: ReturnType<typeof kbClass>[];
  /** What `readableOrganizationIds` answers; `null` (the default) is the unrestricted scope. */
  readable?: string[] | null;
};

/** Fake services with a call log each. The details fake exposes `get` only, the KB fake `list` only. */
function fakeServices(options: FakeOptions = {}) {
  const log = {
    access: [] as string[],
    details: [] as Array<{ alarmId: string; assetIds: string[] | null }>,
    kb: [] as Array<string[] | null>,
    readable: 0,
    recent: [] as Array<{ pointRef: string; window?: string; limit?: number }>,
  };
  const alarms = options.alarms ?? { [ALARM_X]: detailsRow(ALARM_X, ASSET_X), [ALARM_B]: detailsRow(ALARM_B, ASSET_B) };
  const kb = options.kb ?? [CHILLER_KB, PUMP_KB];
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => {
        log.access.push(organizationId);
        return ASSETS_BY_ORG[organizationId] ?? [];
      },
      readableOrganizationIds: async () => {
        log.readable += 1;
        return options.readable === undefined ? null : options.readable;
      },
    },
    alarmDetails: {
      get: async (alarmId: string, assetIds: string[] | null) => {
        log.details.push({ alarmId, assetIds });
        if (options.detailsThrows !== undefined) throw options.detailsThrows;
        const row = alarms[alarmId];
        if (row === undefined || assetIds === null || !assetIds.includes(row.assetId)) {
          throw new NotFoundException("Alarm not found or outside your access scope");
        }
        return row;
      },
    },
    alarmKb: {
      list: async (organizationIds: string[] | null) => {
        log.kb.push(organizationIds);
        return { classes: kb.filter((c) => organizationIds === null || organizationIds.includes(c.organizationId)) };
      },
    },
    telemetry: {
      recentForPoint: async (pointRef: string, window?: string, limit?: number) => {
        log.recent.push({ pointRef, window, limit });
        return Array.from({ length: 3 }, (_, i) => ({
          time: new Date(NOW.getTime() - i * 10_000).toISOString(),
          assetId: ASSET_X,
          pointKey: "discharge_temp",
          value: 100 - i,
          unit: "C",
        }));
      },
    },
  } as unknown as CopilotReadServices;
  return { services, log, tools: createCopilotReadTools(services) };
}

type Tools = ReturnType<typeof fakeServices>["tools"];

function okResult(out: CopilotToolResult): Record<string, unknown> {
  if (!out.ok) throw new Error(`F4.276: the tool refused: ${out.error}`);
  return out.result;
}

type KbOut = { classes: Array<Record<string, unknown> & { alarms?: Array<Record<string, unknown>>; alarmCodes?: string[] }>; truncated: boolean };

function toolMessages(llm: FakeLlmProvider): string[] {
  return llm.seen.flat().flatMap((m: LlmMessage) => (m.role === "tool" ? [m.content] : []));
}

async function refusedByTheSchema(tools: Tools, name: string, args: Record<string, unknown>) {
  return runToolCall(tools.registry, toolCall(name, args), () => Promise.reject(new Error("must not dispatch")), COPILOT_TOOL_GUARDS);
}

// --- get_alarm_details ----------------------------------------------------------------------

/** Claim A: one read over the union of readable asset ids, never `null`; the alarm's organization is reported. */
export async function assertAlarmDetailsReadsOnceOverTheUnion(): Promise<void> {
  const { tools, log } = fakeServices();
  const out = await tools.dispatch("get_alarm_details", { alarmId: ALARM_X }, ctx([ORG_X, ORG_Y, ORG_EMPTY]));
  expect(log.details).toEqual([{ alarmId: ALARM_X, assetIds: [ASSET_X, ASSET_Y] }]);
  const result = okResult(out);
  expect(result.organizationId).toBe(ORG_X);
  expect(out.ok && out.organizationIds).toEqual([ORG_X]);
  expect((result.alarm as Record<string, unknown>).rulePointKey).toBe("discharge_temp");
}

/** Claim B1: an alarm on an asset outside the allowed organizations is refused after one scoped read. */
export async function assertAlarmDetailsRefusesAnAlarmOutsideTheScope(): Promise<void> {
  const { tools, log } = fakeServices();
  expect(await tools.dispatch("get_alarm_details", { alarmId: ALARM_B }, ctx([ORG_X]))).toEqual({
    ok: false,
    error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE,
  });
  expect(log.details).toEqual([{ alarmId: ALARM_B, assetIds: [ASSET_X] }]);
}

/** Claim B2: no readable asset in any allowed organization is refused with zero details reads (never `[]`, never `null`). */
export async function assertAlarmDetailsWithNoReadableAssetMakesNoRead(): Promise<void> {
  const { tools, log } = fakeServices();
  expect(await tools.dispatch("get_alarm_details", { alarmId: ALARM_X }, ctx([ORG_EMPTY]))).toEqual({
    ok: false,
    error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE,
  });
  expect(log.details).toEqual([]);
  expect(log.access).toEqual([ORG_EMPTY]);
}

/** Claim B3: an answer whose organization disagrees with the one that placed its asset is refused. */
export async function assertAlarmDetailsRefusesAMisplacedOrganization(): Promise<void> {
  const { tools, log } = fakeServices({ alarms: { [ALARM_X]: detailsRow(ALARM_X, ASSET_X, null, ORG_B) } });
  expect(await tools.dispatch("get_alarm_details", { alarmId: ALARM_X }, ctx([ORG_X]))).toEqual({
    ok: false,
    error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE,
  });
  expect(log.details).toHaveLength(1);
}

/** Claim B4: a service failure that is not "not found" is the tool's error, never "out of scope". */
export async function assertAlarmDetailsLetsAnyOtherFailureThrough(): Promise<void> {
  const { tools } = fakeServices({ detailsThrows: new Error("db") });
  await expect(tools.dispatch("get_alarm_details", { alarmId: ALARM_X }, ctx([ORG_X]))).rejects.toThrow("db");
}

/** Claim C1: a non-uuid id and an unknown key are refused before dispatch. */
export async function assertAlarmDetailsSchemaRefusesBeforeDispatch(): Promise<void> {
  const { tools, log } = fakeServices();
  expect((await refusedByTheSchema(tools, "get_alarm_details", { alarmId: "alarm-1" })).ok).toBe(false);
  expect((await refusedByTheSchema(tools, "get_alarm_details", { alarmId: ALARM_X, ack: true })).ok).toBe(false);
  expect(log.details).toEqual([]);
  expect(log.access).toEqual([]);
}

/** Claim C2: the contract strips an extra key, and the affected assets are cut at 25. */
export async function assertAlarmDetailsBoundsTheAffectedAssets(): Promise<void> {
  const many = fakeServices({ alarms: { [ALARM_X]: detailsRow(ALARM_X, ASSET_X, { affected: 26 }) } });
  const cut = okResult(await many.tools.dispatch("get_alarm_details", { alarmId: ALARM_X }, ctx([ORG_X])));
  const alarm = cut.alarm as Record<string, unknown> & { enrichment: { affectedAssets: Array<{ assetId: string }> } };
  expect(alarm).not.toHaveProperty("internalNote");
  expect(alarm.enrichment.affectedAssets.map((a) => a.assetId)).toEqual(Array.from({ length: 25 }, (_, i) => `a-${i}`));
  expect(cut.affectedAssetsTruncated).toBe(true);

  const fit = fakeServices({ alarms: { [ALARM_X]: detailsRow(ALARM_X, ASSET_X, { affected: 25 }) } });
  const whole = okResult(await fit.tools.dispatch("get_alarm_details", { alarmId: ALARM_X }, ctx([ORG_X])));
  expect((whole.alarm as { enrichment: { affectedAssets: unknown[] } }).enrichment.affectedAssets).toHaveLength(25);
  expect(whole.affectedAssetsTruncated).toBe(false);
}

/** Claim C3: every text field at its authored maximum still fits one result, the class philosophy kept and the cut flagged. */
export async function assertAlarmDetailsBoundsTheText(): Promise<void> {
  const { tools } = fakeServices({
    alarms: { [ALARM_X]: detailsRow(ALARM_X, ASSET_X, { longText: 2_000, affected: 25 }, ORG_X, { longText: 2_000 }) },
  });
  const result = okResult(await tools.dispatch("get_alarm_details", { alarmId: ALARM_X }, ctx([ORG_X])));
  expect(JSON.stringify(result).length).toBeLessThan(TOOL_RESULT_MAX_CHARS);
  const alarm = result.alarm as { classPhilosophy: { cause: string } | null; enrichment: { rootCause: string } };
  expect(alarm.classPhilosophy?.cause.startsWith("kkk")).toBe(true);
  expect(alarm.enrichment.rootCause.startsWith("rrr")).toBe(true);
  expect(result.textCut).toBe(true);
  expect(Object.keys(result).indexOf("affectedAssetsTruncated")).toBeLessThan(Object.keys(result).indexOf("alarm"));

  const plain = fakeServices();
  const whole = okResult(await plain.tools.dispatch("get_alarm_details", { alarmId: ALARM_X }, ctx([ORG_X])));
  expect(whole.textCut).toBe(false);
}

/** Claim D: the details tool never offers a write — `get` only, and `alarmId` is its one argument. */
export async function assertAlarmDetailsNeverOffersAWrite(): Promise<void> {
  const shape = (getAlarmDetailsTool.schema as unknown as { shape: Record<string, unknown> }).shape;
  expect(Object.keys(shape)).toEqual(["alarmId"]);
  const { services, tools } = fakeServices();
  expect(Object.keys(services.alarmDetails)).toEqual(["get"]);
  expect((await tools.dispatch("get_alarm_details", { alarmId: ALARM_X }, ctx([ORG_X]))).ok).toBe(true);
}

// --- get_alarm_kb ---------------------------------------------------------------------------

/** Claim E: one read with the allowed set (or the one requested organization), never `null` or `[]`. */
export async function assertAlarmKbReadsOnceWithTheAllowedSet(): Promise<void> {
  const all = fakeServices();
  const out = await all.tools.dispatch("get_alarm_kb", {}, ctx([ORG_X, ORG_Y]));
  expect(all.log.kb).toEqual([[ORG_X, ORG_Y]]);
  expect(out.ok && out.organizationIds).toEqual([ORG_X, ORG_Y]);

  const one = fakeServices();
  await one.tools.dispatch("get_alarm_kb", { organizationId: ORG_X }, ctx([ORG_X, ORG_Y]));
  expect(one.log.kb).toEqual([[ORG_X]]);

  const refused = fakeServices();
  expect(await refused.tools.dispatch("get_alarm_kb", { organizationId: ORG_B }, ctx([ORG_X, ORG_Y]))).toEqual({
    ok: false,
    error: organizationOutOfScope([ORG_X, ORG_Y]),
  });
  expect(refused.log.kb).toEqual([]);

  const none = fakeServices();
  const empty = await none.tools.dispatch("get_alarm_kb", {}, ctx([]));
  expect(okResult(empty)).toEqual({ classes: [], truncated: false });
  expect(none.log.kb).toEqual([]);
}

/** Claim E2: the KB is narrowed to the caller's readable organizations; none readable makes no KB read. */
export async function assertAlarmKbNarrowsToTheReadableOrganizations(): Promise<void> {
  const none = fakeServices({ readable: [] });
  expect(okResult(await none.tools.dispatch("get_alarm_kb", {}, ctx([ORG_X])))).toEqual({ classes: [], truncated: false });
  expect(none.log.readable).toBe(1);
  expect(none.log.kb).toEqual([]);

  const some = fakeServices({ readable: [ORG_Y] });
  const out = await some.tools.dispatch("get_alarm_kb", {}, ctx([ORG_X, ORG_Y]));
  expect(some.log.kb).toEqual([[ORG_Y]]);
  expect(out.ok && out.organizationIds).toEqual([ORG_Y]);
}

/** Claim E3: a KB answer that names an organization outside the read set is refused. */
export async function assertAlarmKbRefusesAClassFromAnotherOrganization(): Promise<void> {
  const leaky = fakeServices();
  (leaky.services.alarmKb as unknown as { list: (ids: string[] | null) => Promise<unknown> }).list = async (ids) => {
    leaky.log.kb.push(ids);
    return { classes: [CHILLER_KB, PUMP_KB] };
  };
  expect(await leaky.tools.dispatch("get_alarm_kb", {}, ctx([ORG_X]))).toEqual({
    ok: false,
    error: COPILOT_ALARM_KB_WRONG_ORGANIZATION,
  });
  expect(leaky.log.kb).toEqual([[ORG_X]]);
  expect((await leaky.tools.dispatch("get_alarm_kb", {}, ctx([ORG_X, ORG_Y]))).ok).toBe(true);
}

/** Claim F1: with no filter the result is the index — each class's alarm codes, no entry text. */
export async function assertAlarmKbIndexModeListsTheCodes(): Promise<void> {
  const { tools } = fakeServices();
  const result = okResult(await tools.dispatch("get_alarm_kb", {}, ctx([ORG_X, ORG_Y]))) as KbOut;
  expect(result.classes.map((c) => [c.templateCode, c.alarmCodes])).toEqual([
    ["CHILLER", ["CH_HIGH_DISCHARGE", "CH_LOW_SUCTION"]],
    ["PUMP", ["PMP_BEARING"]],
  ]);
  expect(JSON.stringify(result)).not.toContain('"cause"');
  expect(JSON.stringify(result)).not.toContain("internalNote");
  expect(result.truncated).toBe(false);
}

/** Claim F2: `alarmCode`, `query` and `templateCode` return the matching entries with their text, and nothing else. */
export async function assertAlarmKbEntriesModeFilters(): Promise<void> {
  const { tools } = fakeServices();
  const run = async (args: Record<string, unknown>) =>
    okResult(await tools.dispatch("get_alarm_kb", args, ctx([ORG_X, ORG_Y]))) as KbOut;

  const byCode = await run({ alarmCode: "CH_LOW_SUCTION" });
  expect(byCode.classes).toHaveLength(1);
  expect(byCode.classes[0]?.alarms).toEqual([
    expect.objectContaining({ alarmCode: "CH_LOW_SUCTION", cause: "Low refrigerant charge", impact: "Impact CH_LOW_SUCTION", action: "Action CH_LOW_SUCTION", skillLabel: "HVAC" }),
  ]);

  const byQuery = await run({ query: "DISCHARGE" });
  expect(byQuery.classes.flatMap((c) => (c.alarms ?? []).map((a) => a.alarmCode))).toEqual(["CH_HIGH_DISCHARGE"]);

  const byTemplate = await run({ templateCode: "PUMP" });
  expect(byTemplate.classes.map((c) => c.templateCode)).toEqual(["PUMP"]);
  expect(byTemplate.classes[0]?.alarms?.map((a) => a.alarmCode)).toEqual(["PMP_BEARING"]);

  expect(await run({ query: "no such alarm" })).toEqual({ classes: [], truncated: false });
}

/** Claim G: the entries are cut by count and by a character budget, as a prefix, and the index at 25 classes. */
export async function assertAlarmKbBoundsTheResult(): Promise<void> {
  const big = kbClass(
    "BIG",
    ORG_X,
    Array.from({ length: 40 }, (_, i) => kbEntry(`BIG_${String(i).padStart(2, "0")}`, { action: "x".repeat(1_000) })),
  );
  const { tools } = fakeServices({ kb: [big] });
  const result = okResult(await tools.dispatch("get_alarm_kb", { templateCode: "BIG" }, ctx([ORG_X]))) as KbOut;
  expect(JSON.stringify(result).length).toBeLessThan(TOOL_RESULT_MAX_CHARS);
  expect(result.truncated).toBe(true);
  const kept = result.classes[0]?.alarms?.map((a) => a.alarmCode) ?? [];
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length).toBeLessThan(40);
  expect(kept).toEqual(big.alarms.slice(0, kept.length).map((a) => a.alarmCode));

  const small = boundAlarmKb([CHILLER_KB], { query: "suction" }, COPILOT_ALARM_KB_BUDGET);
  expect(small.truncated).toBe(false);

  const sixty = Array.from({ length: 60 }, (_, i) => kbClass(`C${i}`, ORG_X, [kbEntry(`A${i}`)]));
  const index = boundAlarmKb(sixty, {}, COPILOT_ALARM_KB_BUDGET);
  expect(index.classes).toHaveLength(25);
  expect(index.truncated).toBe(true);

  const tiny = Array.from({ length: 30 }, (_, i) => kbEntry(`T${i}`));
  const byCount = boundAlarmKb([kbClass("TINY", ORG_X, tiny)], { templateCode: "TINY" }, COPILOT_ALARM_KB_BUDGET);
  expect(byCount.classes[0]?.alarms).toHaveLength(25);
  expect(byCount.truncated).toBe(true);
}

/** Claim G2: one entry larger than the whole budget is kept with its text cut, never dropped. */
export async function assertAlarmKbCutsAnOversizedEntry(): Promise<void> {
  const huge = kbEntry("HUGE_01", {
    message: "q".repeat(500),
    cause: "c".repeat(2_000),
    impact: "i".repeat(2_000),
    action: "a".repeat(2_000),
  });
  const later = kbClass("LATER", ORG_X, [kbEntry("HUGE_01")]);
  const result = boundAlarmKb([kbClass("HUGE", ORG_X, [huge]), later], { alarmCode: "HUGE_01" }, COPILOT_ALARM_KB_BUDGET);
  expect(JSON.stringify(result).length).toBeLessThan(TOOL_RESULT_MAX_CHARS);
  const entry = (result as KbOut).classes[0]?.alarms?.[0];
  expect(entry?.alarmCode).toBe("HUGE_01");
  expect(entry?.textCut).toBe(true);
  expect(String(entry?.action).startsWith("aaa")).toBe(true);
  expect(result.truncated).toBe(true);
}

/** Claim H: the KB tool never offers a write — `list` only. */
export async function assertAlarmKbNeverOffersAWrite(): Promise<void> {
  const { services, tools } = fakeServices();
  expect(Object.keys(services.alarmKb)).toEqual(["list"]);
  expect((await tools.dispatch("get_alarm_kb", {}, ctx([ORG_X]))).ok).toBe(true);
}

// --- the turn -------------------------------------------------------------------------------

/** Claim I: the turn's scrub covers the KB body and the enrichment text. */
export async function assertTheTurnScrubsTheKbBodyAndTheDetails(): Promise<void> {
  const secretKb = kbClass("CHILLER", ORG_X, [
    kbEntry("CH_HIGH_DISCHARGE", { cause: "Fouled condenser", action: "Reset the gateway. password: Summer2026" }),
  ]);
  const { tools } = fakeServices({
    kb: [secretKb],
    alarms: { [ALARM_X]: detailsRow(ALARM_X, ASSET_X, { correctiveActions: "Rotate the gateway token: t0k3n-abcdef" }) },
  });
  const llm = new FakeLlmProvider([
    calls(toolCall("get_alarm_kb", { alarmCode: "CH_HIGH_DISCHARGE" })),
    calls(toolCall("get_alarm_details", { alarmId: ALARM_X })),
    { kind: "final", text: "Fouled condenser." },
  ]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  await h.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, "What does this alarm mean?", "user", [], []);
  const content = toolMessages(llm).join("\n");
  expect(content).toContain('"cause":"Fouled condenser"');
  expect(content).toContain('"message":"High discharge temperature"');
  expect(content).not.toContain("Summer2026");
  expect(content).not.toContain("t0k3n-abcdef");
  expect(content.split(COPILOT_REDACTED).length - 1).toBeGreaterThanOrEqual(2);
}

/** Claim J (Done means): one turn joins the alarm's details, the KB and the asset's recent readings, in the allowed organization only. */
export async function assertTheTurnExplainsAnAlarm(): Promise<void> {
  const { tools, log } = fakeServices();
  const llm = new FakeLlmProvider([
    calls(toolCall("get_alarm_details", { alarmId: ALARM_X })),
    calls(toolCall("get_alarm_kb", { query: "discharge" })),
    calls(toolCall("get_recent_values", { assetId: ASSET_X, pointKey: "discharge_temp" })),
    { kind: "final", text: "High discharge temperature: fouled condenser; readings rising." },
  ]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  const response = await h.service.turn(
    { identity: GLOBAL_ADMIN, user: JWT },
    CONVERSATION,
    "What does this alarm mean and what should I check?",
    "user",
    [],
    [],
  );
  expect(log.details).toHaveLength(1);
  expect(log.kb).toEqual([[ORG_X]]);
  expect(log.recent[0]?.pointRef).toBe(encodePointRef(ASSET_X, "discharge_temp"));
  const content = toolMessages(llm).join("\n");
  expect(content).toContain('"message":"High discharge temperature"');
  expect(content).toContain('"rulePointKey":"discharge_temp"');
  expect(content).toContain('"cause":"Fouled condenser"');
  expect(content).toContain('"value":100');
  expect(response.messages.find((m) => m.role === "assistant")?.organizationIds).toEqual([ORG_X]);
}

/** Claim K: the same question about an alarm or a KB of an own-key organization is refused. */
export async function assertTheTurnRefusesAnOwnKeyAlarm(): Promise<void> {
  const { tools, log } = fakeServices();
  const llm = new FakeLlmProvider([
    calls(toolCall("get_alarm_details", { alarmId: ALARM_B })),
    calls(toolCall("get_alarm_kb", { organizationId: ORG_B })),
    { kind: "final", text: "Not in scope." },
  ]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  await h.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, "Explain this alarm.", "user", [], []);
  const messages = toolMessages(llm);
  expect(messages[0]).toContain(COPILOT_TOOL_RECORD_OUT_OF_SCOPE);
  expect(messages.join("\n")).toContain(COPILOT_TOOL_ORGANIZATION_OUT_OF_SCOPE);
  expect(log.details).toEqual([{ alarmId: ALARM_B, assetIds: [ASSET_X] }]);
  expect(log.kb).toEqual([]);
  expect(log.recent).toEqual([]);
}
