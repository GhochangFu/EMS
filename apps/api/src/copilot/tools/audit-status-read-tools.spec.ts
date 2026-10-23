import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { calls, FakeLlmProvider, toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { AuditListRead } from "../../admin/audit/audit.read-scope";
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
import { COPILOT_TOOL_ORGANIZATION_OUT_OF_SCOPE, organizationOutOfScope } from "./copilot-tool-scope";
import {
  boundAuditRows,
  COPILOT_TOOL_AUDIT_PAGE_NEEDS_ONE_ORGANIZATION,
  COPILOT_TOOL_AUDIT_ROLE_REFUSED,
  listAuditLogTool,
  withoutActorSubject,
} from "./list-audit-log.tool";

/**
 * `F4.277` (ADR 0099 decisions 1, 10) — the copilot's `list_audit_log` and
 * `get_system_status` over fake services that log their calls. The audit
 * tool reads once per allowed organization with that organization as the
 * service-internal restriction (`organizationIds`), never without one; the
 * status tool reads once over the union of readable asset ids, never with
 * `null` (the whole fleet). Each refusal claim checks the data log stays empty
 * beside a positive call that reaches it. One `it()` per claim in the sibling
 * `.test.ts` (ADR 0014).
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
const NOW = new Date("2026-10-11T06:00:00Z");

const ASSETS_BY_ORG: Record<string, string[]> = {
  [ORG_X]: [ASSET_X],
  [ORG_Y]: [ASSET_Y],
  [ORG_B]: [ASSET_B],
  [ORG_EMPTY]: [],
};

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

type AuditItem = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  payload: unknown;
};

function auditRow(i: number, organizationId: string, payload: unknown = { after: { name: `Asset ${i}` } }): AuditItem {
  return {
    id: `a-${organizationId.slice(-2)}-${i}`,
    createdAt: new Date(Date.parse("2026-10-10T12:00:00Z") - i * 60_000).toISOString(),
    actorId: USER,
    actorEmail: "ops@x.test",
    action: "master.asset.update",
    entityType: "asset",
    entityId: ASSET_X,
    reason: null,
    payload,
  };
}

type StatusAnswer = Record<string, unknown>;

const STATUS_OK: StatusAnswer = {
  status: "operational",
  components: [
    { key: "queue", state: "ok" },
    { key: "storage", state: "ok" },
    { key: "field_data", state: "ok" },
  ],
  dataQuality: { percent: 100, freshAssets: 2, streamingAssets: 2, windowSeconds: 150 },
  checkedAt: NOW.toISOString(),
  internalNote: "not in the contract",
};

type AuditFakeOptions = {
  /** Rows per organization; the fake honours `limit`/`offset` and reports `total` as the full length. */
  rows?: Record<string, AuditItem[]>;
  /** What `list` throws instead of answering. */
  throws?: Error;
  status?: StatusAnswer;
};

/** Fake services with a call log each. The audit fake exposes only `list`. */
function fakeServices(options: AuditFakeOptions = {}) {
  const log = {
    access: [] as string[],
    audit: [] as Array<{ user: JwtPayload; query: AuditListRead }>,
    status: [] as Array<string[] | null | undefined>,
  };
  const rows = options.rows ?? { [ORG_X]: [auditRow(0, ORG_X)], [ORG_Y]: [auditRow(0, ORG_Y)] };
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => {
        log.access.push(organizationId);
        return ASSETS_BY_ORG[organizationId] ?? [];
      },
    },
    audit: {
      list: async (user: JwtPayload, query: AuditListRead) => {
        log.audit.push({ user, query });
        if (options.throws !== undefined) throw options.throws;
        const scoped = (query.organizationIds ?? []).flatMap((id) => rows[id] ?? []);
        const page = scoped.slice(query.offset, query.offset + query.limit);
        return { items: page, total: scoped.length, limit: query.limit, offset: query.offset };
      },
    },
    systemStatus: {
      read: async (assetIds: string[] | null | undefined) => {
        log.status.push(assetIds);
        return options.status ?? STATUS_OK;
      },
    },
  } as unknown as CopilotReadServices;
  return { services, log, tools: createCopilotReadTools(services) };
}

type Tools = ReturnType<typeof fakeServices>["tools"];

function okResult(out: CopilotToolResult): Record<string, unknown> {
  if (!out.ok) throw new Error(`F4.277: the tool refused: ${out.error}`);
  return out.result;
}

type OrganizationEntry = { organizationId: string; items: AuditItem[]; total: number };

function organizationsOf(result: Record<string, unknown>): OrganizationEntry[] {
  return result.organizations as OrganizationEntry[];
}

function toolMessages(llm: FakeLlmProvider): string[] {
  return llm.seen.flat().flatMap((m: LlmMessage) => (m.role === "tool" ? [m.content] : []));
}

async function refusedByTheSchema(tools: Tools, args: Record<string, unknown>) {
  return runToolCall(tools.registry, toolCall("list_audit_log", args), () => Promise.reject(new Error("must not dispatch")), COPILOT_TOOL_GUARDS);
}

function asOutcome(out: CopilotToolResult) {
  return out.ok ? { ok: true as const, content: JSON.stringify(out.result) } : { ok: false as const, content: out.error };
}

/** Runs one call the way the turn does: guards, the schema, then dispatch. */
async function viaRegistry(tools: Tools, name: string, args: Record<string, unknown>, allowed = [ORG_X]) {
  return runToolCall(tools.registry, toolCall(name, args), (n, a) => tools.dispatch(n, a, ctx(allowed)).then(asOutcome), COPILOT_TOOL_GUARDS);
}

// --- list_audit_log -----------------------------------------------------------------------

/** Claim 1: an own-key organization is refused before any read; an allowed one is read with itself as the restriction. */
export async function assertListAuditLogRefusesAnOwnKeyOrganizationAndReadsAnAllowedOne(): Promise<void> {
  const { tools, log } = fakeServices();
  const refused = await tools.dispatch("list_audit_log", { organizationId: ORG_B, limit: 10 }, ctx([ORG_X, ORG_Y]));
  expect(refused).toEqual({ ok: false, error: organizationOutOfScope([ORG_X, ORG_Y]) });
  expect(log.audit).toEqual([]);

  const out = await tools.dispatch("list_audit_log", { organizationId: ORG_X, limit: 10 }, ctx([ORG_X, ORG_Y]));
  expect(log.audit.map((c) => c.query.organizationIds)).toEqual([[ORG_X]]);
  expect(out.ok && out.organizationIds).toEqual([ORG_X]);
}

/** Claim 2: one read per allowed organization, each restricted to that organization, sharing the room. */
export async function assertListAuditLogReadsOncePerOrganizationWithThatOrganizationOnly(): Promise<void> {
  const rows = {
    [ORG_X]: Array.from({ length: 6 }, (_, i) => auditRow(i, ORG_X)),
    [ORG_Y]: Array.from({ length: 6 }, (_, i) => auditRow(i, ORG_Y)),
  };
  const { tools, log } = fakeServices({ rows });
  const out = await tools.dispatch("list_audit_log", { limit: 8 }, ctx([ORG_X, ORG_Y]));
  const result = okResult(out);
  expect(log.audit.map((c) => c.query.organizationIds)).toEqual([[ORG_X], [ORG_Y]]);
  expect(log.audit.every((c) => c.query.organizationIds !== undefined)).toBe(true);
  expect(log.audit.map((c) => c.query.limit)).toEqual([8, 2]);
  expect(log.audit.every((c) => c.user === JWT)).toBe(true);
  const entries = organizationsOf(result);
  expect(entries.map((e) => e.items.length)).toEqual([6, 2]);
  expect(entries.map((e) => e.total)).toEqual([6, 6]);
  expect(result.truncated).toBe(true);
  expect(out.ok && out.organizationIds).toEqual([ORG_X, ORG_Y]);

  // Adjacent negative: every row fits, so nothing is truncated.
  const small = fakeServices();
  expect(okResult(await small.tools.dispatch("list_audit_log", { limit: 10 }, ctx([ORG_X, ORG_Y]))).truncated).toBe(false);
}

/** Claim 3: the service's role refusal becomes the named refusal; any other failure propagates. */
export async function assertListAuditLogMapsTheServiceRoleRefusal(): Promise<void> {
  const forbidden = fakeServices({ throws: new ForbiddenException("Reading the audit log requires the global admin or organization admin role") });
  expect(await forbidden.tools.dispatch("list_audit_log", { limit: 10 }, ctx([ORG_X]))).toEqual({
    ok: false,
    error: COPILOT_TOOL_AUDIT_ROLE_REFUSED,
  });
  expect(forbidden.log.audit).toHaveLength(1);

  const broken = fakeServices({ throws: new Error("db") });
  await expect(broken.tools.dispatch("list_audit_log", { limit: 10 }, ctx([ORG_X]))).rejects.toThrow("db");

  const fine = fakeServices();
  expect((await fine.tools.dispatch("list_audit_log", { limit: 10 }, ctx([ORG_X]))).ok).toBe(true);
}

/** Claim 4: the schema refuses an out-of-range page, a bad time and an unknown key before any dispatch; the default limit is 10. */
export async function assertListAuditLogSchemaBounds(): Promise<void> {
  const { tools, log } = fakeServices();
  const cases: ReadonlyArray<[Record<string, unknown>, string]> = [
    [{ limit: 0 }, "limit"],
    [{ limit: 26 }, "limit"],
    [{ offset: 1001 }, "offset"],
    [{ from: "yesterday" }, "from"],
    [{ from: "2026-10-11T00:00:00Z", to: "2026-10-10T00:00:00Z" }, "to"],
    [{ format: "csv" }, "format"],
  ];
  for (const [args, field] of cases) {
    const refused = await refusedByTheSchema(tools, args);
    expect(refused.ok, JSON.stringify(args)).toBe(false);
    expect(refused.content, JSON.stringify(args)).toContain(field);
  }
  expect(log.audit).toEqual([]);

  const ok = await viaRegistry(tools, "list_audit_log", {});
  expect(ok.ok).toBe(true);
  expect(log.audit.map((c) => c.query.limit)).toEqual([10]);
  expect(log.audit.map((c) => c.query.offset)).toEqual([0]);
}

/** Claim 5: a large payload is replaced by a summary, and the whole result stays under the tool-result cut as a prefix. */
export async function assertListAuditLogBoundsThePayloadAndTheResult(): Promise<void> {
  const big = { widgets: "w".repeat(4_980), name: "x" };
  const bigChars = JSON.stringify(big).length;
  const { rows } = boundAuditRows([auditRow(0, ORG_X, big)], 1_000_000);
  expect(rows[0]?.payload).toEqual({ omitted: true, chars: bigChars, keys: ["widgets", "name"] });
  const small = { after: { name: "kept" } };
  expect(boundAuditRows([auditRow(0, ORG_X, small)], 1_000_000).rows[0]?.payload).toEqual(small);

  const many = Array.from({ length: 25 }, (_, i) => auditRow(i, ORG_X, { note: "n".repeat(1_000) }));
  const { tools } = fakeServices({ rows: { [ORG_X]: many } });
  const result = okResult(await tools.dispatch("list_audit_log", { limit: 25 }, ctx([ORG_X])));
  expect(JSON.stringify(result).length).toBeLessThan(TOOL_RESULT_MAX_CHARS);
  expect(result.truncated).toBe(true);
  const kept = organizationsOf(result)[0]?.items ?? [];
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length).toBeLessThan(25);
  expect(kept.map((r) => r.id)).toEqual(many.slice(0, kept.length).map((r) => r.id));
}

/** Claim 12: a page past the first over more than one organization is refused before any read; one named organization pages. */
export async function assertListAuditLogPagesOneOrganizationOnly(): Promise<void> {
  const rows = {
    [ORG_X]: Array.from({ length: 3 }, (_, i) => auditRow(i, ORG_X)),
    [ORG_Y]: Array.from({ length: 30 }, (_, i) => auditRow(i, ORG_Y)),
  };
  const { tools, log } = fakeServices({ rows });
  expect(await tools.dispatch("list_audit_log", { limit: 10, offset: 10 }, ctx([ORG_X, ORG_Y]))).toEqual({
    ok: false,
    error: COPILOT_TOOL_AUDIT_PAGE_NEEDS_ONE_ORGANIZATION,
  });
  expect(log.audit).toEqual([]);

  const out = okResult(await tools.dispatch("list_audit_log", { organizationId: ORG_Y, limit: 10, offset: 10 }, ctx([ORG_X, ORG_Y])));
  expect(log.audit.map((c) => [c.query.organizationIds, c.query.offset])).toEqual([[[ORG_Y], 10]]);
  expect(organizationsOf(out)[0]?.items.map((r) => r.id)).toEqual(rows[ORG_Y].slice(10, 20).map((r) => r.id));
}

/** Claim 13: once the budget refuses a row, no later organization is read, and many organizations stay under the cut. */
export async function assertListAuditLogStopsReadingAfterTheBudgetDropsARow(): Promise<void> {
  const orgs = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${(0x100 + i).toString(16).padStart(12, "0")}`);
  const big = Array.from({ length: 25 }, (_, i) => auditRow(i, orgs[0] as string, { note: "n".repeat(1_000) }));
  const rows: Record<string, AuditItem[]> = Object.fromEntries(orgs.map((id, i) => [id, i === 0 ? big : [auditRow(0, id, { note: "n".repeat(1_000) })]]));
  const { tools, log } = fakeServices({ rows });
  const result = okResult(await tools.dispatch("list_audit_log", { limit: 25 }, ctx(orgs)));
  expect(log.audit).toHaveLength(1);
  expect(result.truncated).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThan(TOOL_RESULT_MAX_CHARS);

  // Many organizations with no matching row: the entries alone are bounded by the budget.
  const empty = fakeServices({ rows: {} });
  const many = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${(0x1000 + i).toString(16).padStart(12, "0")}`);
  const emptyResult = okResult(await empty.tools.dispatch("list_audit_log", { limit: 25 }, ctx(many)));
  expect(JSON.stringify(emptyResult).length).toBeLessThan(TOOL_RESULT_MAX_CHARS);
  expect(emptyResult.truncated).toBe(true);
  expect(empty.log.audit.length).toBeGreaterThan(0);
  expect(empty.log.audit.length).toBeLessThan(200);
}

/** Claim 14 (ADR 0046 Amendment 2): the acting operator's `oidcSubject` never reaches the model, even for the global admin. */
export async function assertListAuditLogStripsTheActorSubject(): Promise<void> {
  const subject = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
  const payload = { oidcSubject: subject, after: { name: "Rule 7" } };
  const { tools } = fakeServices({ rows: { [ORG_X]: [auditRow(0, ORG_X, payload)] } });
  const result = okResult(await tools.dispatch("list_audit_log", { limit: 10 }, ctx([ORG_X])));
  const row = organizationsOf(result)[0]?.items[0];
  expect(row?.payload).toEqual({ after: { name: "Rule 7" } });
  expect(JSON.stringify(result)).not.toContain(subject);
  expect(withoutActorSubject({ after: 1 })).toEqual({ after: 1 });
}

/** Claim 6 (D4): the turn's scrub withholds a secret in an audit payload by key and by value, and keeps the rest. */
export async function assertTheTurnScrubsAnAuditPayload(): Promise<void> {
  const payload = {
    before: { name: "Chiller 2" },
    after: { name: "Chiller 2b", broker: "mqtts://ops:S3cret-Pass@broker.local" },
    meta: { mqttPassword: "Summer2026" },
    apiToken: "t0k3n-abcdef",
  };
  const { tools } = fakeServices({ rows: { [ORG_X]: [auditRow(0, ORG_X, payload)] } });
  const llm = new FakeLlmProvider([calls(toolCall("list_audit_log", {})), { kind: "final", text: "Renamed." }]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  await h.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, "Who renamed the chiller?", "user", [], []);
  const content = toolMessages(llm).join("\n");
  expect(content).toContain('"name":"Chiller 2b"');
  expect(content).not.toContain("Summer2026");
  expect(content).not.toContain("t0k3n-abcdef");
  expect(content).not.toContain("S3cret-Pass");
  expect(content.split(COPILOT_REDACTED).length - 1).toBeGreaterThanOrEqual(3);
}

/** Claim 7 (the row's Done means): "who changed this asset yesterday?" is answered from the audit log of the allowed organization only. */
export async function assertTheTurnAnswersWhoChangedThisAssetYesterday(): Promise<void> {
  const question = "Who changed this asset yesterday?";
  const window = { entityId: ASSET_X, from: "2026-10-10T00:00:00Z", to: "2026-10-11T00:00:00Z" };
  const { tools, log } = fakeServices();
  const llm = new FakeLlmProvider([calls(toolCall("list_audit_log", window)), { kind: "final", text: "ops@x.test updated it." }]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  const response = await h.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, question, "user", [], []);
  expect(log.audit.map((c) => c.query.organizationIds)).toEqual([[ORG_X]]);
  expect(log.audit.map((c) => c.query.entityId)).toEqual([ASSET_X]);
  expect(log.audit.map((c) => [c.query.from, c.query.to])).toEqual([[window.from, window.to]]);
  const content = toolMessages(llm).join("\n");
  expect(content).toContain('"actorEmail":"ops@x.test"');
  expect(content).toContain('"action":"master.asset.update"');
  expect(response.messages.find((m) => m.role === "assistant")?.organizationIds).toEqual([ORG_X]);

  const refused = fakeServices();
  const llm2 = new FakeLlmProvider([
    calls(toolCall("list_audit_log", { ...window, organizationId: ORG_B })),
    { kind: "final", text: "Not in scope." },
  ]);
  const h2 = harness(llm2, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: refused.tools });
  await h2.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, question, "user", [], []);
  expect(refused.log.audit).toEqual([]);
  expect(toolMessages(llm2).join("\n")).toContain(COPILOT_TOOL_ORGANIZATION_OUT_OF_SCOPE);
}

/** Claim 8: the export is not offered — no `format` argument, and a service fake with `list` alone runs the tool. */
export async function assertListAuditLogNeverOffersTheExport(): Promise<void> {
  const shape = (listAuditLogTool.schema as unknown as { _def: { schema: { shape: Record<string, unknown> } } })._def.schema.shape;
  expect(Object.keys(shape)).not.toContain("format");
  expect(Object.keys(shape)).toContain("entityId");
  const { services, tools } = fakeServices();
  expect(Object.keys(services.audit)).toEqual(["list"]);
  expect((await tools.dispatch("list_audit_log", { limit: 10 }, ctx([ORG_X]))).ok).toBe(true);
}

// --- get_system_status --------------------------------------------------------------------

/** Claim 9: one read over the union of readable asset ids, never `null`; an own-key organization is refused before any read. */
export async function assertSystemStatusReadsOnceOverTheUnionAndNeverNull(): Promise<void> {
  const { tools, log } = fakeServices();
  const out = await tools.dispatch("get_system_status", {}, ctx([ORG_X, ORG_Y, ORG_EMPTY]));
  expect(log.status).toEqual([[ASSET_X, ASSET_Y]]);
  expect(out.ok && out.organizationIds).toEqual([ORG_X, ORG_Y]);
  expect(okResult(out).organizationIds).toEqual([ORG_X, ORG_Y]);

  const refused = fakeServices();
  expect(await refused.tools.dispatch("get_system_status", { organizationId: ORG_B }, ctx([ORG_X]))).toEqual({
    ok: false,
    error: organizationOutOfScope([ORG_X]),
  });
  expect(refused.log.status).toEqual([]);

  const one = fakeServices();
  await one.tools.dispatch("get_system_status", { organizationId: ORG_X }, ctx([ORG_X, ORG_Y]));
  expect(one.log.status).toEqual([[ASSET_X]]);
}

/** Claim 10: no readable asset still reads the platform with `[]` (never `null`), and the contract strips an extra key. */
export async function assertSystemStatusWithNoReadableAssetReadsAnEmptyList(): Promise<void> {
  const answer = { ...STATUS_OK, dataQuality: { percent: null, freshAssets: 0, streamingAssets: 0, windowSeconds: 150 } };
  const { tools, log } = fakeServices({ status: answer });
  const out = await tools.dispatch("get_system_status", {}, ctx([ORG_EMPTY]));
  expect(log.status).toEqual([[]]);
  const result = okResult(out);
  expect(result.organizationIds).toEqual([]);
  expect(out.ok && out.organizationIds).toEqual([]);
  const status = result.status as Record<string, unknown>;
  expect((status.dataQuality as { percent: unknown }).percent).toBeNull();
  expect(status).not.toHaveProperty("internalNote");
  expect(status.status).toBe("operational");
}

/** Claim 11: "is ingest healthy?" reaches the model as the component states and the verdict. */
export async function assertTheTurnAnswersIsIngestHealthy(): Promise<void> {
  const degraded = {
    ...STATUS_OK,
    status: "degraded",
    components: [
      { key: "queue", state: "ok" },
      { key: "storage", state: "ok" },
      { key: "field_data", state: "degraded" },
    ],
  };
  const { tools, log } = fakeServices({ status: degraded });
  const llm = new FakeLlmProvider([calls(toolCall("get_system_status", {})), { kind: "final", text: "Field data is degraded." }]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  const response = await h.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, "Is ingest healthy?", "user", [], []);
  expect(log.status).toEqual([[ASSET_X]]);
  const content = toolMessages(llm).join("\n");
  expect(content).toContain('"key":"field_data","state":"degraded"');
  expect(content).toContain('"status":"degraded"');
  expect(response.messages.find((m) => m.role === "assistant")?.organizationIds).toEqual([ORG_X]);
}
