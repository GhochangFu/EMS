import { expect } from "vitest";
import { z } from "zod";

import type { CopilotPendingChangeDto, JwtPayload } from "@bms/shared";
import { type CatalogEntry, catalogEntry, COPILOT_CATALOG, proposeToolName } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { jsonSchemaOf, runToolCall } from "../llm/tool-registry";
import type { ToolOutcome } from "../llm/tool-result";
import { LOCAL_MODE_READ_ONLY } from "../admin/users/users.service";
import { bodyHash } from "./body-hash";
import { PROPOSE_ACCESS_NOT_ASKED_ERROR } from "./copilot-access-intent";
import { INLINE_BODY_SCHEMA_MAX_CHARS } from "./copilot-change-schema";
import type { NewPendingChange } from "./copilot-pending-changes.service";
import {
  createCopilotProposeTools,
  DESCRIBE_BUDGET_ERROR,
  DESCRIBE_CHANGE_BUDGET,
  DESCRIBE_CHANGE_TOOL,
  FILL_STEP_TOOL,
  modelBodySchema,
  PROPOSE_ACCESS_ON_FOLLOW_UP_ERROR,
  PROPOSE_FLEET_UNBOUND_ERROR,
  PROPOSE_OPEN_CHANGE_ERROR,
  PROPOSE_STORED_CONTENT_ERROR,
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
    target: { kind: "organization", manage: "template" },
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

type Options = {
  target?: ResolvedTarget | null;
  open?: boolean;
  /** Another turn stored a change between `hasOpen` and the insert: the store answers `null`. */
  raced?: boolean;
  catalog?: readonly CatalogEntry[];
  /** `F3.86` PR 4: the environment the tools read the auth mode from (ruling Q8). */
  env?: Record<string, string | undefined>;
};

export function proposeHarness(options: Options = {}) {
  const stored: NewPendingChange[] = [];
  const resolved: Array<{ id: string; params: Record<string, string>; allowed: readonly string[]; bound?: string | null }> = [];
  const target: ResolvedTarget | null =
    options.target === undefined ? { organizationId: ORG_X, organizationName: "Org X", targetName: "Template T" } : options.target;
  const tools = createCopilotProposeTools(
    {
      targets: {
        resolve: async (entry, params, _body, allowed, _user, bound) => {
          resolved.push({ id: entry.id, params: { ...params }, allowed, bound });
          return target;
        },
      },
      pending: {
        hasOpen: async () => options.open === true,
        propose: async (_userId, change): Promise<CopilotPendingChangeDto | null> => {
          if (options.raced) return null;
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
    options.env ?? { AUTH_MODE: "oidc" },
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
  return { tools, stored, resolved, call, ctx, lastResult: () => last };
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

/** The store's own check (one transaction, under a lock) refuses a change another turn opened first. */
export async function aProposalThatLosesTheRaceIsRefused(): Promise<void> {
  const h = proposeHarness({ catalog: [VECTOR_ENTRY], raced: true });
  const outcome = await h.call(proposeToolName(VECTOR_ENTRY), { body: VECTOR });
  expect(outcome.error).toBe(PROPOSE_OPEN_CHANGE_ERROR);
  expect(h.lastResult()?.ok).toBe(false);
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

/**
 * The two scope checks, each alone (mutations M1, M7): a cross-organization
 * turn whose resolver strays outside the allowed set, and a bound turn whose
 * resolver names another allowed organization. Each must refuse by itself.
 */
export async function eachScopeCheckRefusesAlone(): Promise<void> {
  const stray = proposeHarness({ target: { organizationId: ORG_Y, organizationName: "Org Y", targetName: "Y-T" } });
  const cross = await stray.call("propose_dashboardTemplate_archive", { id: ROW }, { conversationOrganizationId: null, allowedOrganizationIds: [ORG_X] });
  expect(cross.error).toBe(PROPOSE_TARGET_ERROR);
  expect(stray.stored).toEqual([]);
  const other = proposeHarness({ target: { organizationId: ORG_Y, organizationName: "Org Y", targetName: "Y-T" } });
  const bound = await other.call("propose_dashboardTemplate_archive", { id: ROW }, { conversationOrganizationId: ORG_X, allowedOrganizationIds: [ORG_X, ORG_Y] });
  expect(bound.error).toBe(PROPOSE_TARGET_ERROR);
  expect(other.stored).toEqual([]);
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
  expect((await h.call(proposeToolName(ACCESS_ENTRY), { body: VECTOR }, { turnKind: "user", accessIntent: true })).ok).toBe(true);
  expect(h.stored).toHaveLength(1);
}

/**
 * `F3.86` PR 4, ruling Q3 — the second guard: an access entry dispatched in a
 * user turn whose own message did not ask is refused with the sentence, and
 * stores nothing; the same call with the intent stores one. Mutation: drop
 * the `accessIntent` check → the refusal reddens.
 */
export async function anAccessChangeNeedsTheUsersOwnAsk(): Promise<void> {
  const h = proposeHarness({ catalog: [ACCESS_ENTRY] });
  for (const accessIntent of [false, undefined]) {
    const refused = await h.tools.dispatch(proposeToolName(ACCESS_ENTRY), { body: VECTOR }, h.ctx({ accessIntent }));
    expect(refused, String(accessIntent)).toEqual({ ok: false, error: PROPOSE_ACCESS_NOT_ASKED_ERROR });
  }
  expect(h.stored).toEqual([]);
  expect((await h.tools.dispatch(proposeToolName(ACCESS_ENTRY), { body: VECTOR }, h.ctx({ accessIntent: true }))).ok).toBe(true);
  expect(h.stored).toHaveLength(1);
}

/** The second registry names no access tool; every other tool is in both (positive control). */
export function theRegistryWithoutAccessNamesNoAccessTool(): void {
  const h = proposeHarness();
  const all = h.tools.registry.definitions.map((d) => d.name);
  const without = h.tools.registryWithoutAccess.definitions.map((d) => d.name);
  const access = COPILOT_CATALOG.filter((entry) => entry.risk === "access").map(proposeToolName);
  expect(access).toEqual(expect.arrayContaining(["propose_user_create", "propose_userGrant_add", "propose_userGrant_remove"]));
  for (const name of access) {
    expect(all, name).toContain(name);
    expect(without, name).not.toContain(name);
    expect(h.tools.registryWithoutAccess.isToolName(name), name).toBe(false);
  }
  expect(without).toEqual(all.filter((name) => !access.includes(name)));
  expect(without).toContain("propose_dashboard_create");
}

const ORG = "55555555-5555-4555-8555-555555555555";
const NEW_USER = { email: "priya@example.test", displayName: "Priya Rao", role: "viewer", organizationId: ORG };

/**
 * `F3.86` ruling Q8 — in local sign-in a user-account entry is refused with
 * the route's own sentence and stores nothing; a grant (database-only) is
 * still proposed. Mutation: drop the mode check → the first reddens.
 */
export async function aUserAccountEntryIsRefusedInLocalMode(): Promise<void> {
  const create = catalogEntry("user.create") as CatalogEntry;
  const grant = catalogEntry("userGrant.add") as CatalogEntry;
  const local = proposeHarness({ catalog: [create, grant], env: { AUTH_MODE: "local", OIDC_ISSUER: "" } });
  const asked = local.ctx({ accessIntent: true });
  expect(await local.tools.dispatch(proposeToolName(create), { body: NEW_USER }, asked)).toEqual({ ok: false, error: LOCAL_MODE_READ_ONLY });
  expect(local.stored).toEqual([]);
  expect((await local.tools.dispatch(proposeToolName(grant), { id: ROW, body: { kind: "location", targetId: ROW } }, asked)).ok).toBe(true);
  expect(local.stored.map((change) => change.catalogId)).toEqual(["userGrant.add"]);
  // In OIDC the same create is stored (the positive control for the refusal).
  const oidc = proposeHarness({ catalog: [create] });
  expect((await oidc.tools.dispatch(proposeToolName(create), { body: NEW_USER }, oidc.ctx({ accessIntent: true }))).ok).toBe(true);
}

/** The copilot never proposes the global admin role; the stored create has no password and the clientOnly hash. */
export async function aUserCreateNeverProposesTheGlobalAdmin(): Promise<void> {
  const create = catalogEntry("user.create") as CatalogEntry;
  const h = proposeHarness({ catalog: [create] });
  const asked = h.ctx({ accessIntent: true });
  const admin = await h.tools.dispatch(proposeToolName(create), { body: { ...NEW_USER, role: "admin", organizationId: null } }, asked);
  expect(admin.ok).toBe(false);
  expect(admin.ok ? "" : admin.error).toMatch(/global admin role/);
  expect(h.stored).toEqual([]);
  expect((await h.tools.dispatch(proposeToolName(create), { body: NEW_USER }, asked)).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual(NEW_USER);
  expect(h.stored[0]?.bodyHash).toBe(bodyHash({ ...NEW_USER, temporaryPassword: "typed-on-the-card" }, ["temporaryPassword"]));
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
    /needs a modelBody/,
  );
}

/**
 * `F3.86` PR 2: a `clientOnly` key the model sends anyway is refused, and
 * nothing is stored — the strict model body is the gate (parsing with
 * `entry.body` instead would store the password). The turn's credential
 * guard refuses this key name first (`aCredentialInAProposeArgumentIsRefused`),
 * so this calls `dispatch` past the guards: the body rule must hold alone.
 */
export async function aClientOnlyKeyInAProposedBodyIsRefused(): Promise<void> {
  const h = proposeHarness({ catalog: [CLIENT_ONLY_ENTRY] });
  const refused = await h.tools.dispatch(
    proposeToolName(CLIENT_ONLY_ENTRY),
    { body: { userId: "u1", temporaryPassword: "x".repeat(12) } },
    h.ctx(),
  );
  expect(refused.ok).toBe(false);
  expect(refused.ok ? "" : refused.error).toMatch(/^Invalid body: /);
  expect(h.stored).toEqual([]);
  // The positive beside it: the same body without the key is stored.
  expect((await h.call(proposeToolName(CLIENT_ONLY_ENTRY), { body: { userId: "u1" } })).ok).toBe(true);
  expect(h.stored).toHaveLength(1);
}

/** A refined body cannot be narrowed by `.omit`, so its entry declares the `modelBody` the model proposes with. */
const REFINED_CLIENT_ONLY_ENTRY = fixtureEntry({
  id: "fixture.refined.password",
  body: z
    .object({ userId: z.string(), temporaryPassword: z.string().min(12) })
    .strict()
    .superRefine(() => undefined),
  modelBody: z.object({ userId: z.string() }).strict(),
  clientOnly: ["temporaryPassword"],
  steps: [{ id: "user", title: "User", fields: ["userId"] }],
});

/** `F3.86` PR 2: a refined body with a `modelBody` proposes without the `clientOnly` field. */
export async function aRefinedBodyProposesWithItsModelBody(): Promise<void> {
  const h = proposeHarness({ catalog: [REFINED_CLIENT_ONLY_ENTRY] });
  const definition = h.tools.registry.definitions.find((d) => d.name === proposeToolName(REFINED_CLIENT_ONLY_ENTRY));
  expect(JSON.stringify(definition)).toContain("userId");
  expect(JSON.stringify(definition)).not.toContain("temporaryPassword");
  expect((await h.call(proposeToolName(REFINED_CLIENT_ONLY_ENTRY), { body: { userId: "u1" } })).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual({ userId: "u1" });
  expect(h.stored[0]?.bodyHash).toBe(bodyHash({ userId: "u1", temporaryPassword: "typed-on-the-card" }, ["temporaryPassword"]));
  // `describe_change` reads the model's body too (code review #3): the field is never described.
  const described = await h.tools.dispatch(DESCRIBE_CHANGE_TOOL, { catalogId: REFINED_CLIENT_ONLY_ENTRY.id }, h.ctx());
  expect(described.ok).toBe(true);
  expect(JSON.stringify(described)).toContain("userId");
  expect(JSON.stringify(described)).not.toContain("temporaryPassword");
}

/** `F3.86` PR 2: an entry the server proposes itself has no propose tool; `describe_change` still knows it. */
export async function aServerProposedEntryHasNoProposeTool(): Promise<void> {
  const server = fixtureEntry({ id: "fixture.server", proposer: "server" });
  const h = proposeHarness({ catalog: [VECTOR_ENTRY, server] });
  const names = h.tools.registry.definitions.map((d) => d.name);
  expect(names).toContain(proposeToolName(VECTOR_ENTRY));
  expect(names).not.toContain(proposeToolName(server));
  expect((await h.call(proposeToolName(server), { body: VECTOR })).ok).toBe(false);
  expect(h.stored).toEqual([]);
  expect((await h.call(DESCRIBE_CHANGE_TOOL, { catalogId: server.id })).ok).toBe(true);
}

/**
 * `F3.86` PR 3c — no one tool definition carries a large body schema. A body
 * whose JSON Schema is at most {@link INLINE_BODY_SCHEMA_MAX_CHARS} is inlined
 * by design; a larger one becomes a field list read with `describe_change`.
 * The 1,000 above the constant is the wrapper, the params and the description
 * (the largest definition was 1,388 at PR 3c). The widget save alone is 45 KB
 * as JSON Schema, so an inlined large body fails here however few entries the
 * catalog has — the total budget below cannot say that.
 */
export function noToolDefinitionCarriesALargeBody(): void {
  const h = proposeHarness();
  const oversized = h.tools.registry.definitions
    .map((d) => ({ name: d.name, size: JSON.stringify(d).length }))
    .filter((d) => d.size > INLINE_BODY_SCHEMA_MAX_CHARS + 1_000);
  expect(oversized).toEqual([]);
}

/**
 * Every definition is sent on every turn. Release 1 (16 entries) was under
 * 20,000 characters; release 2 adds one tool per entry, and `fill_step` and
 * `describe_change` name every catalog id. Measured at PR 3c (33 entries):
 * 24,218, of which 20,851 without the access tools. The 16 entries of PRs 3a
 * and 3b bring the estimate to about 36,000 (about 9k tokens); the cap is that
 * plus headroom, not room to grow into.
 */
export function theToolDefinitionsStayInTheTurnBudget(): void {
  const h = proposeHarness();
  expect(JSON.stringify(h.tools.registry.definitions).length).toBeLessThan(40_000);
}

/** Every catalog entry has one propose tool; a large body is read on demand. */
export function everyEntryHasOneSlimProposeTool(): void {
  const h = proposeHarness();
  const names = h.tools.registry.definitions.map((d) => d.name);
  // `F3.86` PR 6: a server-made entry (the onboarding commit) has no propose tool.
  const modelEntries = COPILOT_CATALOG.filter((entry) => entry.proposer !== "server");
  expect(modelEntries.length).toBe(COPILOT_CATALOG.length - 1);
  expect(names).toEqual([...modelEntries.map(proposeToolName), FILL_STEP_TOOL, DESCRIBE_CHANGE_TOOL]);
  expect(names).not.toContain("propose_onboarding_commit");
  const widgets = h.tools.registry.definitions.find((d) => d.name === "propose_dashboard_widgets_replace");
  expect(JSON.stringify(widgets)).toContain("describe_change");
  // The guide names each widget type and the one path that reads it (a live follow-up hit the call cap without it).
  expect(JSON.stringify(widgets)).toContain("active_alarms_rail");
  expect(JSON.stringify(widgets)).toContain('read one with path [\\"widgets\\", \\"[]\\", \\"<member>\\"]');
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

/** `describe_change` refuses past its per-turn budget, so a model cannot spend the call cap on it; a new turn starts again. */
export async function describeChangeHasAPerTurnBudget(): Promise<void> {
  const h = proposeHarness();
  const turn = h.ctx();
  const results: CopilotToolResult[] = [];
  for (let i = 0; i < DESCRIBE_CHANGE_BUDGET + 1; i++) {
    results.push(await h.tools.dispatch(DESCRIBE_CHANGE_TOOL, { catalogId: "dashboard.widgets.replace" }, turn));
  }
  expect(results.slice(0, DESCRIBE_CHANGE_BUDGET).every((r) => r.ok)).toBe(true);
  expect(results.at(-1)).toEqual({ ok: false, error: DESCRIBE_BUDGET_ERROR });
  // The next turn (a new context) reads again.
  expect((await h.tools.dispatch(DESCRIBE_CHANGE_TOOL, { catalogId: "dashboard.widgets.replace" }, h.ctx())).ok).toBe(true);
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

/* ---------- F3.85 PR 11a — the asset-template entries (plan §11.3 Unit 2, ruling Q10) ---------- */

const KW = { pointKey: "kw", kind: "measured" };
const derived = (formula: string) => ({
  pointKey: "pf",
  kind: "derived",
  formula,
  formulaDialect: "bms-calc-v1",
  calcTrigger: "streaming",
});
const kpi = (pointKeys: string[], expression: string) => ({
  code: "k1",
  name: "KPI one",
  pointKeys,
  expression,
  dialect: "bms-calc-v1",
});
const templateTarget = (over: Partial<ResolvedTarget> = {}): ResolvedTarget => ({
  organizationId: ORG_X,
  organizationName: "Org X",
  targetName: "Pump template",
  pointKeys: ["kw"],
  currentContent: {},
  ...over,
});
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An invalid `points[0].formula` stores nothing (the shared body refuses it at its path); the valid one beside it stores. */
export async function anInvalidTemplatePointFormulaStoresNothing(): Promise<void> {
  const bad = proposeHarness({ target: templateTarget() });
  const refused = await bad.call("propose_assetTemplate_update", { id: ROW, body: { points: [derived("{kw} / {missing}"), KW] } });
  expect(refused.error).toMatch(/^Invalid body: .*points\.0\.formula/);
  expect(bad.stored).toEqual([]);
  const good = proposeHarness({ target: templateTarget() });
  expect((await good.call("propose_assetTemplate_update", { id: ROW, body: { points: [derived("{kw} * 2"), KW] } })).ok).toBe(true);
  expect(good.stored).toHaveLength(1);
}

/** An invalid `content.kpis[0].expression` stores nothing; the valid one beside it stores. */
export async function anInvalidTemplateKpiExpressionStoresNothing(): Promise<void> {
  const bad = proposeHarness({ target: templateTarget() });
  const refused = await bad.call("propose_assetTemplate_update", { id: ROW, body: { content: { kpis: [kpi(["kw"], "{kw} +")] } } });
  expect(refused.error).toMatch(/^Invalid body: .*content\.kpis\.0\.expression/);
  expect(bad.stored).toEqual([]);
  const good = proposeHarness({ target: templateTarget() });
  expect((await good.call("propose_assetTemplate_update", { id: ROW, body: { content: { kpis: [kpi(["kw"], "{kw}")] } } })).ok).toBe(true);
  expect(good.stored).toHaveLength(1);
}

/**
 * A KPI naming a point the template does not declare stores nothing: the one
 * check the body schema cannot make (the route's `assertContentRefsResolve`
 * answers 400 on Confirm). The names are the template's points now.
 */
export async function aKpiNamingAPointTheTemplateLacksStoresNothing(): Promise<void> {
  const body = { content: { kpis: [kpi(["ghost"], "{ghost}")] } };
  const bad = proposeHarness({ target: templateTarget({ pointKeys: ["kw"] }) });
  const refused = await bad.call("propose_assetTemplate_update", { id: ROW, body });
  expect(refused.error).toMatch(/^The formula in content\.kpis\.0\.expression is not valid/);
  expect(bad.stored).toEqual([]);
  const good = proposeHarness({ target: templateTarget({ pointKeys: ["kw", "ghost"] }) });
  expect((await good.call("propose_assetTemplate_update", { id: ROW, body })).ok).toBe(true);
  expect(good.stored).toHaveLength(1);
}

/** A body that replaces `points` names the points a KPI may reference, beyond the template's stored ones. */
export async function aKpiMayNameAPointTheBodyDeclares(): Promise<void> {
  const declared = proposeHarness({ target: templateTarget({ pointKeys: ["kw"] }) });
  const body = { points: [{ pointKey: "ghost", kind: "measured" }], content: { kpis: [kpi(["ghost"], "{ghost}")] } };
  expect((await declared.call("propose_assetTemplate_update", { id: ROW, body })).ok).toBe(true);
  expect(declared.stored).toHaveLength(1);
}

/** A body that replaces `points` drops the stored ones: a KPI naming only a stored point stores nothing. */
export async function aKpiMayNotNameAStoredPointTheBodyDrops(): Promise<void> {
  const stale = proposeHarness({ target: templateTarget({ pointKeys: ["ghost"] }) });
  const dropped = { points: [KW], content: { kpis: [kpi(["ghost"], "{ghost}")] } };
  expect((await stale.call("propose_assetTemplate_update", { id: ROW, body: dropped })).error).toMatch(
    /^The formula in content\.kpis\.0\.expression is not valid/,
  );
  expect(stale.stored).toEqual([]);
}

/** Ruling Q10: a KPI proposal stores the full merged body, and its hash is the merged body's. */
export async function aKpiProposalStoresTheMergedBody(): Promise<void> {
  const current = { contentVersion: 1, kpis: [kpi(["kw"], "{kw}")], maintenance: [] };
  const h = proposeHarness({ target: templateTarget({ currentContent: current }) });
  const next = kpi(["kw"], "{kw} * 2");
  expect((await h.call("propose_assetTemplate_update", { id: ROW, body: { content: { kpis: [next] } } })).ok).toBe(true);
  const merged = { content: { contentVersion: 1, kpis: [next], maintenance: [] } };
  expect(h.stored[0]?.body).toEqual(merged);
  expect(h.stored[0]?.bodyHash).toBe(bodyHash(merged));
  expect(h.stored[0]?.path).toBe(`/api/v1/admin/asset-templates/${ROW}`);
}

/** A body that does not touch `content` stores no content: the merge never adds a section. */
export async function aBodyWithoutContentStoresNoContent(): Promise<void> {
  const h = proposeHarness({ target: templateTarget({ currentContent: { kpis: [] } }) });
  expect((await h.call("propose_assetTemplate_update", { id: ROW, body: { name: "Pump v2" } })).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual({ name: "Pump v2" });
}

/** A stored prototype-pollution key is not carried into the merged body (the web merge drops it the same way). */
export async function aStoredUnsafeKeyIsNotCarried(): Promise<void> {
  const current = JSON.parse('{"constructor":{"x":1},"maintenance":[]}') as Record<string, unknown>;
  const h = proposeHarness({ target: templateTarget({ currentContent: current }) });
  expect((await h.call("propose_assetTemplate_update", { id: ROW, body: { content: { kpis: [] } } })).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual({ content: { maintenance: [], kpis: [] } });
}

/** Stored content the contract refuses (a reserved key) stores nothing: the card could never apply; clean content stores. */
export async function storedContentThatCannotBeWrittenBackStoresNothing(): Promise<void> {
  const bad = proposeHarness({ target: templateTarget({ currentContent: { optimisation: {} } }) });
  const refused = await bad.call("propose_assetTemplate_update", { id: ROW, body: { content: { kpis: [] } } });
  expect(refused.error).toMatch(new RegExp(`^${escapeRegExp(PROPOSE_STORED_CONTENT_ERROR)}`));
  expect(bad.stored).toEqual([]);
  const good = proposeHarness({ target: templateTarget({ currentContent: {} }) });
  expect((await good.call("propose_assetTemplate_update", { id: ROW, body: { content: { kpis: [] } } })).ok).toBe(true);
  expect(good.stored).toHaveLength(1);
}

/** Publishing a template is bodyless: `{}` on its own path. */
export async function aTemplatePublishStoresTheEmptyObject(): Promise<void> {
  const h = proposeHarness({ target: templateTarget() });
  expect((await h.call("propose_assetTemplate_publish", { id: ROW })).ok).toBe(true);
  expect(h.stored[0]).toMatchObject({
    body: {},
    bodyHash: EMPTY_SHA256,
    method: "POST",
    path: `/api/v1/admin/asset-templates/${ROW}/publish`,
  });
}

/**
 * `F3.86` PR 2, ruling Q1: a point-key change lives in the conversation's
 * bound organization. A cross-organization conversation is refused with the
 * ruling's sentence before the resolver is asked; a bound one passes the bound
 * organization to it. Mutation: drop the null check → the refusal reddens.
 */
export async function aFleetChangeNeedsABoundConversation(): Promise<void> {
  for (const target of [{ kind: "fleet" }, { kind: "pointKey", param: "id" }] as const) {
    const entry = fixtureEntry({
      id: `fixture.${target.kind}`,
      target,
      params: target.kind === "pointKey" ? { id: z.string().uuid() } : {},
    });
    const args = target.kind === "pointKey" ? { id: ROW, body: VECTOR } : { body: VECTOR };
    const h = proposeHarness({ catalog: [entry] });
    const refused = await h.call(proposeToolName(entry), args, { conversationOrganizationId: null, allowedOrganizationIds: [ORG_X, ORG_Y] });
    expect(refused.error, target.kind).toBe(PROPOSE_FLEET_UNBOUND_ERROR);
    expect(h.resolved, target.kind).toEqual([]);
    expect(h.stored, target.kind).toEqual([]);
    expect((await h.call(proposeToolName(entry), args)).ok, target.kind).toBe(true);
    expect(h.resolved[0]?.bound, target.kind).toBe(ORG_X);
  }
}

/**
 * `F3.86` PR 4, ruling Q3 (security review) — a tool result cannot pre-fill
 * an access wizard nor read its shape: `fill_step` and `describe_change` on
 * an access entry need the user's own ask, as the propose tool does; with
 * the ask, a fill still never names the global admin role. Mutation: drop
 * the `accessAsked` check in `fill_step` → the first reddens.
 */
export async function aFillOrDescribeOfAnAccessEntryNeedsTheUsersOwnAsk(): Promise<void> {
  const update = catalogEntry("user.update") as CatalogEntry;
  const grant = catalogEntry("userGrant.add") as CatalogEntry;
  const h = proposeHarness({ catalog: [update, grant] });
  const fill = { catalogId: "userGrant.add", stepId: "grant", values: { kind: "location", targetId: ROW } };
  for (const over of [{ accessIntent: false }, { accessIntent: true, turnKind: "follow_up" as const }]) {
    expect(await h.tools.dispatch(FILL_STEP_TOOL, fill, h.ctx(over)), JSON.stringify(over)).toEqual({
      ok: false,
      error: PROPOSE_ACCESS_NOT_ASKED_ERROR,
    });
    expect(await h.tools.dispatch(DESCRIBE_CHANGE_TOOL, { catalogId: "userGrant.add" }, h.ctx(over))).toEqual({
      ok: false,
      error: PROPOSE_ACCESS_NOT_ASKED_ERROR,
    });
  }
  const asked = h.ctx({ accessIntent: true });
  expect((await h.tools.dispatch(FILL_STEP_TOOL, fill, asked)).ok).toBe(true);
  expect((await h.tools.dispatch(DESCRIBE_CHANGE_TOOL, { catalogId: "userGrant.add" }, asked)).ok).toBe(true);
  const admin = await h.tools.dispatch(FILL_STEP_TOOL, { catalogId: "user.update", stepId: "role", values: { role: "admin" } }, asked);
  expect(admin.ok).toBe(false);
  expect((await h.tools.dispatch(FILL_STEP_TOOL, { catalogId: "user.update", stepId: "role", values: { role: "viewer" } }, asked)).ok).toBe(true);
}
