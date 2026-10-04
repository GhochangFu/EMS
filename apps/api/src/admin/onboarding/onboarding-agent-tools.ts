import type { LocationTypeDto } from "@bms/shared";
import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { isJsonContainer, rebuildDeep } from "../stack-safe-json";
import { commitSummary } from "./onboarding-commit-proposal";
import { looksLikeCredential } from "./onboarding-credential-detect";
import { cutToBound, draftCountProblem } from "./onboarding-draft-caps";
import type { LlmToolCall, LlmToolDefinition } from "./onboarding-llm-port";
import { deriveLocationPatch } from "./onboarding-location-derive";
import type { OrgPointKeySummary } from "./onboarding-catalog.service";
import { carriesPromptMarker, serialiseDraftForPrompt } from "./onboarding-prompt-budget";
import type { ProtocolContext } from "./onboarding-protocol.service";
import { dispatchTemplateTool, isTemplateToolName, TEMPLATE_TOOL_DESCRIPTIONS, TEMPLATE_TOOL_SCHEMAS } from "./onboarding-template-tools";
import type { ValidateTemplateContext } from "./onboarding-template-refs";
import {
  fail,
  issuesOf,
  removeAt,
  succeed,
  toolResultContent,
  TOOL_LIST_MAX_ITEMS,
  TOOL_RESULT_CUT_TAIL,
  TOOL_RESULT_MAX_CHARS,
  write,
  type ToolOutcome,
  type ToolState,
} from "./onboarding-tool-outcome";
import { isSecretKey } from "./onboarding-redaction";
import {
  draftAssetPointSchema,
  draftAssetSchema,
  draftLocationSchema,
  draftPointKeySchema,
  draftRtuSchema,
} from "./onboarding.schema";

// The outcome helpers moved to `onboarding-tool-outcome.ts` (F3.22 P3); re-exported so existing imports compile.
export { toolResultContent, TOOL_LIST_MAX_ITEMS, TOOL_RESULT_CUT_TAIL, TOOL_RESULT_MAX_CHARS };
export type { ToolOutcome, ToolState };

/**
 * The onboarding agent's tools (`F3.21`, ADR 0090 decision 4).
 *
 * Every tool runs inside the session's organization against an **in-memory**
 * copy of the draft; the chat service writes the session row once, at the end
 * of the turn. Every write parses its arguments with the matching element
 * schema of `onboardingDraftSchema`, so the `F4.104` length bounds and the
 * `F2.23` code class hold by construction, and then checks `draftCountProblem`
 * on the merged result before the next model call.
 *
 * **A tool never throws.** Unknown names, malformed JSON, schema failures, a
 * refused credential and a cap are all returned to the model as `{ ok: false }`
 * results; every one of them counts toward the turn's 8-call cap (plan ruling
 * 6).
 *
 * **No tool takes a credential**, and code enforces it (decision 4): an RTU
 * argument is refused whole when any key at any depth matches the secret
 * fragments the redactors use (`isSecretKey`, one list for scrub and refusal)
 * or any string value `looksLikeCredential`. No tool schema carries `_secrets`,
 * `credentialsSet`, `_commitProposal` or an `onboardingMeta` field other than
 * `useExistingPointKeys`.
 *
 * **Action lines are written by code** from the validated, applied values —
 * never the raw arguments and never the model's text (decision 6).
 */

/**
 * Security review M1: short credential names the redactors' substring list
 * does not cover (`pass` is not a substring of "password"). Matched whole,
 * after normalising, so `pointKey` and `sourceDataKey` stay legal, plus any
 * key that contains `auth` (`auth`, `basicAuth`, `authorization`). The
 * list widens the **refusal** only; widening the shared scrub would change the
 * client and prompt views of drafts the workbook and `PATCH` already wrote, and
 * is its own follow-up.
 */
const AGENT_SECRET_KEY_NAMES = new Set(["user", "username", "login", "pass", "pw", "creds", "cred", "psk", "pin", "bearer", "key"]);

function agentSecretKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return isSecretKey(key) || AGENT_SECRET_KEY_NAMES.has(normalised) || normalised.includes("auth");
}

/**
 * The tools whose arguments are walked for credentials (decision 4, and security review L2 for the two `meta` carriers).
 * `F3.22` (ADR 0091 decision 9): the three template writes join, so every label, pattern and variable value is walked.
 */
const CREDENTIAL_CHECKED_TOOLS: ReadonlySet<string> = new Set([
  "add_rtu",
  "update_rtu",
  "set_location",
  "add_asset",
  "add_template",
  "import_stock_template",
  "add_template_assets",
]);

/** Security review M2: an RTU with stored credentials keeps its connection, so the credential cannot be sent elsewhere. */
export const CREDENTIALED_CONNECTION_ERROR =
  "This RTU has stored credentials, so its code, protocol, host, port and TLS cannot change in this chat. " +
  "Change them on the RTU step, where the credentials are entered.";

export const CREDENTIAL_TOOL_ERROR =
  "Credentials are never set through this chat. Tell the user to use the Credentials field on the RTU step.";

/** What the tools read; injected so a spec can supply fakes. */
export type ToolContext = {
  readonly organizationId: string;
  readonly activeTypes: readonly LocationTypeDto[];
  readonly catalog: {
    listPointKeys(organizationId: string): Promise<OrgPointKeySummary[]>;
  };
  readonly protocols: {
    getContextForOrganization(organizationId: string): Promise<ProtocolContext>;
    formatForAssistant(context: ProtocolContext, exampleRtuName: string): string;
  };
  readonly validator: {
    validate(
      draft: unknown,
      activeLocationTypeCodes: readonly string[],
      templates: ValidateTemplateContext,
    ): { valid: boolean; readyToCommit: boolean; errors: { path: string; message: string }[] };
  };
  /** `F3.22`: the organization's template versions and the stock catalog, read once per turn. */
  readonly templates: ValidateTemplateContext;
};

const indexSchema = z.object({ index: z.number().int().min(0) }).strict();
const noArgs = z.object({}).strict();

const rtuArgs = draftRtuSchema.omit({ credentialsSet: true });

/**
 * `F3.22` (ADR 0091 decision 2, code review): `add_template_assets` is the one
 * tool that writes `assets[].template`, because it is the one that pins an
 * organization template to the version it resolved. Strict, so a `template`
 * here is refused and not silently stripped into a plain asset.
 */
const assetArgs = draftAssetSchema.omit({ template: true }).strict();

const TOOL_SCHEMAS = {
  get_draft: noArgs,
  list_point_keys: z.object({ search: z.string().max(64).optional() }).strict(),
  list_location_types: noArgs,
  list_protocols: noArgs,
  set_location: draftLocationSchema.partial().required({ name: true }),
  add_rtu: rtuArgs,
  update_rtu: z.object({ index: z.number().int().min(0), patch: rtuArgs.partial() }).strict(),
  remove_rtu: indexSchema,
  add_point_key: draftPointKeySchema,
  remove_point_key: indexSchema,
  add_asset: assetArgs,
  remove_asset: indexSchema,
  map_point: draftAssetPointSchema,
  remove_asset_point: indexSchema,
  use_existing_point_keys: z.object({ value: z.boolean() }).strict(),
  validate_draft: noArgs,
  propose_commit: noArgs,
  ...TEMPLATE_TOOL_SCHEMAS,
} as const satisfies Record<string, ZodTypeAny>;

export type ToolName = keyof typeof TOOL_SCHEMAS;

const DESCRIPTIONS: Record<ToolName, string> = {
  ...TEMPLATE_TOOL_DESCRIPTIONS,
  get_draft: "Returns the current onboarding draft (credentials redacted).",
  list_point_keys: "Lists catalog point keys (code, name, unit, domain). Optional `search` filters code and name.",
  list_location_types: "Lists the active location type codes and labels. A location's `type` must be one of these codes.",
  list_protocols: "Describes the communication protocols an RTU can use.",
  set_location:
    "Sets the location. `name` is required; `slug` and `code` are derived from it when omitted. `type` must be an active location type code.",
  add_rtu: "Adds an RTU. Never put a username, password, token or key in `config`: credentials are set on the RTU step only.",
  update_rtu: "Changes fields of the RTU at `index`. Never put a credential in `config`.",
  remove_rtu: "Removes the RTU at `index`.",
  add_point_key: "Declares a point key in this draft.",
  remove_point_key: "Removes the draft point key at `index`.",
  add_asset: "Adds an asset on the RTU at `rtuIndex`.",
  remove_asset: "Removes the asset at `index`.",
  map_point: "Maps a source data key on the asset at `assetIndex` to a point key.",
  remove_asset_point: "Removes the mapping at `index`.",
  use_existing_point_keys: "Sets whether the draft uses the existing point-key catalog instead of declaring new keys.",
  validate_draft: "Validates the draft and returns the errors and whether it is ready to commit.",
  propose_commit:
    "Proposes the commit of a ready draft. You cannot commit: the user confirms with the Commit button or by typing `confirm commit`.",
};

function jsonSchemaOf(schema: ZodTypeAny): Record<string, unknown> {
  const converted = zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema7" }) as Record<string, unknown>;
  delete converted.$schema;
  // A union (`get_template`) converts to a bare `anyOf`; providers read the root as an object schema.
  if (converted.type === undefined) {
    converted.type = "object";
  }
  return converted;
}

/** The 24 tools as the model sees them, in a fixed order. */
export const TOOL_DEFINITIONS: readonly LlmToolDefinition[] = (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  parameters: jsonSchemaOf(TOOL_SCHEMAS[name]),
}));

/**
 * Whether an RTU argument carries a credential anywhere. Walked with the shared
 * iterative rebuild, so a deep argument cannot overflow the stack (`F4.115`).
 */
export function configCarriesCredential(value: unknown): boolean {
  let found = false;
  rebuildDeep(
    value,
    isJsonContainer,
    (key) => {
      if (agentSecretKey(key)) {
        found = true;
      }
      return null;
    },
    (leaf) => {
      if (typeof leaf === "string" && looksLikeCredential(leaf)) {
        found = true;
      }
      return null;
    },
  );
  return found;
}

function activeCodes(ctx: ToolContext): string[] {
  return ctx.activeTypes.map((type) => type.code);
}

/** Whether `name` is one of the registry's tools; the turn record logs any other name as `unknown` (security review L3). */
export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_SCHEMAS, name);
}

/** Runs one tool call against the turn's state. Never throws. */
export async function runTool(call: LlmToolCall, state: ToolState, ctx: ToolContext): Promise<ToolOutcome> {
  if (!isToolName(call.name)) {
    return fail(`Unknown tool ${quoteCell(call.name)}.`);
  }
  const name = call.name as ToolName;
  let raw: unknown;
  try {
    raw = call.arguments.trim() === "" ? {} : JSON.parse(call.arguments);
  } catch {
    return fail("The arguments are not valid JSON.");
  }
  if (carriesPromptMarker(raw)) {
    return fail("The arguments carry a withheld-value marker; send real values only.");
  }
  if (CREDENTIAL_CHECKED_TOOLS.has(name) && configCarriesCredential(raw)) {
    return fail(CREDENTIAL_TOOL_ERROR);
  }
  const parsed = TOOL_SCHEMAS[name].safeParse(raw);
  if (!parsed.success) {
    return fail(`Invalid arguments: ${issuesOf(parsed.error)}`);
  }
  try {
    return await dispatch(name, parsed.data as never, state, ctx);
  } catch {
    return fail("The tool failed. Try again or continue without it.");
  }
}

async function dispatch(name: ToolName, args: Record<string, unknown>, state: ToolState, ctx: ToolContext): Promise<ToolOutcome> {
  if (isTemplateToolName(name)) {
    return dispatchTemplateTool(name, args, state, ctx);
  }
  const draft = state.working;
  switch (name) {
    case "get_draft":
      return succeed({ draft: serialiseDraftForPrompt(draft) });

    case "list_point_keys": {
      const search = typeof args.search === "string" ? args.search.toLowerCase() : "";
      const rows = (await ctx.catalog.listPointKeys(ctx.organizationId)).filter(
        (row) => !search || row.code.toLowerCase().includes(search) || row.name.toLowerCase().includes(search),
      );
      const { shown, omitted } = echoedItems(rows, TOOL_LIST_MAX_ITEMS);
      return succeed({ pointKeys: shown, more: moreTail(omitted, "point keys") || undefined });
    }

    case "list_location_types":
      return succeed({ types: ctx.activeTypes.map((type) => ({ code: type.code, label: type.label })) });

    case "list_protocols": {
      const context = await ctx.protocols.getContextForOrganization(ctx.organizationId);
      const example = draft.location?.name
        ? `${draft.location.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-RTU-1`
        : "LOCATION-RTU-1";
      return succeed({ protocols: ctx.protocols.formatForAssistant(context, example) });
    }

    case "set_location": {
      const location = args as z.infer<(typeof TOOL_SCHEMAS)["set_location"]>;
      const codes = activeCodes(ctx);
      if (location.type !== undefined && !codes.includes(location.type)) {
        const { shown, omitted } = echoedItems(codes, TOOL_LIST_MAX_ITEMS);
        return fail(
          `Location type ${quoteCell(location.type)} is not active. Use one of: ${[...shown, moreTail(omitted, "types")].filter(Boolean).join(", ")}.`,
        );
      }
      // Code review #4: an unchanged name keeps the stored slug and code (a
      // workbook's `wc-hq` must not become `west-campus-hq` when only the type
      // changes); the call's own slug and code still win.
      const stored = draft.location;
      const kept = stored && stored.name === location.name ? { slug: stored.slug, code: stored.code, ...location } : location;
      const derived = deriveLocationPatch({ name: location.name, stored, kept, type: location.type });
      const type = derived.type ?? draft.location?.type;
      return write(state, { location: derived }, `Set location ${derived.name} (${type ?? "type not set"})`);
    }

    case "add_rtu": {
      const rtu = { ...(args as z.infer<typeof rtuArgs>), credentialsSet: false };
      // Security review M2 (code review's sibling note): `_secrets` is keyed by
      // RTU code, so re-adding a removed credentialed code would inherit its
      // credential at reconcile, pointed at whatever host this call names.
      const secrets = (draft as { _secrets?: Record<string, unknown> })._secrets ?? {};
      const code = rtu.code.trim();
      if (Object.prototype.hasOwnProperty.call(secrets, code) && !(draft.rtus ?? []).some((r) => r.code.trim() === code)) {
        return fail(`RTU code ${quoteCell(code)} still holds stored credentials from a removed RTU. Use another code.`);
      }
      return write(state, { rtus: [...(draft.rtus ?? []), rtu] }, `Added RTU ${rtu.code} (${rtu.protocol})`);
    }

    case "update_rtu": {
      const { index, patch } = args as z.infer<(typeof TOOL_SCHEMAS)["update_rtu"]>;
      const rtus = draft.rtus ?? [];
      const stored = rtus[index];
      if (!stored) {
        return fail(`There is no RTU at index ${index}; the draft has ${rtus.length}.`);
      }
      // Code review #3: `config` merges one level deep, so "change the topic"
      // keeps host, port and TLS.
      const config = patch.config ? { ...(stored.config ?? {}), ...patch.config } : stored.config;
      const updated = { ...stored, ...patch, config, credentialsSet: stored.credentialsSet };
      if (stored.credentialsSet) {
        const same = (field: string) => JSON.stringify(config?.[field]) === JSON.stringify(stored.config?.[field]);
        if (!same("host") || !same("port") || !same("tls") || updated.protocol !== stored.protocol || updated.code !== stored.code) {
          return fail(CREDENTIALED_CONNECTION_ERROR);
        }
      }
      // Security review M2: the line names what changed, and the new host.
      const changed = Object.keys(patch).flatMap((key) =>
        key === "config" ? Object.keys(patch.config ?? {}).map((field) => `config.${field}`) : [key],
      );
      const { shown, omitted } = echoedItems(changed.map((field) => quoteCell(field)), 10);
      const fields = [...shown, moreTail(omitted, "fields")].filter(Boolean).join(", ") || "no fields";
      const host = patch.config && "host" in patch.config ? `, host ${quoteCell(String(config?.host ?? ""))}` : "";
      return write(state, { rtus: rtus.map((rtu, i) => (i === index ? updated : rtu)) }, `Updated RTU ${updated.code}: ${fields}${host}`);
    }

    case "remove_rtu": {
      // Code review #1: assets point at RTUs by position. A referenced RTU is
      // refused, naming its assets; otherwise every later index shifts down.
      const index = (args as { index: number }).index;
      const hit = removeAt(draft.rtus, index);
      if (!hit) {
        return fail("There is no RTU at that index.");
      }
      const dependents = (draft.assets ?? []).filter((asset) => asset.rtuIndex === index).map((asset) => quoteCell(asset.code));
      if (dependents.length > 0) {
        const { shown, omitted } = echoedItems(dependents, 10);
        return fail(`RTU ${hit.removed.code} still has assets: ${[...shown, moreTail(omitted, "assets")].filter(Boolean).join(", ")}. Remove or move them first.`);
      }
      const assets = (draft.assets ?? []).map((asset) => (asset.rtuIndex > index ? { ...asset, rtuIndex: asset.rtuIndex - 1 } : asset));
      return write(state, { rtus: hit.rest, ...(draft.assets ? { assets } : {}) }, `Removed RTU ${hit.removed.code}`);
    }

    case "add_point_key": {
      const key = args as z.infer<typeof draftPointKeySchema>;
      return write(state, { pointKeys: [...(draft.pointKeys ?? []), key] }, `Added point key ${key.code}`);
    }

    case "remove_point_key": {
      const hit = removeAt(draft.pointKeys, (args as { index: number }).index);
      return hit
        ? write(state, { pointKeys: hit.rest }, `Removed point key ${hit.removed.code}`)
        : fail("There is no point key at that index.");
    }

    case "add_asset": {
      const asset = args as z.infer<typeof assetArgs>;
      const rtu = draft.rtus?.[asset.rtuIndex];
      return write(
        state,
        { assets: [...(draft.assets ?? []), asset] },
        `Added asset ${asset.code} on RTU ${rtu?.code ?? `#${asset.rtuIndex}`}`,
      );
    }

    case "remove_asset": {
      // Code review #1: mappings point at assets by position, as assets do at RTUs.
      const index = (args as { index: number }).index;
      const hit = removeAt(draft.assets, index);
      if (!hit) {
        return fail("There is no asset at that index.");
      }
      const dependents = (draft.assetPoints ?? []).filter((point) => point.assetIndex === index).map((point) => quoteCell(point.sourceDataKey));
      if (dependents.length > 0) {
        const { shown, omitted } = echoedItems(dependents, 10);
        return fail(`Asset ${hit.removed.code} still has mappings: ${[...shown, moreTail(omitted, "mappings")].filter(Boolean).join(", ")}. Remove them first.`);
      }
      const assetPoints = (draft.assetPoints ?? []).map((point) =>
        point.assetIndex > index ? { ...point, assetIndex: point.assetIndex - 1 } : point,
      );
      return write(state, { assets: hit.rest, ...(draft.assetPoints ? { assetPoints } : {}) }, `Removed asset ${hit.removed.code}`);
    }

    case "map_point": {
      const point = args as z.infer<typeof draftAssetPointSchema>;
      const asset = draft.assets?.[point.assetIndex];
      return write(
        state,
        { assetPoints: [...(draft.assetPoints ?? []), point] },
        `Mapped ${point.sourceDataKey} → ${point.pointKey} on asset ${asset?.code ?? `#${point.assetIndex}`}`,
      );
    }

    case "remove_asset_point": {
      const hit = removeAt(draft.assetPoints, (args as { index: number }).index);
      return hit
        ? write(state, { assetPoints: hit.rest }, `Removed mapping ${hit.removed.sourceDataKey} → ${hit.removed.pointKey}`)
        : fail("There is no mapping at that index.");
    }

    case "use_existing_point_keys": {
      const value = (args as { value: boolean }).value;
      return write(
        state,
        { onboardingMeta: { useExistingPointKeys: value } },
        value ? "Point keys: using the existing catalog" : "Point keys: declared in this draft",
      );
    }

    case "validate_draft": {
      const result = ctx.validator.validate(draft, activeCodes(ctx), ctx.templates);
      const { shown, omitted } = echoedItems(result.errors, TOOL_LIST_MAX_ITEMS);
      return succeed({ valid: result.valid, readyToCommit: result.readyToCommit, errors: shown, more: moreTail(omitted, "errors") || undefined });
    }

    case "propose_commit": {
      const problem = draftCountProblem(draft);
      const result = ctx.validator.validate(draft, activeCodes(ctx), ctx.templates);
      if (problem !== null || !result.readyToCommit) {
        const { shown } = echoedItems(result.errors, 10);
        const reasons = [problem, ...shown.map((e) => `${e.path}: ${e.message}`)].filter(Boolean).join("; ");
        return fail(`The draft is not ready to commit. ${cutToBound(reasons, 2_000)}`);
      }
      const summary = commitSummary(draft, ctx.templates);
      state.pendingProposal = { summary };
      return succeed(
        { proposed: true, summary, next: "Tell the user to type `confirm commit` or use the Commit button. You cannot commit." },
        `Proposed commit: ${summary}`,
      );
    }
  }
}
