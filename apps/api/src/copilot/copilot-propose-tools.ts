import { BadRequestException, HttpException, Inject, Injectable } from "@nestjs/common";
import { z, type ZodTypeAny } from "zod";

import { CALC_DIALECTS, type CalcDialect, formatCalcError, validateFormula } from "@bms/shared";
import {
  bodyFieldsOf,
  type CatalogEntry,
  catalogPath,
  COPILOT_CATALOG,
  formulaRefsOf,
  formulaSitesOf,
  hashExcludedKeysOf,
  modelBodyOf,
  proposeToolName,
  stepValuesSchema,
} from "@bms/shared/copilot";

import { resolveAuthMode } from "../auth/auth-mode";
import { LOCAL_MODE_READ_ONLY } from "../admin/users/users.service";
import { MimicLayoutsService, UNKNOWN_ROLE_MESSAGE } from "../mimic-layouts/mimic-layouts.service";
import { jsonSchemaOf, type ToolRegistry } from "../llm/tool-registry";
import { issuesOf } from "../llm/tool-result";
import { bodyHash } from "./body-hash";
import { COPILOT_NEVER_GLOBAL_ADMIN_MESSAGE } from "@bms/shared";

import { PROPOSE_ACCESS_NOT_ASKED_ERROR } from "./copilot-access-intent";
import { ASSET_CREATE_IDS, PROPOSE_ASSET_NOT_ASKED_ERROR } from "./copilot-asset-intent";
import { bodyDefinitionOf, describeBody } from "./copilot-change-schema";
import {
  type CopilotOpenWizardRecord,
  fillRecordRefusal,
  openWizardRecords,
  pageWizardRecords,
} from "./copilot-open-wizards";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import type { CopilotReadTools, CopilotToolContext, CopilotToolResult, RegistryOptions } from "./copilot-read-tools";
import type { CopilotOpenWizard } from "@bms/shared";
import { prepareUpload } from "./copilot-upload-prepare";
import { checkRule, type CopilotRuleChecks, RULE_ENTRY_IDS } from "./copilot-propose-rules";
import { checkNotification, type CopilotNotificationChecks, NOTIFICATION_ENTRY_IDS } from "./copilot-propose-notifications";
import { NotificationProposalCheckService } from "../notifications/notification-proposal-check.service";
import { checkReport, type CopilotReportChecks, REPORT_ENTRY_IDS, reportEmailRefusal } from "./copilot-propose-reports";
import { ReportProposalCheckService } from "../reports/report-proposal-check.service";
import { checkFile, type CopilotFileChecks, FILE_ENTRY_IDS } from "./copilot-propose-files";
import { TelemetryProposalCheckService } from "../admin/telemetry-entry/telemetry-proposal-check.service";
import { AssetImagesWriteService } from "../assets/asset-images-write.service";
import {
  OUTWARD_ENTRY_IDS,
  PROPOSE_OUTWARD_NOT_ASKED_ERROR,
  PROPOSE_OUTWARD_ON_FOLLOW_UP_ERROR,
} from "./copilot-outward-intent";
import { RuleProposalCheckService } from "../rules/rule-proposal-check.service";
import { COPILOT_TARGETS, type CopilotTargets } from "./copilot-target-resolver";
import { PROPOSE_TARGET_ERROR, templateLifecycleRefusal } from "./copilot-template-lifecycle";

export const FILL_STEP_TOOL = "fill_step";
export const DESCRIBE_CHANGE_TOOL = "describe_change";

/** The propose tool's refusals, each a sentence the model can act on. */
export const PROPOSE_OPEN_CHANGE_ERROR =
  "A proposed change in this conversation is still waiting. Ask the user to Confirm or Reject its card first.";
/** `F4.246`: declared beside the lifecycle mirror that fails closed with it; re-exported so its importers do not move. */
export { PROPOSE_TARGET_ERROR } from "./copilot-template-lifecycle";
export const PROPOSE_ACCESS_ON_FOLLOW_UP_ERROR =
  "An access change can be proposed only when the user's own message asks for it, never after a confirmed change.";
export const UNKNOWN_CHANGE_ERROR = "There is no such change in the catalog.";
/** `F3.86` ruling Q1: a point-key change lives in the conversation's bound organization. */
export const PROPOSE_FLEET_UNBOUND_ERROR = "Pick an organization in the dock to change the point-key catalog.";
export const UNKNOWN_STEP_ERROR = "That wizard has no such step.";
export const UNKNOWN_PATH_ERROR = "That path is not in the body's shape.";
/** `F4.247` (ADR 0099 Amendment 5 C1): a flagged entry whose target read no `updatedAt` stores nothing (fail closed). */
export const PROPOSE_PRECONDITION_ERROR = "This change cannot be proposed now; ask the user to use the page.";
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
  registryFor(options: RegistryOptions): ToolRegistry<string>;
  /**
   * `F4.245` (ADR 0099 Amendment 4): the open wizards whose records are in the
   * turn's scope, each with its name, through the propose target resolver.
   */
  openWizardRecords(wizards: readonly CopilotOpenWizard[], ctx: CopilotToolContext): Promise<CopilotOpenWizardRecord[]>;
  /** `F4.245`: the wizards the page an `open_page` route opens mounts, in scope. */
  pageWizardRecords(route: string, ctx: CopilotToolContext): Promise<CopilotOpenWizardRecord[]>;
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

/**
 * `F3.87` PR 7, plan D11: a layout card proposed from a file says so, so the
 * administrator checks the drawing against the original before Confirm.
 */
export const COPILOT_READ_FROM_FILE_NOTE = " (read from an attached file: check it against the drawing)";

/** `F3.86` ruling Q8: the user-account entries a local sign-in deployment refuses (grants are database-only and stay). */
const isUserAccountEntry = (entry: CatalogEntry): boolean => entry.id.startsWith("user.");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The top-level parent of each dotted `clientOnly` path (`config.url` → `config`). */
export const nestedClientOnlyParents = (clientOnly: readonly string[]): string[] => [
  ...new Set(clientOnly.filter((path) => path.includes(".")).map((path) => path.split(".")[0] as string)),
];

/**
 * `F4.279` review: a `fill_step` value is checked against the copilot's model body where that
 * body narrows the field (Q6, Q12: a channel's `config` holds `to` only, never a URL), and against
 * the route body for a field the model body does not name.
 */
function fillValuesSchema(entry: CatalogEntry, fields: readonly string[]): ZodTypeAny {
  if (entry.modelBody === undefined) return stepValuesSchema(entry.body, fields);
  const modelFields = new Set(bodyFieldsOf(entry.modelBody));
  const narrowed = fields.filter((field) => modelFields.has(field));
  const rest = fields.filter((field) => !modelFields.has(field));
  return stepValuesSchema(entry.modelBody, narrowed).merge(stepValuesSchema(entry.body, rest)).strict();
}

/**
 * The propose tool the admin form of the role refusal names. `F3.87` PR 6 made
 * `assetRole.create` an entry with `offeredTo: ["admin"]`, so the global
 * admin's registry has it and gets the admin form; a registry without it (a
 * spec's catalog) still gets the sentence form.
 */
const ROLE_CREATE_TOOL = proposeToolName({ id: "assetRole.create" });

/**
 * `F3.87` PR 5 / owner ruling Q4 — a layout whose units name a role the
 * vocabulary lacks. A global admin is told to propose the role first (its
 * registry names `assetRole.create`); any other role is told to say so in a
 * sentence and to draw without it. `F4.282`: a missing code may be retired, and
 * a create of a retired code fails at Confirm, so the admin is told to try
 * `assetRole.reactivate` first. The codes are the model's own words echoed
 * back to it, never tenant text.
 */
export function PROPOSE_LAYOUT_ROLES_MISSING_ADMIN(codes: readonly string[]): string {
  return (
    `The unit role codes ${codes.join(", ")} are not active in the vocabulary: each one is absent or retired. For each ` +
    "one, propose assetRole.reactivate first, and assetRole.create only if the reactivate is refused (a retired code " +
    "cannot be created again) — one card per turn — and propose the layout again after they are applied."
  );
}

export function PROPOSE_LAYOUT_ROLES_MISSING(codes: readonly string[]): string {
  return (
    `The unit role codes ${codes.join(", ")} are not in the vocabulary. Tell the user in one sentence which role is ` +
    "missing and that a global administrator can add it; choose an existing role (list_asset_roles) or leave the " +
    "unit's role empty, then propose the layout again."
  );
}

/** `F3.87` PR 5: a tool set built without the layouts service (a spec's fakes) never stores a layout card. */
export const PROPOSE_LAYOUT_UNAVAILABLE_ERROR = "A layout cannot be proposed here. Tell the user to use the layout editor page.";

/** `F3.87` PR 5: the entries whose proposal runs the layout checks (Amendment 3 A2). */
const LAYOUT_ENTRY_IDS: ReadonlySet<string> = new Set(["mimicLayout.create", "mimicLayout.replace"]);

/** The distinct role codes a layout body's nodes name. */
function roleCodesOf(nodes: ReadonlyArray<{ readonly roleCode?: string | null }>): string[] {
  return [...new Set(nodes.flatMap((node) => (node.roleCode == null ? [] : [node.roleCode])))];
}

/** What the propose tools need; specs pass fakes with call counters. */
export interface CopilotProposeServices {
  readonly targets: CopilotTargets;
  readonly pending: Pick<CopilotPendingChangesService, "propose" | "hasOpen">;
  /**
   * `F3.87` PR 5 (Amendment 3 A2, owner rulings Q4 and Q5): the layout checks
   * a proposal runs read-only before its card is stored. Optional, so every
   * spec that builds the tools for another entry passes no fake; a layout
   * proposal without it is refused ({@link PROPOSE_LAYOUT_UNAVAILABLE_ERROR}).
   */
  readonly layouts?: Pick<MimicLayoutsService, "validateProposal" | "missingRoleCodes">;
  /**
   * `F4.278` (Amendment 8, Q9): the rule check a rule proposal runs before its
   * card is stored. Optional for the same reason as `layouts`; a rule proposal
   * without it is refused (`PROPOSE_RULES_UNAVAILABLE_ERROR`).
   */
  readonly rules?: CopilotRuleChecks;
  /**
   * `F4.279` (Amendment 8 D2, D5): the notification check a notification
   * proposal runs before its card is stored. Optional for the same reason; a
   * notification proposal without it is refused (`PROPOSE_NOTIFICATIONS_UNAVAILABLE_ERROR`).
   */
  readonly notifications?: CopilotNotificationChecks;
  /** `F4.280` (Amendment 8 D2, D4, D5): the report check; optional for the same reason (`PROPOSE_REPORTS_UNAVAILABLE_ERROR`). */
  readonly reports?: CopilotReportChecks;
  /** `F4.283` (Amendment 8 Q18–Q21): the telemetry and image checks; optional for the same reason (`PROPOSE_FILES_UNAVAILABLE_ERROR`). */
  readonly files?: CopilotFileChecks;
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

/** `F4.282` (D3): whether the model sends a body — never for a bodyless route or a `fixedBody` entry. */
function takesBody(entry: CatalogEntry): boolean {
  return entry.bodyName !== null && entry.fixedBody === undefined;
}

function proposeArguments(entry: CatalogEntry): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = { ...entry.params };
  if (takesBody(entry)) shape.body = z.record(z.string(), z.unknown());
  return z.object(shape).strict();
}

function proposeDefinition(entry: CatalogEntry): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(entry.params)) properties[name] = jsonSchemaOf(schema as ZodTypeAny);
  const required = Object.keys(entry.params);
  if (takesBody(entry)) {
    const body = modelBodySchema(entry);
    properties.body = bodyDefinitionOf(body, entry.id, bodyFieldsOf(body), entry.bodyGuide);
    required.push("body");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function proposeDescription(entry: CatalogEntry): string {
  return (
    `Propose: ${entry.title} (${entry.method} ${entry.path}; ${entry.risk}). ` +
    "This changes nothing: it shows the user a card, and only the user's Confirm applies it." +
    (entry.fixedBody !== undefined ? " The body is fixed: send only the path parameter(s)." : "")
  );
}

/**
 * `F3.85` PR 8 / ADR 0099 decisions 2, 3, 4, 6 (plan §10.2) — the propose
 * tools, one per catalog entry, plus `fill_step` and `describe_change`.
 *
 * **A propose tool never writes the change.** It checks the body against the
 * entry's own schema (the controller's export) and any formula, refuses while
 * the conversation has a change in flight, resolves the target's organization
 * inside the turn's allowed set (`CopilotTargets`), refuses a template whose
 * lifecycle status the route would refuse (`F4.246`, with the route's own
 * sentence), and stores one `pending`
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
  // `F4.245` (Amendment 4): the model names the record by its path parameters; the dispatch checks them.
  schemas[FILL_STEP_TOOL] = z
    .object({
      catalogId: catalogIdSchema,
      params: z.record(z.string().min(1).max(64), z.string().min(1).max(256)),
      stepId: z.string().min(1).max(64),
      values: z.record(z.string(), z.unknown()),
    })
    .strict();
  definitions.push({
    name: FILL_STEP_TOOL,
    description:
      "Fill one step of a wizard open on the user's screen, with values for that step's fields. Name the wizard by " +
      "its catalogId and params exactly as the open-wizards list or an open_page result gives them ({} for a create); " +
      "any other record is refused, so propose that change instead. It saves nothing and sends nothing.",
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
  // `F3.87` PR 7, plan D8: a turn with a file whose words name no asset drops the asset and point creates.
  const assetCreateTools = [...byTool].filter(([, entry]) => ASSET_CREATE_IDS.has(entry.id)).map(([name]) => name);
  // `F4.279` (D4): the channel test send is dropped unless the user's own message asked (absent: dropped).
  const outwardTools = [...byTool].filter(([, entry]) => OUTWARD_ENTRY_IDS.has(entry.id)).map(([name]) => name);
  const registryFor = ({ access, role, assetCreate = true, outward = false }: RegistryOptions): ToolRegistry<string> => {
    const key = `${access ? "access" : "no-access"}:${assetCreate ? "assets" : "no-assets"}:${outward ? "outward" : "no-outward"}:${role}`;
    const known = registries.get(key);
    if (known !== undefined) return known;
    const dropped = new Set([
      ...(access ? [] : accessTools),
      ...(assetCreate ? [] : assetCreateTools),
      ...(outward ? [] : outwardTools),
      ...[...byTool].filter(([, entry]) => !offeredToRole(entry, role)).map(([name]) => name),
    ]);
    const made = registryWithout(dropped);
    registries.set(key, made);
    return made;
  };
  // The full registry keeps every tool for its existing callers (a spec, the definitions budget);
  // a turn always builds its own through `registryFor`.
  const registry = registryFor({ access: true, role: "admin", outward: true });
  const registryWithoutAccess = registryFor({ access: false, role: "admin", outward: true });

  /**
   * `F3.87` PR 5 — a layout proposal's checks, in the order the owner ruled:
   *
   * 1. ruling Q4, the role card first: a role code the vocabulary lacks is
   *    refused with a sentence for the caller's role, before any other check
   *    could answer the route's bare "Unknown asset role code";
   * 2. `validateProposal`, the route's own checks run read-only: a refusal is
   *    the route's sentence, returned to the model (A2);
   * 3. ruling Q5: a replace stores the layout it was built from under the
   *    `cardOnly` key `baseline`, which the hash leaves out.
   *
 * A replace may keep a retired role its stored drawing already carries (the
   * mapping-sheet rule, `assertReplaceLive`), so for a replace a missing code
   * refuses only when the service refuses the body for that reason — its
   * unknown-role 400. Any other refusal (the stale 409, a dead library, a 404)
   * is the route's own sentence; a non-HTTP error is re-thrown.
   *
   * The admin form names `assetRole.create`, so it is given only when this
   * registry has that propose tool; without it a global admin gets the
   * sentence form too.
   */
  const checkLayout = async (
    entry: CatalogEntry,
    params: Readonly<Record<string, string>>,
    raw: Record<string, unknown>,
    ctx: CopilotToolContext,
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> => {
    const layouts = services.layouts;
    if (layouts === undefined) return { ok: false, error: PROPOSE_LAYOUT_UNAVAILABLE_ERROR };
    // The route's own parse (its defaults applied) is what the service checks; the stored body stays raw.
    const typed = entry.body.safeParse(raw);
    if (!typed.success) return { ok: false, error: `Invalid body: ${issuesOf(typed.error)}` };
    const missing = await layouts.missingRoleCodes(roleCodesOf(typed.data.nodes));
    const roleRefusal = {
      ok: false as const,
      error:
        ctx.identity.role === "admin" && byTool.has(ROLE_CREATE_TOOL)
          ? PROPOSE_LAYOUT_ROLES_MISSING_ADMIN(missing)
          : PROPOSE_LAYOUT_ROLES_MISSING(missing),
    };
    const replace = entry.id === "mimicLayout.replace";
    if (missing.length > 0 && !replace) return roleRefusal;
    let baseline: unknown;
    try {
      const checked = await layouts.validateProposal(
        ctx.user,
        replace ? { kind: "replace", id: params.id as string, body: typed.data } : { kind: "create", body: typed.data },
      );
      baseline = checked.baseline;
    } catch (err) {
      const unknownRole = err instanceof BadRequestException && err.message === UNKNOWN_ROLE_MESSAGE;
      if (unknownRole && missing.length > 0) return roleRefusal;
      if (err instanceof HttpException) return { ok: false, error: err.message };
      throw err;
    }
    return { ok: true, body: replace ? { ...raw, baseline } : raw };
  };

  const propose = async (
    entry: CatalogEntry,
    args: Record<string, unknown>,
    ctx: CopilotToolContext,
  ): Promise<CopilotToolResult> => {
    // Decision 4.7: a follow-up turn may propose the next write, never an access change.
    if (entry.risk === "access" && ctx.turnKind === "follow_up") return { ok: false, error: PROPOSE_ACCESS_ON_FOLLOW_UP_ERROR };
    // Ruling Q3: only when the user's own message asked (the turn also withholds the tool; this is the second guard).
    if (entry.risk === "access" && !accessAsked(ctx)) return { ok: false, error: PROPOSE_ACCESS_NOT_ASKED_ERROR };
    // `F4.279` (D4): an outward-facing write, like an access change — never on a follow-up turn, and
    // only when the user's own message asked (the registry also withholds the tool).
    if (OUTWARD_ENTRY_IDS.has(entry.id) && ctx.turnKind === "follow_up") return { ok: false, error: PROPOSE_OUTWARD_ON_FOLLOW_UP_ERROR };
    if (OUTWARD_ENTRY_IDS.has(entry.id) && ctx.outwardIntent !== true) return { ok: false, error: PROPOSE_OUTWARD_NOT_ASKED_ERROR };
    // `F3.87` PR 2 (Amendment 3 A1): the registry withholds the tool from another role; this is the second guard.
    if (!offeredToRole(entry, ctx.identity.role)) return { ok: false, error: PROPOSE_ROLE_ERROR };
    // `F3.87` PR 7, plan D8: the registry withholds the creates on a file turn the words did not ask; the second guard.
    if (ASSET_CREATE_IDS.has(entry.id) && ctx.assetIntent === false) return { ok: false, error: PROPOSE_ASSET_NOT_ASKED_ERROR };
    // Ruling Q8: in local sign-in every user-account write answers 409, so no card is offered for one.
    if (isUserAccountEntry(entry) && resolveAuthMode(env) === "local") return { ok: false, error: LOCAL_MODE_READ_ONLY };
    const params: Record<string, string> = {};
    for (const name of Object.keys(entry.params)) params[name] = args[name] as string;
    // `F4.282` (D3): a direction entry's body is its `fixedBody`, parsed below like any other.
    const raw =
      entry.fixedBody !== undefined ? { ...entry.fixedBody } : entry.bodyName === null ? {} : (args.body as Record<string, unknown>);
    const parsed = modelBodySchema(entry).safeParse(raw);
    if (!parsed.success) return { ok: false, error: `Invalid body: ${issuesOf(parsed.error)}` };
    // The JSON image is what is stored, hashed and sent: one object on all three sides. It is the
    // raw body, not `parsed.data` (a transform or default would change what the route parses); it
    // never holds a `clientOnly` key, because the strict model body refused one above (`F3.86` PR 2).
    let body = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    // `F4.279` review: the card sets a nested `clientOnly` path (`config.url`) inside its parent, and
    // the Confirm strips only the leaf — so a parent the model body defaults is stored as defaulted,
    // or the stored hash never matches the Confirm's (`{ config: {} }` against no `config`).
    for (const parent of nestedClientOnlyParents(entry.clientOnly)) {
      const defaulted = (parsed.data as Record<string, unknown>)[parent];
      if (body[parent] === undefined && isPlainObject(defaulted)) body[parent] = JSON.parse(JSON.stringify(defaulted));
    }

    if (await services.pending.hasOpen(ctx.identity.id, ctx.conversationId)) {
      return { ok: false, error: PROPOSE_OPEN_CHANGE_ERROR };
    }
    const fleetRow =
      entry.target.kind === "fleet" ||
      entry.target.kind === "pointKey" ||
      entry.target.kind === "vocabulary" ||
      entry.target.kind === "telemetry";
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
    // `F4.246`: a template the route would refuse for its lifecycle status is refused here with the
    // route's sentence — after the target check (a row outside the scope never leaks its status), and
    // before the content merge (a version that cannot change is never read into a card).
    const lifecycle = templateLifecycleRefusal(entry.id, target.status);
    if (lifecycle !== null) return { ok: false, error: lifecycle };
    // `F4.247` (Amendment 5 C1): the stamp the Confirm's `If-Match` must name, read with the row the
    // card is built from. A flagged entry whose resolver read none is refused, never stored unguarded.
    let precondition: string | null = null;
    if (entry.precondition === "updatedAt") {
      if (target.updatedAt === undefined) return { ok: false, error: PROPOSE_PRECONDITION_ERROR };
      precondition = target.updatedAt;
    }
    // `F3.87` PR 5: a layout card is stored only when it can apply (Amendment 3 A2), and a replace
    // keeps the layout it was built from for the card's diff (ruling Q5).
    // `F4.278` (Q9): the route's refusals, "would match now" and the backtest, before the card.
    let ruleNote = "";
    if (RULE_ENTRY_IDS.has(entry.id)) {
      const checked = await checkRule(services.rules, entry.id, params, body, target.organizationId, ctx.now);
      if (!checked.ok) return checked;
      ruleNote = ` ${checked.note}`;
    }
    // `F4.279` (D2, D5): every channel the change names, through the route's gate; the card-only
    // recipients (stored beside the body, never in the summary) and a note with counts only.
    let cardBody: Record<string, unknown> = {};
    if (NOTIFICATION_ENTRY_IDS.has(entry.id)) {
      const checked = await checkNotification(services.notifications, entry.id, params, body, target.organizationId, ctx.user);
      if (!checked.ok) return checked;
      if (checked.note !== "") ruleNote = ` ${checked.note}`;
      cardBody = checked.cardBody;
    }
    // `F4.280` (D4 per field, then D2, D5): email only when the user's own message asked; the route's checks.
    if (REPORT_ENTRY_IDS.has(entry.id)) {
      const checked = await checkReport(services.reports, entry.id, params, body, target.organizationId, ctx);
      if (!checked.ok) return checked;
      ruleNote = ` ${checked.note}`;
      cardBody = checked.cardBody;
    }
    // `F4.283` (Q18–Q21): the file's name and SHA-256 (never its bytes), then the route's own checks, read-only.
    if (FILE_ENTRY_IDS.has(entry.id)) {
      const checked = await checkFile(services.files, entry, params, body, target.organizationId, ctx);
      if (!checked.ok) return checked;
      body = checked.body;
      if (checked.note !== "") ruleNote = ` ${checked.note}`;
      cardBody = checked.cardBody;
    }
    if (LAYOUT_ENTRY_IDS.has(entry.id)) {
      const checked = await checkLayout(entry, params, body, ctx);
      if (!checked.ok) return checked;
      body = checked.body;
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
    // `F3.87` PR 6a (Amendment 3 A3): an upload entry stores the text fields, the file's name and
    // SHA-256, and the SVG text under its `cardOnly` key, after the route's own parser passed it.
    if (entry.upload?.kind === "svg") {
      // `F3.87` PR 7: an attached file is the source by its 1-based index; a file that is not an SVG has no text.
      const attached = (ctx.attachments ?? []).map((file) =>
        file.svgText === undefined ? undefined : { filename: file.filename, svgText: file.svgText },
      );
      const prepared = prepareUpload(entry, body, attached);
      if (!prepared.ok) return { ok: false, error: prepared.error };
      body = prepared.body;
    }

    const fromFile =
      LAYOUT_ENTRY_IDS.has(entry.id) && ((ctx.attachments?.length ?? 0) > 0 || ctx.historyHasAttachmentSinceLastLayout === true);
    const summary =
      entry.summary({
        body,
        params,
        targetName: target.targetName,
        organizationName: target.organizationName,
        ...(target.currentWidgetIds ? { currentWidgetIds: target.currentWidgetIds } : {}),
        ...(target.refName !== undefined ? { refName: target.refName } : {}),
        ...(target.usageCount !== undefined ? { usageCount: target.usageCount } : {}),
        ...(target.lifecycle !== undefined ? { lifecycle: target.lifecycle } : {}),
      }) +
      ruleNote +
      (fromFile ? COPILOT_READ_FROM_FILE_NOTE : "");
    // `F4.279`: the card-only keys join the body after the summary read it, so no summary lists them.
    body = { ...body, ...cardBody };
    const change = await services.pending.propose(ctx.identity.id, {
      conversationId: ctx.conversationId,
      organizationId: target.organizationId,
      catalogId: entry.id,
      method: entry.method,
      path: catalogPath(entry, params),
      body,
      // `F3.87` PR 2: the interceptor's own exclusion rule (`hashExcludedKeysFor` calls the same helper).
      bodyHash: bodyHash(body, hashExcludedKeysOf(entry)),
      summary,
      risk: entry.risk,
      precondition,
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
    openWizardRecords: (wizards, ctx) => openWizardRecords(wizards, services.targets, ctx, (id) => byId.get(id)),
    pageWizardRecords: (route, ctx) => pageWizardRecords(route, services.targets, ctx, (id) => byId.get(id)),
    dispatch: async (name, args, ctx): Promise<CopilotToolResult> => {
      const entry = byTool.get(name);
      if (entry !== undefined) return propose(entry, args, ctx);
      if (name === FILL_STEP_TOOL) {
        const target = byId.get(args.catalogId as string);
        if (target === undefined) return { ok: false, error: UNKNOWN_CHANGE_ERROR };
        if (target.risk === "access" && !accessAsked(ctx)) return { ok: false, error: PROPOSE_ACCESS_NOT_ASKED_ERROR };
        if (!offeredToRole(target, ctx.identity.role)) return { ok: false, error: PROPOSE_ROLE_ERROR };
        // `F3.87` PR 7, D8: a file turn cannot pre-fill an asset wizard with what it read from the file either.
        if (ASSET_CREATE_IDS.has(target.id) && ctx.assetIntent === false) return { ok: false, error: PROPOSE_ASSET_NOT_ASKED_ERROR };
        // `F4.245` (Amendment 4): only a record the user has open, or one a page this turn opened mounts.
        const params = args.params as Record<string, string>;
        const refusal = fillRecordRefusal(target.id, params, ctx);
        if (refusal !== null) return { ok: false, error: refusal };
        const step = target.steps.find((candidate) => candidate.id === args.stepId);
        if (step === undefined) return { ok: false, error: UNKNOWN_STEP_ERROR };
        const values = fillValuesSchema(target, step.fields).safeParse(args.values);
        if (!values.success) return { ok: false, error: `Invalid values: ${issuesOf(values.error)}` };
        // `F4.280` (D4): a tool result can no more pre-fill a schedule's email delivery than propose it.
        const emailRefusal = await reportEmailRefusal(services.reports, target.id, params, args.values as Record<string, unknown>, ctx);
        if (emailRefusal !== null) return { ok: false, error: emailRefusal };
        // The step check reads field shapes only; the model body's rule that the copilot never names
        // the global admin role (decision 3) is a refinement, so it is held here on the server too.
        if (target.risk === "access" && (args.values as Record<string, unknown>).role === "admin") {
          return { ok: false, error: `Invalid values: role: ${COPILOT_NEVER_GLOBAL_ADMIN_MESSAGE}` };
        }
        return {
          ok: true,
          result: { filled: step.id },
          organizationIds: [],
          fillStep: { catalogId: target.id, params, stepId: step.id, values: args.values as Record<string, unknown> },
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
        if (ASSET_CREATE_IDS.has(target.id) && ctx.assetIntent === false) return { ok: false, error: PROPOSE_ASSET_NOT_ASKED_ERROR };
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
    // `F3.87` PR 5: the layout checks a layout proposal runs (`MimicLayoutsModule` exports it).
    @Inject(MimicLayoutsService) layouts: MimicLayoutsService,
    // `F4.278` (Amendment 8, Q9): APPENDED (slot 3) — the rule check (`RulesModule` exports it).
    @Inject(RuleProposalCheckService) rules: RuleProposalCheckService,
    // `F4.279` (Amendment 8 D5): APPENDED (slot 4) — the notification check (`NotificationsModule` exports it).
    @Inject(NotificationProposalCheckService) notifications: NotificationProposalCheckService,
    // `F4.280` (Amendment 8 D2, D5): APPENDED (slot 5) — the report check (`ReportsModule` exports it).
    @Inject(ReportProposalCheckService) reports: ReportProposalCheckService,
    // `F4.283` (Amendment 8 Q18–Q21): APPENDED (slots 6 and 7) — the telemetry check (`AdminModule`
    // exports it) and the image pre-check (`AssetsModule` exports `AssetImagesWriteService`).
    @Inject(TelemetryProposalCheckService) telemetry: TelemetryProposalCheckService,
    @Inject(AssetImagesWriteService) images: AssetImagesWriteService,
  ) {
    this.tools = createCopilotProposeTools({
      targets,
      pending,
      layouts,
      rules,
      notifications,
      reports,
      files: { telemetry, images },
    });
  }

  get registry(): ToolRegistry<string> {
    return this.tools.registry;
  }

  get registryWithoutAccess(): ToolRegistry<string> {
    return this.tools.registryWithoutAccess;
  }

  registryFor(options: RegistryOptions): ToolRegistry<string> {
    return this.tools.registryFor(options);
  }

  openWizardRecords(wizards: readonly CopilotOpenWizard[], ctx: CopilotToolContext): Promise<CopilotOpenWizardRecord[]> {
    return this.tools.openWizardRecords(wizards, ctx);
  }

  pageWizardRecords(route: string, ctx: CopilotToolContext): Promise<CopilotOpenWizardRecord[]> {
    return this.tools.pageWizardRecords(route, ctx);
  }

  dispatch(name: string, args: Record<string, unknown>, ctx: CopilotToolContext): Promise<CopilotToolResult> {
    return this.tools.dispatch(name, args, ctx);
  }
}
