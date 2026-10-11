import { expect } from "vitest";
import { z } from "zod";

import type { CopilotPendingChangeDto, JwtPayload } from "@bms/shared";
import { type CatalogEntry, COPILOT_CATALOG, proposeToolName } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { jsonSchemaOf, runToolCall } from "../llm/tool-registry";
import type { ToolOutcome } from "../llm/tool-result";
import { bodyHash } from "./body-hash";
import type { NewPendingChange } from "./copilot-pending-changes.service";
import {
  createCopilotProposeTools,
  DESCRIBE_CHANGE_TOOL,
  FILL_STEP_TOOL,
  modelBodySchema,
  PROPOSE_ACCESS_ON_FOLLOW_UP_ERROR,
  PROPOSE_OPEN_CHANGE_ERROR,
  PROPOSE_TARGET_ERROR,
} from "./copilot-propose-tools";
import type { CopilotToolContext, CopilotToolResult } from "./copilot-read-tools";
import type { ResolvedTarget } from "./copilot-target-resolver";
import { COPILOT_TOOL_GUARDS } from "./copilot-turn.service";

/**
 * `F3.85` PR 8 / ADR 0099 decisions 2, 3, 4, 10 (plan §10.2) — the propose
 * tools over a fake target resolver and a fake pending store. Each call goes
 * through `runToolCall` with the turn's own guards, as a turn sends it.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ROW = "33333333-3333-4333-8333-333333333333";

/** The shared vector (`body-hash.spec.ts`, `canonical-json.spec.ts`) and its SHA-256. */
const VECTOR = { b: [{ z: 1, a: null }], a: "x" };
const VECTOR_SHA256 = "cd46abb94645a78c7ce4802b707895cda25a3e69932ec5040b0fcb7abc663b64";
const EMPTY_SHA256 = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";

function fixtureEntry(over: Partial<CatalogEntry>): CatalogEntry {
  return {
    id: "fixture.vector",
    title: "Store the vector",
    method: "POST",
    path: "/fixtures",
    params: {},
    body: z.object({ a: z.string(), b: z.array(z.object({ z: z.number(), a: z.null() }).strict()) }).strict(),
    bodyName: "fixtureBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "organization" },
    refs: [],
    formulas: [],
    steps: [{ id: "all", title: "All", fields: ["a", "b"] }],
    summary: ({ targetName }) => `Store the vector for ${targetName}.`,
    ...over,
  };
}

const VECTOR_ENTRY = fixtureEntry({});
const ACCESS_ENTRY = fixtureEntry({ id: "fixture.access", risk: "access" });
const CLIENT_ONLY_ENTRY = fixtureEntry({
  id: "fixture.password",
  body: z.object({ userId: z.string(), temporaryPassword: z.string().min(8) }).strict(),
  clientOnly: ["temporaryPassword"],
  steps: [{ id: "user", title: "User", fields: ["userId"] }],
});

type Options = { target?: ResolvedTarget | null; open?: boolean; catalog?: readonly CatalogEntry[] };

export function proposeHarness(options: Options = {}) {
  const stored: NewPendingChange[] = [];
  const resolved: Array<{ id: string; params: Record<string, string>; allowed: readonly string[] }> = [];
  const target: ResolvedTarget | null =
    options.target === undefined ? { organizationId: ORG_X, organizationName: "Org X", targetName: "Template T" } : options.target;
  const tools = createCopilotProposeTools(
    {
      targets: {
        resolve: async (entry, params, _body, allowed) => {
          resolved.push({ id: entry.id, params: { ...params }, allowed });
          return target;
        },
      },
      pending: {
        hasOpen: async () => options.open === true,
        propose: async (_userId, change): Promise<CopilotPendingChangeDto> => {
          stored.push(change);
          return {
            id: "44444444-4444-4444-8444-444444444444",
            catalogId: change.catalogId,
            method: change.method,
            path: change.path,
            body: change.body,
            summary: change.summary,
            risk: change.risk,
            proposedAt: "2026-10-11T06:00:00.000Z",
            expiresAt: "2026-10-11T06:15:00.000Z",
          };
        },
      },
    },
    options.catalog,
  );
  const ctx = (over: Partial<CopilotToolContext> = {}): CopilotToolContext => ({
    identity: { id: USER, role: "admin", organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role: "admin" } as JwtPayload,
    conversationId: CONVERSATION,
    conversationOrganizationId: ORG_X,
    allowedOrganizationIds: [ORG_X],
    turnKind: "user",
    now: new Date("2026-10-11T06:00:00Z"),
    ...over,
  });
  let last: CopilotToolResult | null = null;
  const call = (name: string, args: unknown, over: Partial<CopilotToolContext> = {}): Promise<ToolOutcome> =>
    runToolCall(
      tools.registry,
      { id: "c1", name, arguments: JSON.stringify(args) },
      async (n, a) => {
        last = await tools.dispatch(n, a, ctx(over));
        return last.ok ? { ok: true, content: JSON.stringify(last.result) } : { ok: false, content: last.error, error: last.error };
      },
      COPILOT_TOOL_GUARDS,
    );
  return { tools, stored, resolved, call, lastResult: () => last };
}

/** A valid body stores one row whose hash is the canonical hash of the shared vector. */
export async function aValidBodyStoresTheCanonicalHash(): Promise<void> {
  const h = proposeHarness({ catalog: [VECTOR_ENTRY] });
  const outcome = await h.call(proposeToolName(VECTOR_ENTRY), { body: VECTOR });
  expect(outcome.ok).toBe(true);
  expect(h.stored).toHaveLength(1);
  expect(h.stored[0]).toMatchObject({
    conversationId: CONVERSATION,
    organizationId: ORG_X,
    catalogId: "fixture.vector",
    method: "POST",
    path: "/api/v1/fixtures",
    body: VECTOR,
    bodyHash: VECTOR_SHA256,
    risk: "create",
    summary: "Store the vector for Template T.",
  });
}

export async function anInvalidBodyStoresNothing(): Promise<void> {
  const h = proposeHarness({ catalog: [VECTOR_ENTRY] });
  const outcome = await h.call(proposeToolName(VECTOR_ENTRY), { body: { a: 1 } });
  expect(outcome.ok).toBe(false);
  expect(outcome.error).toMatch(/^Invalid body: /);
  expect(h.stored).toEqual([]);
}

/** One card at a time: a second proposal while one is open is refused. */
export async function aSecondProposalWhileOneIsOpenIsRefused(): Promise<void> {
  const h = proposeHarness({ catalog: [VECTOR_ENTRY], open: true });
  const outcome = await h.call(proposeToolName(VECTOR_ENTRY), { body: VECTOR });
  expect(outcome.error).toBe(PROPOSE_OPEN_CHANGE_ERROR);
  expect(h.stored).toEqual([]);
}

/** A formula that fails `validateFormula` under its dialect stores nothing; the adjacent valid one stores. */
export async function anInvalidFormulaStoresNothing(): Promise<void> {
  const target = { organizationId: ORG_X, organizationName: "Org X", targetName: "Pump 1", pointKeys: ["kw", "kva"] };
  const body = (formula: string) => ({
    formula,
    formulaDialect: "bms-calc-v1",
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
  });
  const bad = proposeHarness({ target });
  const refused = await bad.call("propose_calcOverride_set", { assetId: ROW, pointKey: "pf", body: body("{kw} / {missing}") });
  expect(refused.error).toMatch(/^The formula in formula is not valid/);
  expect(bad.stored).toEqual([]);
  const good = proposeHarness({ target });
  expect((await good.call("propose_calcOverride_set", { assetId: ROW, pointKey: "pf", body: body("{kw} / {kva}") })).ok).toBe(true);
  expect(good.stored).toHaveLength(1);
}

/**
 * Decision 10: a target outside the allowed set stores nothing — the tool
 * checks the resolver's answer itself, so a resolver that strays cannot widen
 * the scope. The adjacent positive is `aValidBodyStoresTheCanonicalHash`.
 */
export async function aTargetOutsideTheAllowedSetStoresNothing(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_Y, organizationName: "Org Y", targetName: "Y-T" } });
  const outcome = await h.call("propose_dashboardTemplate_archive", { id: ROW });
  expect(outcome.error).toBe(PROPOSE_TARGET_ERROR);
  expect(h.stored).toEqual([]);
  expect(h.resolved[0]?.allowed).toEqual([ORG_X]);
}

/** A cross-organization turn: the target must be in the platform scope, and the resolver is asked with that scope. */
export async function aCrossOrganizationProposalUsesTheAllowedSet(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_Y, organizationName: "Org Y", targetName: "Y-T" } });
  const outcome = await h.call(
    "propose_dashboardTemplate_archive",
    { id: ROW },
    { conversationOrganizationId: null, allowedOrganizationIds: [ORG_X, ORG_Y] },
  );
  expect(outcome.ok).toBe(true);
  expect(h.resolved[0]?.allowed).toEqual([ORG_X, ORG_Y]);
  expect(h.stored[0]?.organizationId).toBe(ORG_Y);
}

export async function aMissingTargetStoresNothing(): Promise<void> {
  const h = proposeHarness({ target: null });
  expect((await h.call("propose_dashboardTemplate_archive", { id: ROW })).error).toBe(PROPOSE_TARGET_ERROR);
  expect(h.stored).toEqual([]);
}

/** The turn's credential guard runs on propose arguments too: nothing is resolved or stored. */
export async function aCredentialInAProposeArgumentIsRefused(): Promise<void> {
  const h = proposeHarness();
  const outcome = await h.call("propose_dashboard_update", { id: ROW, body: { description: "password: hunter2" } });
  expect(outcome.ok).toBe(false);
  expect(h.resolved).toEqual([]);
  expect(h.stored).toEqual([]);
}

/** A bodyless entry stores `{}`, the hash of `{}`, and its encoded path. */
export async function aBodylessEntryStoresTheEmptyObject(): Promise<void> {
  const h = proposeHarness();
  expect((await h.call("propose_dashboardTemplate_publish", { id: ROW })).ok).toBe(true);
  expect(h.stored[0]).toMatchObject({
    body: {},
    bodyHash: EMPTY_SHA256,
    path: `/api/v1/admin/dashboard-templates/${ROW}/publish`,
    method: "POST",
    risk: "edit",
  });
  expect(bodyHash({})).toBe(EMPTY_SHA256);
}

/** A path parameter that fails its schema stores nothing and resolves nothing. */
export async function aBadPathParameterStoresNothing(): Promise<void> {
  const h = proposeHarness();
  for (const args of [{ id: "not-a-uuid" }, { id: ROW, extra: 1 }, {}]) {
    expect((await h.call("propose_dashboardTemplate_archive", args)).ok, JSON.stringify(args)).toBe(false);
  }
  expect(h.resolved).toEqual([]);
  expect(h.stored).toEqual([]);
}

/** The path is stored encoded, exactly as the interceptor will read `req.path`. */
export async function aPathParameterIsStoredEncoded(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_X, organizationName: "Org X", targetName: "Pump 1", pointKeys: [] } });
  const body = { formula: null, formulaDialect: null, calcTrigger: null, calcIntervalSeconds: null, maxInputAgeSeconds: 30 };
  expect((await h.call("propose_calcOverride_set", { assetId: ROW, pointKey: "kw total/x", body })).ok).toBe(true);
  expect(h.stored[0]?.path).toBe(`/api/v1/admin/assets/${ROW}/calc-points/kw%20total%2Fx`);
}

/** Decision 4.7: a follow-up turn never proposes an access change; the adjacent user turn does. */
export async function anAccessChangeIsRefusedOnAFollowUp(): Promise<void> {
  const h = proposeHarness({ catalog: [ACCESS_ENTRY] });
  const refused = await h.call(proposeToolName(ACCESS_ENTRY), { body: VECTOR }, { turnKind: "follow_up" });
  expect(refused.error).toBe(PROPOSE_ACCESS_ON_FOLLOW_UP_ERROR);
  expect(h.stored).toEqual([]);
  expect((await h.call(proposeToolName(ACCESS_ENTRY), { body: VECTOR }, { turnKind: "user" })).ok).toBe(true);
  expect(h.stored).toHaveLength(1);
}

/** A `clientOnly` field is in no tool definition and no stored body; the model's body omits it. */
export async function aClientOnlyFieldNeverReachesTheModel(): Promise<void> {
  const h = proposeHarness({ catalog: [CLIENT_ONLY_ENTRY] });
  const definition = h.tools.registry.definitions.find((d) => d.name === proposeToolName(CLIENT_ONLY_ENTRY));
  expect(JSON.stringify(definition)).toContain("userId");
  expect(JSON.stringify(definition)).not.toContain("temporaryPassword");
  expect(JSON.stringify(jsonSchemaOf(modelBodySchema(CLIENT_ONLY_ENTRY)))).not.toContain("temporaryPassword");
  expect((await h.call(proposeToolName(CLIENT_ONLY_ENTRY), { body: { userId: "u1" } })).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual({ userId: "u1" });
  expect(() => modelBodySchema(fixtureEntry({ clientOnly: ["a"], body: z.object({ a: z.string() }).refine(() => true) }))).toThrow(
    /plain object/,
  );
}

/** Every catalog entry has one propose tool; the definitions stay small enough to send on every turn. */
export function everyEntryHasOneSlimProposeTool(): void {
  const h = proposeHarness();
  const names = h.tools.registry.definitions.map((d) => d.name);
  expect(names).toEqual([...COPILOT_CATALOG.map(proposeToolName), FILL_STEP_TOOL, DESCRIBE_CHANGE_TOOL]);
  // The widget save alone is 45 KB as JSON Schema; inlined, the set was about 87 KB.
  expect(JSON.stringify(h.tools.registry.definitions).length).toBeLessThan(20_000);
  const widgets = h.tools.registry.definitions.find((d) => d.name === "propose_dashboard_widgets_replace");
  expect(JSON.stringify(widgets)).toContain("describe_change");
  const create = h.tools.registry.definitions.find((d) => d.name === "propose_dashboard_create");
  expect(JSON.stringify(create)).toContain('"slug"');
}

/** `describe_change` reads one part of a large body on demand. */
export async function describeChangeReadsAPartOfTheBody(): Promise<void> {
  const h = proposeHarness();
  expect((await h.call(DESCRIBE_CHANGE_TOOL, { catalogId: "dashboard.widgets.replace" })).ok).toBe(true);
  const chart = await h.call(DESCRIBE_CHANGE_TOOL, { catalogId: "dashboard.widgets.replace", path: ["widgets", "[]", "chart"] });
  expect(chart.ok).toBe(true);
  expect(JSON.stringify(h.lastResult())).toContain('"chart"');
  expect((await h.call(DESCRIBE_CHANGE_TOOL, { catalogId: "dashboard.widgets.replace", path: ["nope"] })).ok).toBe(false);
  expect((await h.call(DESCRIBE_CHANGE_TOOL, { catalogId: "dashboard.delete" })).ok).toBe(false);
  expect(h.stored).toEqual([]);
}

/** `fill_step` checks the values against the step's fields and writes nothing. */
export async function fillStepChecksOneStepAndWritesNothing(): Promise<void> {
  const h = proposeHarness();
  const ok = await h.call(FILL_STEP_TOOL, { catalogId: "dashboard.create", stepId: "basics", values: { name: "Main", slug: "main" } });
  expect(ok.ok).toBe(true);
  const result = h.lastResult();
  expect(result?.ok && result.fillStep).toEqual({ catalogId: "dashboard.create", stepId: "basics", values: { name: "Main", slug: "main" } });
  expect((await h.call(FILL_STEP_TOOL, { catalogId: "dashboard.create", stepId: "basics", values: { organizationId: ORG_X } })).ok).toBe(false);
  expect((await h.call(FILL_STEP_TOOL, { catalogId: "dashboard.create", stepId: "basics", values: { slug: "Bad Slug" } })).ok).toBe(false);
  expect((await h.call(FILL_STEP_TOOL, { catalogId: "dashboard.create", stepId: "nope", values: {} })).ok).toBe(false);
  expect(h.stored).toEqual([]);
  expect(h.resolved).toEqual([]);
}
