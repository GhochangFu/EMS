import { Inject, Injectable } from "@nestjs/common";
import { z, type ZodTypeAny } from "zod";

import { CALC_DIALECTS, type CalcDialect, formatCalcError, validateFormula } from "@bms/shared";
import {
  bodyFieldsOf,
  type CatalogEntry,
  catalogPath,
  COPILOT_CATALOG,
  formulaRefsOf,
  formulaSitesOf,
  modelBodyOf,
  proposeToolName,
  stepValuesSchema,
} from "@bms/shared/copilot";

import { resolveAuthMode } from "../auth/auth-mode";
import { LOCAL_MODE_READ_ONLY } from "../admin/users/users.service";
import { jsonSchemaOf, type ToolRegistry } from "../llm/tool-registry";
import { issuesOf } from "../llm/tool-result";
import { bodyHash } from "./body-hash";
import { COPILOT_NEVER_GLOBAL_ADMIN_MESSAGE } from "@bms/shared";

import { PROPOSE_ACCESS_NOT_ASKED_ERROR } from "./copilot-access-intent";
import { bodyDefinitionOf, describeBody } from "./copilot-change-schema";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import type { CopilotReadTools, CopilotToolContext, CopilotToolResult } from "./copilot-read-tools";
import { COPILOT_TARGETS, type CopilotTargets } from "./copilot-target-resolver";

export const FILL_STEP_TOOL = "fill_step";
export const DESCRIBE_CHANGE_TOOL = "describe_change";

/** The propose tool's refusals, each a sentence the model can act on. */
export const PROPOSE_OPEN_CHANGE_ERROR =
  "A proposed change in this conversation is still waiting. Ask the user to Confirm or Reject its card first.";
export const PROPOSE_TARGET_ERROR =
  "That record was not found among the organizations this conversation may change, or you may not change it.";
export const PROPOSE_ACCESS_ON_FOLLOW_UP_ERROR =
  "An access change can be proposed only when the user's own message asks for it, never after a confirmed change.";
export const UNKNOWN_CHANGE_ERROR = "There is no such change in the catalog.";
/** `F3.86` ruling Q1: a point-key change lives in the conversation's bound organization. */
export const PROPOSE_FLEET_UNBOUND_ERROR = "Pick an organization in the dock to change the point-key catalog.";
export const UNKNOWN_STEP_ERROR = "That wizard has no such step.";
export const UNKNOWN_PATH_ERROR = "That path is not in the body's shape.";
export const PROPOSE_STORED_CONTENT_ERROR =
  "The template's saved content cannot be written back as it is, so this change could never apply. Tell the user which part:";

/** The keys a merge never copies (`safeKeySchema` refuses them; the web merge drops them the same way). */
const UNSAFE_CONTENT_KEYS = ["__proto__", "constructor", "prototype"];

/**
 * `F3.85` PR 11a, ruling Q10 — the template content a PATCH will store: the
 * current content with each section the proposal names replaced. The route
 * replaces `content` wholesale, so a proposal of `{ kpis }` alone would
 * otherwise delete every other section. The server-side twin of the web's
 * `mergeTemplateContent` (`apps/web/src/lib/template-content-merge.ts`),
 * which `apps/api` cannot import: a filtered loop, not a spread, so a stored
 * own `__proto__` never reaches an assignment.
 */
export function mergeTemplateSections(
  current: Readonly<Record<string, unknown>>,
  sections: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const source of [current, sections]) {
    for (const key of Object.keys(source)) {
      if (!UNSAFE_CONTENT_KEYS.includes(key)) merged[key] = source[key];
    }
  }
  return merged;
}

const isCalcDialect = (value: unknown): value is CalcDialect => (CALC_DIALECTS as readonly unknown[]).includes(value);

/**
 * `describe_change` reads per turn. A live follow-up turn (2026-10-11) read
 * the widget shape again and again until the eight-call cap stopped it; past
 * this budget the tool refuses and says to propose.
 */
export const DESCRIBE_CHANGE_BUDGET = 3;
export const DESCRIBE_BUDGET_ERROR =
  "You have read enough of the shape this turn. Propose the change with what you read, or tell the user what is missing.";

/**
 * `F3.86` PR 4 — the propose tools, with a second registry that holds no
 * access entry: the turn sends it when the user's own message did not ask
 * for an access change (ruling Q3).
 *
 * `F3.87` PR 2 (ADR 0099 Amendment 3 A1): `registryFor` also drops every entry
 * whose `offeredTo` does not name the caller's role, so a `location_admin` is
 * never offered a layout tool. `registry` and `registryWithoutAccess` stay as
 * the two global-admin registries for their existing callers.
 */
export interface CopilotProposeTools extends CopilotReadTools {
  readonly registryWithoutAccess: ToolRegistry<string>;
  registryFor(options: { readonly access: boolean; readonly role: string }): ToolRegistry<string>;
}

/** `F3.87` PR 2: the second guard behind the role-filtered registry (Amendment 3 A1). */
export const PROPOSE_ROLE_ERROR = "This change is for an organization admin; ask one, or use the page.";

/** `F3.87` PR 2: the entry is offered to this role (no `offeredTo` offers it to every copilot role). */
const offeredToRole = (entry: CatalogEntry, role: string): boolean =>
  entry.offeredTo === undefined || (entry.offeredTo as readonly string[]).includes(role);

/**
 * `F3.86` PR 4, ruling Q3 (security review): any tool that names an access
 * entry — a propose tool, `fill_step`, `describe_change` — works only in a
 * user turn whose own message asked. A tool result can neither pre-fill an
 * access wizard nor read its shape.
 */
const accessAsked = (ctx: CopilotToolContext): boolean => ctx.turnKind === "user" && ctx.accessIntent === true;

/** `F3.86` ruling Q8: the user-account entries a local sign-in deployment refuses (grants are database-only and stay). */
const isUserAccountEntry = (entry: CatalogEntry): boolean => entry.id.startsWith("user.");

/** What the propose tools need; specs pass fakes with call counters. */
export interface CopilotProposeServices {
  readonly targets: CopilotTargets;
  readonly pending: Pick<CopilotPendingChangesService, "propose" | "hasOpen">;
}

/**
 * The body the model writes: the entry's `modelBody`, or its schema without
 * its `clientOnly` fields, which the user types on the Confirm card and the
 * model never sees. One rule for the API and the web since `F3.86` PR 2
 * (`modelBodyOf` in `@bms/shared/copilot`); this name stays for its callers.
 */
export function modelBodySchema(entry: CatalogEntry): ZodTypeAny {
  return modelBodyOf(entry);
}

function proposeArguments(entry: CatalogEntry): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = { ...entry.params };
  if (entry.bodyName !== null) shape.body = z.record(z.string(), z.unknown());
  return z.object(shape).strict();
}

function proposeDefinition(entry: CatalogEntry): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(entry.params)) properties[name] = jsonSchemaOf(schema as ZodTypeAny);
  const required = Object.keys(entry.params);
  if (entry.bodyName !== null) {
    const body = modelBodySchema(entry);
    properties.body = bodyDefinitionOf(body, entry.id, bodyFieldsOf(body));
    required.push("body");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function proposeDescription(entry: CatalogEntry): string {
  return (
    `Propose: ${entry.title} (${entry.method} ${entry.path}; ${entry.risk}). ` +
    "This changes nothing: it shows the user a card, and only the user's Confirm applies it."
  );
}

/**
 * `F3.85` PR 8 / ADR 0099 decisions 2, 3, 4, 6 (plan §10.2) — the propose
 * tools, one per catalog entry, plus `fill_step` and `describe_change`.
 *
 * **A propose tool never writes the change.** It checks the body against the
 * entry's own schema (the controller's export) and any formula, refuses while
 * the conversation has a change in flight, resolves the target's organization
 * inside the turn's allowed set (`CopilotTargets`), and stores one `pending`
 * row: the method, the encoded path, the body the browser will send and its
 * canonical hash. Only the user's Confirm, through the `X-Copilot-Change`
 * interceptor, sends the request.
 *
 * The definitions the model reads are slim (`copilot-change-schema.ts`): a
 * large body is a field list and `describe_change` reads its shape on demand.
 * So the registry parses the body loosely (an object) and the dispatch parses
 * it with `entry.body`, whose issues go back to the model.
 *
 * The argument guards (the withheld-value marker, the credential walk) run in
 * the turn service on every tool, these included.
 */
export function createCopilotProposeTools(
  services: CopilotProposeServices,
  catalog: readonly CatalogEntry[] = COPILOT_CATALOG,
  env: Readonly<Record<string, string | undefined>> = process.env,
): CopilotProposeTools {
  // `F3.86` PR 2: an entry the server proposes itself (the onboarding commit) has no propose tool.
  const byTool = new Map(catalog.filter((entry) => entry.proposer !== "server").map((entry) => [proposeToolName(entry), entry]));
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const ids = catalog.map((entry) => entry.id) as [string, ...string[]];

  const schemas: Record<string, ZodTypeAny> = {};
  const definitions: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
  for (const entry of byTool.values()) {
    const name = proposeToolName(entry);
    schemas[name] = proposeArguments(entry);
    definitions.push({ name, description: proposeDescription(entry), parameters: proposeDefinition(entry) });
  }
  const catalogIdSchema = z.enum(ids);
  schemas[FILL_STEP_TOOL] = z
    .object({ catalogId: catalogIdSchema, stepId: z.string().min(1).max(64), values: z.record(z.string(), z.unknown()) })
    .strict();
  definitions.push({
    name: FILL_STEP_TOOL,
    description:
      "Fill one step of the wizard the user has open for a catalog change, with values for that step's fields. " +
      "It saves nothing and sends nothing: the user reviews the wizard.",
    parameters: jsonSchemaOf(schemas[FILL_STEP_TOOL]),
  });
  schemas[DESCRIBE_CHANGE_TOOL] = z
    .object({ catalogId: catalogIdSchema, path: z.array(z.string().max(64)).max(8).optional() })
    .strict();
  definitions.push({
    name: DESCRIBE_CHANGE_TOOL,
    description:
      "Read the JSON Schema of a catalog change's body, or of the part at `path` (property names, \"[]\" for an " +
      "array's items, a union member's tag such as a widget type). A large part comes back as an outline.",
    parameters: jsonSchemaOf(schemas[DESCRIBE_CHANGE_TOOL]),
  });

  // One count per turn: the turn service builds a new context for each turn.
  const describeReads = new WeakMap<CopilotToolContext, number>();

  /** The registry without the tools `dropped` names: a dropped tool is not even named to the model. */
  const registryWithout = (dropped: ReadonlySet<string>): ToolRegistry<string> => {
    const kept: Record<string, ZodTypeAny> = {};
    for (const [name, schema] of Object.entries(schemas)) if (!dropped.has(name)) kept[name] = schema;
    return {
      definitions: definitions.filter((definition) => !dropped.has(definition.name)),
      schemas: kept,
      isToolName: (name: string): name is string => Object.prototype.hasOwnProperty.call(kept, name),
    };
  };
  // Ruling Q3: the access entries are dropped unless the user's own message asked. `F3.87` PR 2: an
  // entry whose `offeredTo` does not name the caller's role is dropped too. One registry per pair.
  const accessTools = [...byTool].filter(([, entry]) => entry.risk === "access").map(([name]) => name);
  const registries = new Map<string, ToolRegistry<string>>();
  const registryFor = ({ access, role }: { readonly access: boolean; readonly role: string }): ToolRegistry<string> => {
    const key = `${access ? "access" : "no-access"}:${role}`;
    const known = registries.get(key);
    if (known !== undefined) return known;
    const dropped = new Set([
      ...(access ? [] : accessTools),
      ...[...byTool].filter(([, entry]) => !offeredToRole(entry, role)).map(([name]) => name),
    ]);
    const made = registryWithout(dropped);
    registries.set(key, made);
    return made;
  };
  const registry = registryFor({ access: true, role: "admin" });
  const registryWithoutAccess = registryFor({ access: false, role: "admin" });

  const propose = async (
    entry: CatalogEntry,
    args: Record<string, unknown>,
    ctx: CopilotToolContext,
  ): Promise<CopilotToolResult> => {
    // Decision 4.7: a follow-up turn may propose the next write, never an access change.
    if (entry.risk === "access" && ctx.turnKind === "follow_up") return { ok: false, error: PROPOSE_ACCESS_ON_FOLLOW_UP_ERROR };
    // Ruling Q3: only when the user's own message asked (the turn also withholds the tool; this is the second guard).
    if (entry.risk === "access" && !accessAsked(ctx)) return { ok: false, error: PROPOSE_ACCESS_NOT_ASKED_ERROR };
    // `F3.87` PR 2 (Amendment 3 A1): the registry withholds the tool from another role; this is the second guard.
    if (!offeredToRole(entry, ctx.identity.role)) return { ok: false, error: PROPOSE_ROLE_ERROR };
    // Ruling Q8: in local sign-in every user-account write answers 409, so no card is offered for one.
    if (isUserAccountEntry(entry) && resolveAuthMode(env) === "local") return { ok: false, error: LOCAL_MODE_READ_ONLY };
    const params: Record<string, string> = {};
    for (const name of Object.keys(entry.params)) params[name] = args[name] as string;
    const raw = entry.bodyName === null ? {} : (args.body as Record<string, unknown>);
    const parsed = modelBodySchema(entry).safeParse(raw);
    if (!parsed.success) return { ok: false, error: `Invalid body: ${issuesOf(parsed.error)}` };
    // The JSON image is what is stored, hashed and sent: one object on all three sides. It is the
    // raw body, not `parsed.data` (a transform or default would change what the route parses); it
    // never holds a `clientOnly` key, because the strict model body refused one above (`F3.86` PR 2).
    let body = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

    if (await services.pending.hasOpen(ctx.identity.id, ctx.conversationId)) {
      return { ok: false, error: PROPOSE_OPEN_CHANGE_ERROR };
    }
    const fleetRow = entry.target.kind === "fleet" || entry.target.kind === "pointKey";
    if (fleetRow && ctx.conversationOrganizationId === null) return { ok: false, error: PROPOSE_FLEET_UNBOUND_ERROR };
    const target = await services.targets.resolve(
      entry,
      params,
      body,
      ctx.allowedOrganizationIds,
      ctx.user,
      ctx.conversationOrganizationId,
    );
    if (
      target === null ||
      !ctx.allowedOrganizationIds.includes(target.organizationId) ||
      (ctx.conversationOrganizationId !== null && target.organizationId !== ctx.conversationOrganizationId)
    ) {
      return { ok: false, error: PROPOSE_TARGET_ERROR };
    }
    // Ruling Q10: the card shows, and Confirm sends, the whole content the PATCH stores.
    const content = body.content;
    if (target.currentContent !== undefined && typeof content === "object" && content !== null && !Array.isArray(content)) {
      body = { ...body, content: mergeTemplateSections(target.currentContent, content as Record<string, unknown>) };
      const merged = modelBodySchema(entry).safeParse(body);
      if (!merged.success) return { ok: false, error: `${PROPOSE_STORED_CONTENT_ERROR} ${issuesOf(merged.error)}` };
    }
    for (const formula of entry.formulas) {
      const refs = formulaRefsOf(body, formula) ?? target.pointKeys ?? [];
      for (const site of formulaSitesOf(body, formula)) {
        // A null dialect inherits the template point's, and a KPI's "unvalidated" is not parsed;
        // the route's own check decides both on Confirm.
        if (typeof site.expression !== "string" || !isCalcDialect(site.dialect)) continue;
        const result = validateFormula(site.expression, refs, { dialect: site.dialect });
        if (!result.ok) {
          const first = result.errors[0];
          return { ok: false, error: `The formula in ${site.path} is not valid: ${first ? formatCalcError(first) : "unknown error"}` };
        }
      }
    }

    const summary = entry.summary({
      body,
      params,
      targetName: target.targetName,
      organizationName: target.organizationName,
      ...(target.currentWidgetIds ? { currentWidgetIds: target.currentWidgetIds } : {}),
      ...(target.refName !== undefined ? { refName: target.refName } : {}),
    });
    const change = await services.pending.propose(ctx.identity.id, {
      conversationId: ctx.conversationId,
      organizationId: target.organizationId,
      catalogId: entry.id,
      method: entry.method,
      path: catalogPath(entry, params),
      body,
      // `F3.87` PR 2: the interceptor's own exclusion (`hashExcludedKeysFor`), for this entry.
      bodyHash: bodyHash(body, [...entry.clientOnly, ...(entry.cardOnly ?? [])]),
      summary,
      risk: entry.risk,
    });
    // Another turn stored a change between the check above and this insert.
    if (change === null) return { ok: false, error: PROPOSE_OPEN_CHANGE_ERROR };
    return {
      ok: true,
      result: { changeId: change.id, summary, status: "waiting for the user's Confirm" },
      organizationIds: [target.organizationId],
      pendingChange: change,
    };
  };

  return {
    registry,
    registryWithoutAccess,
    registryFor,
    dispatch: async (name, args, ctx): Promise<CopilotToolResult> => {
      const entry = byTool.get(name);
      if (entry !== undefined) return propose(entry, args, ctx);
      if (name === FILL_STEP_TOOL) {
        const target = byId.get(args.catalogId as string);
        if (target === undefined) return { ok: false, error: UNKNOWN_CHANGE_ERROR };
        if (target.risk === "access" && !accessAsked(ctx)) return { ok: false, error: PROPOSE_ACCESS_NOT_ASKED_ERROR };
        if (!offeredToRole(target, ctx.identity.role)) return { ok: false, error: PROPOSE_ROLE_ERROR };
        const step = target.steps.find((candidate) => candidate.id === args.stepId);
        if (step === undefined) return { ok: false, error: UNKNOWN_STEP_ERROR };
        const values = stepValuesSchema(target.body, step.fields).safeParse(args.values);
        if (!values.success) return { ok: false, error: `Invalid values: ${issuesOf(values.error)}` };
        // The step check reads field shapes only; the model body's rule that the copilot never names
        // the global admin role (decision 3) is a refinement, so it is held here on the server too.
        if (target.risk === "access" && (args.values as Record<string, unknown>).role === "admin") {
          return { ok: false, error: `Invalid values: role: ${COPILOT_NEVER_GLOBAL_ADMIN_MESSAGE}` };
        }
        return {
          ok: true,
          result: { filled: step.id },
          organizationIds: [],
          fillStep: { catalogId: target.id, stepId: step.id, values: args.values as Record<string, unknown> },
        };
      }
      if (name === DESCRIBE_CHANGE_TOOL) {
        const reads = (describeReads.get(ctx) ?? 0) + 1;
        describeReads.set(ctx, reads);
        if (reads > DESCRIBE_CHANGE_BUDGET) return { ok: false, error: DESCRIBE_BUDGET_ERROR };
        const target = byId.get(args.catalogId as string);
        if (target === undefined) return { ok: false, error: UNKNOWN_CHANGE_ERROR };
        if (target.risk === "access" && !accessAsked(ctx)) return { ok: false, error: PROPOSE_ACCESS_NOT_ASKED_ERROR };
        if (!offeredToRole(target, ctx.identity.role)) return { ok: false, error: PROPOSE_ROLE_ERROR };
        // The model's body (`F3.86` PR 2): a `clientOnly` field is never described to the model.
        const described = describeBody(modelBodySchema(target), (args.path as string[] | undefined) ?? []);
        if (!described.ok) return { ok: false, error: UNKNOWN_PATH_ERROR };
        return {
          ok: true,
          result: {
            catalogId: target.id,
            title: target.title,
            steps: target.steps.map((step) => ({ id: step.id, title: step.title, fields: step.fields })),
            schema: described.schema,
            outline: described.outline,
          },
          organizationIds: [],
        };
      }
      return { ok: false, error: "No such tool." };
    },
  };
}

/** The Nest token the turn service injects its propose tools by. */
export const COPILOT_PROPOSE_TOOLS = Symbol("COPILOT_PROPOSE_TOOLS");

/** `F3.85` PR 8 — the propose tools as the Nest provider behind `COPILOT_PROPOSE_TOOLS`. */
@Injectable()
export class CopilotProposeToolSet implements CopilotProposeTools {
  private readonly tools: CopilotProposeTools;

  constructor(
    @Inject(COPILOT_TARGETS) targets: CopilotTargets,
    @Inject(CopilotPendingChangesService) pending: CopilotPendingChangesService,
  ) {
    this.tools = createCopilotProposeTools({ targets, pending });
  }

  get registry(): ToolRegistry<string> {
    return this.tools.registry;
  }

  get registryWithoutAccess(): ToolRegistry<string> {
    return this.tools.registryWithoutAccess;
  }

  registryFor(options: { readonly access: boolean; readonly role: string }): ToolRegistry<string> {
    return this.tools.registryFor(options);
  }

  dispatch(name: string, args: Record<string, unknown>, ctx: CopilotToolContext): Promise<CopilotToolResult> {
    return this.tools.dispatch(name, args, ctx);
  }
}
