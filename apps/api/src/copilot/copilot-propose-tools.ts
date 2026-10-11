import { Inject, Injectable } from "@nestjs/common";
import { z, type ZodTypeAny } from "zod";

import { type CalcDialect, formatCalcError, validateFormula } from "@bms/shared";
import {
  bodyFieldsOf,
  type CatalogEntry,
  catalogPath,
  COPILOT_CATALOG,
  proposeToolName,
  stepValuesSchema,
} from "@bms/shared/copilot";

import { jsonSchemaOf, type ToolRegistry } from "../llm/tool-registry";
import { issuesOf } from "../llm/tool-result";
import { bodyHash } from "./body-hash";
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
export const UNKNOWN_STEP_ERROR = "That wizard has no such step.";
export const UNKNOWN_PATH_ERROR = "That path is not in the body's shape.";

/**
 * `describe_change` reads per turn. A live follow-up turn (2026-10-11) read
 * the widget shape again and again until the eight-call cap stopped it; past
 * this budget the tool refuses and says to propose.
 */
export const DESCRIBE_CHANGE_BUDGET = 3;
export const DESCRIBE_BUDGET_ERROR =
  "You have read enough of the shape this turn. Propose the change with what you read, or tell the user what is missing.";

/** What the propose tools need; specs pass fakes with call counters. */
export interface CopilotProposeServices {
  readonly targets: CopilotTargets;
  readonly pending: Pick<CopilotPendingChangesService, "propose" | "hasOpen">;
}

/**
 * The body the model writes: the entry's schema without its `clientOnly`
 * fields, which the user types on the Confirm card and the model never sees.
 * An entry with `clientOnly` fields must have a plain object body (none does
 * in release 1); anything else is a load error.
 */
export function modelBodySchema(entry: CatalogEntry): ZodTypeAny {
  if (entry.clientOnly.length === 0) return entry.body;
  if (!(entry.body instanceof z.ZodObject)) {
    throw new Error(`F3.85: ${entry.id} has clientOnly fields, so its body must be a plain object`);
  }
  const mask = Object.fromEntries(entry.clientOnly.map((field) => [field, true as const]));
  return entry.body.omit(mask);
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
): CopilotReadTools {
  const byTool = new Map(catalog.map((entry) => [proposeToolName(entry), entry]));
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const ids = catalog.map((entry) => entry.id) as [string, ...string[]];

  const schemas: Record<string, ZodTypeAny> = {};
  const definitions: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
  for (const entry of catalog) {
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

  const registry: ToolRegistry<string> = {
    definitions,
    schemas,
    isToolName: (name: string): name is string => Object.prototype.hasOwnProperty.call(schemas, name),
  };

  const propose = async (
    entry: CatalogEntry,
    args: Record<string, unknown>,
    ctx: CopilotToolContext,
  ): Promise<CopilotToolResult> => {
    // Decision 4.7: a follow-up turn may propose the next write, never an access change.
    if (entry.risk === "access" && ctx.turnKind === "follow_up") return { ok: false, error: PROPOSE_ACCESS_ON_FOLLOW_UP_ERROR };
    const params: Record<string, string> = {};
    for (const name of Object.keys(entry.params)) params[name] = args[name] as string;
    const raw = entry.bodyName === null ? {} : (args.body as Record<string, unknown>);
    const parsed = modelBodySchema(entry).safeParse(raw);
    if (!parsed.success) return { ok: false, error: `Invalid body: ${issuesOf(parsed.error)}` };
    // The JSON image is what is stored, hashed and sent: one object on all three sides.
    const body = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

    if (await services.pending.hasOpen(ctx.identity.id, ctx.conversationId)) {
      return { ok: false, error: PROPOSE_OPEN_CHANGE_ERROR };
    }
    const target = await services.targets.resolve(entry, params, body, ctx.allowedOrganizationIds, ctx.user);
    if (
      target === null ||
      !ctx.allowedOrganizationIds.includes(target.organizationId) ||
      (ctx.conversationOrganizationId !== null && target.organizationId !== ctx.conversationOrganizationId)
    ) {
      return { ok: false, error: PROPOSE_TARGET_ERROR };
    }
    for (const formula of entry.formulas) {
      const expression = body[formula.field];
      const dialect = body[formula.dialectField];
      // A null dialect inherits the template point's; the route's merged check decides that case on Confirm.
      if (typeof expression !== "string" || typeof dialect !== "string") continue;
      const result = validateFormula(expression, target.pointKeys ?? [], { dialect: dialect as CalcDialect });
      if (!result.ok) {
        const first = result.errors[0];
        return { ok: false, error: `The formula in ${formula.field} is not valid: ${first ? formatCalcError(first) : "unknown error"}` };
      }
    }

    const summary = entry.summary({
      body,
      params,
      targetName: target.targetName,
      organizationName: target.organizationName,
      ...(target.currentWidgetIds ? { currentWidgetIds: target.currentWidgetIds } : {}),
    });
    const change = await services.pending.propose(ctx.identity.id, {
      conversationId: ctx.conversationId,
      organizationId: target.organizationId,
      catalogId: entry.id,
      method: entry.method,
      path: catalogPath(entry, params),
      body,
      bodyHash: bodyHash(body, entry.clientOnly),
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
    dispatch: async (name, args, ctx): Promise<CopilotToolResult> => {
      const entry = byTool.get(name);
      if (entry !== undefined) return propose(entry, args, ctx);
      if (name === FILL_STEP_TOOL) {
        const target = byId.get(args.catalogId as string);
        if (target === undefined) return { ok: false, error: UNKNOWN_CHANGE_ERROR };
        const step = target.steps.find((candidate) => candidate.id === args.stepId);
        if (step === undefined) return { ok: false, error: UNKNOWN_STEP_ERROR };
        const values = stepValuesSchema(target.body, step.fields).safeParse(args.values);
        if (!values.success) return { ok: false, error: `Invalid values: ${issuesOf(values.error)}` };
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
        const described = describeBody(target.body, (args.path as string[] | undefined) ?? []);
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
export class CopilotProposeToolSet implements CopilotReadTools {
  private readonly tools: CopilotReadTools;

  constructor(
    @Inject(COPILOT_TARGETS) targets: CopilotTargets,
    @Inject(CopilotPendingChangesService) pending: CopilotPendingChangesService,
  ) {
    this.tools = createCopilotProposeTools({ targets, pending });
  }

  get registry(): ToolRegistry<string> {
    return this.tools.registry;
  }

  dispatch(name: string, args: Record<string, unknown>, ctx: CopilotToolContext): Promise<CopilotToolResult> {
    return this.tools.dispatch(name, args, ctx);
  }
}
