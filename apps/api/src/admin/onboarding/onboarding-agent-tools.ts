import { describeProtocol, protocolCatalogEntry, type LocationTypeDto, type OnboardingProtocol } from "@bms/shared";
import { z, type ZodTypeAny } from "zod";

import { echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { isJsonContainer, rebuildDeep } from "../stack-safe-json";
import { commitSummary } from "./onboarding-commit-proposal";
import { looksLikeCredential } from "./onboarding-credential-detect";
import { assetPointProblems } from "./onboarding-mapping-refs";
import { dispatchMappingTool, isMappingToolName, MAPPING_TOOL_DESCRIPTIONS, MAPPING_TOOL_SCHEMAS } from "./onboarding-mapping-tools";
import { cutToBound, draftCountProblem } from "./onboarding-draft-caps";
import type { LlmToolCall, LlmToolDefinition } from "../../llm/llm-port";
import { defineToolRegistry, runToolCall, type ToolGuard } from "../../llm/tool-registry";
import { deriveLocationPatch } from "./onboarding-location-derive";
import { pointKeyDeclarationProblems } from "./onboarding-point-key-conflict";
import type { OrgPointKeySummary } from "./onboarding-catalog.service";
import type { ExistingQuery, ExistingRow } from "./onboarding-inventory.service";
import { carriesPromptMarker, serialiseDraftForPrompt } from "./onboarding-prompt-budget";
import type { ProtocolContext } from "./onboarding-protocol.service";
import { dispatchTemplateTool, isTemplateToolName, TEMPLATE_TOOL_DESCRIPTIONS, TEMPLATE_TOOL_SCHEMAS } from "./onboarding-template-tools";
import { draftTemplateCode, isStockEntry, templateRefPointKeys, unresolvedPointKey, type ValidateTemplateContext } from "./onboarding-template-refs";
import {
  fail,
  issuesOf,
  MAX_MODEL_REPLIES,
  MAX_SUGGESTED_REPLY_CHARS,
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
 * `add_rtu` and `update_rtu` check `rtus[].config` with the protocol's draft
 * schema from the catalog (F3.24a, ADR 0093), reporting paths only.
 *
 * **Action lines are written by code** from the validated, applied values —
 * never the raw arguments and never the model's text (decision 6).
 *
 * The guided mode calls `runTool` too (F3.27, ADR 0090 Amendment 2 B4), through
 * `guidedWrite`, so these refusals and action lines hold on both paths.
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
 * `F3.23` (ADR 0092 decision 4): the two batch writes join, so every key and mapping row is walked.
 */
const CREDENTIAL_CHECKED_TOOLS: ReadonlySet<string> = new Set([
  "add_rtu",
  "update_rtu",
  "set_location",
  "add_asset",
  "add_template",
  "import_stock_template",
  "add_template_assets",
  "add_point_keys",
  "map_points",
]);

/** Security review M2: an RTU with stored credentials keeps its connection, so the credential cannot be sent elsewhere. */
export const CREDENTIALED_CONNECTION_ERROR =
  "This RTU has stored credentials, so its code, protocol, host, port and TLS cannot change in this chat. " +
  "Change them on the RTU step, where the credentials are entered.";

/** The refusal of an argument that echoes the prompt-budget marker; exported so `guidedWrite` classifies it by identity. */
export const PROMPT_MARKER_TOOL_ERROR = "The arguments carry a withheld-value marker; send real values only.";

/**
 * `F3.23` (ADR 0092 decision 3): the existing catalog stands in for the draft's
 * keys only when it holds `kw`, the key every guided sample maps. Exported so
 * `guidedRefusal` classifies it by identity.
 */
export const EXISTING_KEYS_NEED_KW_ERROR =
  "The catalog holds no active point key 'kw', so the existing catalog cannot be used here; declare the point keys in this draft.";

/**
 * `F3.23` review: the catalog holds `kw` but inactive. Declaring `kw` in the
 * draft does not help (`map_point` refuses an inactive catalog key, ADR 0092
 * decision 2), so this refusal names reactivation instead. Exported so
 * `guidedRefusal` classifies it by identity.
 */
export const EXISTING_KEYS_KW_INACTIVE_ERROR =
  "The catalog holds the point key 'kw' as inactive, so neither the existing catalog nor a draft declaration of 'kw' can map it. " +
  "Tell the user to reactivate 'kw' in Point Keys, or map other point keys.";

/**
 * `F3.24a` (ADR 0093 decision 5): the prefix of the refusal of an RTU config
 * the protocol's draft schema refuses. Exported so `guidedRefusal` classifies
 * it. The rest of the sentence is the protocol code and the issue paths with
 * the shared schema's messages, which carry no value.
 */
export const INVALID_CONFIG_PREFIX = "Invalid config for ";

/** The tail of an RTU action line for a protocol no ingest adapter serves (ADR 0093 decision 6). */
const CONFIG_ONLY_TAIL = " (config only, not ingested)";

/** The refusal of `config` under `protocol`'s draft schema, or `null` when it passes. */
function configProblem(protocol: OnboardingProtocol, config: Record<string, unknown> | undefined): string | null {
  const parsed = protocolCatalogEntry(protocol).draftConfigSchema.safeParse(config ?? {});
  return parsed.success ? null : `${INVALID_CONFIG_PREFIX}${protocol}: ${issuesOf(parsed.error)}`;
}

function rtuActionTail(protocol: OnboardingProtocol): string {
  return protocolCatalogEntry(protocol).ingestWired ? "" : CONFIG_ONLY_TAIL;
}

export const CREDENTIAL_TOOL_ERROR =
  "Credentials are never set through this chat. Tell the user to use the Credentials field on the RTU step.";

/** What the tools read; injected so a spec can supply fakes. */
export type ToolContext = {
  readonly organizationId: string;
  readonly activeTypes: readonly LocationTypeDto[];
  readonly catalog: {
    listPointKeys(organizationId: string): Promise<OrgPointKeySummary[]>;
    /** F3.26 (ADR 0095 decision 4): the point keys the organization already maps in `asset_points`. */
    listInUsePointKeys(organizationId: string): Promise<ReadonlySet<string>>;
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
    ): { valid: boolean; readyToCommit: boolean; errors: { path: string; message: string }[]; suggestedPhase: string };
  };
  /** `F3.22`: the organization's template versions and the stock catalog, read once per turn. */
  readonly templates: ValidateTemplateContext;
  /** F3.26 (ADR 0095 decisions 1–3): the session organization's committed rows; required, so every fake must supply it. */
  readonly inventory: {
    listExisting(organizationId: string, query: ExistingQuery): Promise<{ rows: ExistingRow[]; total: number }>;
  };
};

/**
 * F3.26 (ADR 0095 decision 2, F4.109): written by code on every `find_existing`
 * result. Names no other organization; "already taken" is the commit's own form.
 */
export const EXISTING_SCOPE_NOTE =
  "Only this organization's locations, RTUs and assets are listed. A location slug, an asset code, an MQTT topic, an RTU device id or an external RTU id can still be refused at commit as already taken; the commit result is the only check for that.";

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
  list_point_keys: z
    .object({ search: z.string().max(64).optional(), domain: z.string().max(64).optional(), unit: z.string().max(32).optional() })
    .strict(),
  // F3.26 (ADR 0095 decision 1): tenant-only read; never in CREDENTIAL_CHECKED_TOOLS (the arguments are never stored).
  find_existing: z
    .object({
      kind: z.enum(["location", "rtu", "asset"]),
      search: z.string().max(64).optional(),
      locationCode: z.string().max(64).optional(),
    })
    .strict(),
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
  // F3.25 (ADR 0094 decision 9): code filters the offered replies before any reaches the client.
  suggest_replies: z
    .object({ replies: z.array(z.string().min(1).max(MAX_SUGGESTED_REPLY_CHARS)).min(1).max(MAX_MODEL_REPLIES) })
    .strict(),
  ...TEMPLATE_TOOL_SCHEMAS,
  ...MAPPING_TOOL_SCHEMAS,
} as const satisfies Record<string, ZodTypeAny>;

export type ToolName = keyof typeof TOOL_SCHEMAS;

const DESCRIPTIONS: Record<ToolName, string> = {
  ...TEMPLATE_TOOL_DESCRIPTIONS,
  ...MAPPING_TOOL_DESCRIPTIONS,
  get_draft: "Returns the current onboarding draft (credentials redacted).",
  list_point_keys: "Lists catalog point keys (code, name, unit, domain, inUse). Optional `search` filters code and name; `domain` and `unit` match exactly, case-insensitive. Keys this organization already maps come first.",
  find_existing:
    "Lists this organization's existing locations, RTUs or assets (codes, names, protocol, domain, template). " +
    "Call it before you choose a new code, so the draft follows the organization's naming and avoids a code it already holds. " +
    "Optional `search` matches code and name; `locationCode` is exact.",
  list_location_types: "Lists the active location type codes and labels. A location's `type` must be one of these codes.",
  list_protocols:
    "Describes the eight protocols an RTU can use: label, whether ingest serves it (config only otherwise), " +
    "the required and optional config fields and an example config. Call it before add_rtu for any protocol other than mqtt.",
  set_location:
    "Sets the location. `name` is required; `slug` and `code` are derived from it when omitted. `type` must be an active location type code.",
  add_rtu:
    "Adds an RTU. Never put a username, password, token or key in `config`: credentials are set on the RTU step only. " +
    "A config that fails the protocol's schema is refused with the field path.",
  update_rtu:
    "Changes fields of the RTU at `index`. Never put a credential in `config`. " +
    "A config that fails the protocol's schema is refused with the field path.",
  remove_rtu: "Removes the RTU at `index`.",
  add_point_key:
    "Declares a point key in this draft. Refused when the catalog already holds the code with a different unit or domain; " +
    "declare such a code without unit and domain to accept the catalog's.",
  remove_point_key:
    "Removes the draft point key at `index`. Refused while a draft mapping or template uses it and the catalog does not hold it active.",
  add_asset: "Adds an asset on the RTU at `rtuIndex`.",
  remove_asset: "Removes the asset at `index`.",
  map_point:
    "Maps a source data key on the asset at `assetIndex` to a point key. Refused when the asset is missing or built from a template, " +
    "when the key is neither declared in this draft nor active in the catalog, or when the asset already maps that point key or source data key.",
  remove_asset_point: "Removes the mapping at `index`.",
  use_existing_point_keys:
    "Sets whether the draft uses the existing point-key catalog instead of declaring new keys. `true` is refused when the catalog holds no active `kw`.",
  validate_draft: "Validates the draft and returns the errors and whether it is ready to commit.",
  propose_commit:
    "Proposes the commit of a ready draft. You cannot commit: the user confirms with the Commit button or by typing `confirm commit`.",
  suggest_replies:
    "Offers up to 4 short replies the user can click to answer your question. Use it when you ask the user to choose. It changes nothing in the draft.",
};

/** `F3.85` (ADR 0099): the name → schema map and its definitions, built by the generic registry in `llm/`. */
const TOOL_REGISTRY = defineToolRegistry(TOOL_SCHEMAS, DESCRIPTIONS);

/** The 29 tools as the model sees them, in a fixed order. */
export const TOOL_DEFINITIONS: readonly LlmToolDefinition[] = TOOL_REGISTRY.definitions;

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
  return TOOL_REGISTRY.isToolName(name);
}

/**
 * The checks every call's arguments meet before the schema, in this order: the
 * withheld-value marker on every tool, then the credential walk on
 * `CREDENTIAL_CHECKED_TOOLS` only.
 */
const TOOL_GUARDS: readonly ToolGuard<ToolName>[] = [
  (_name, raw) => (carriesPromptMarker(raw) ? PROMPT_MARKER_TOOL_ERROR : null),
  (name, raw) => (CREDENTIAL_CHECKED_TOOLS.has(name) && configCarriesCredential(raw) ? CREDENTIAL_TOOL_ERROR : null),
];

/** Runs one tool call against the turn's state. Never throws (`runToolCall`, `F3.85`). */
export async function runTool(call: LlmToolCall, state: ToolState, ctx: ToolContext): Promise<ToolOutcome> {
  return runToolCall(TOOL_REGISTRY, call, (name, args) => dispatch(name, args, state, ctx), TOOL_GUARDS);
}

async function dispatch(name: ToolName, args: Record<string, unknown>, state: ToolState, ctx: ToolContext): Promise<ToolOutcome> {
  if (isTemplateToolName(name)) {
    return dispatchTemplateTool(name, args, state, ctx);
  }
  if (isMappingToolName(name)) {
    return dispatchMappingTool(name, args, state, ctx);
  }
  const draft = state.working;
  switch (name) {
    case "get_draft":
      return succeed({ draft: serialiseDraftForPrompt(draft) });

    case "list_point_keys": {
      // F3.26 (ADR 0095 decision 4): optional exact, case-insensitive domain and
      // unit filters; the keys this organization already maps come first.
      const inUse = await ctx.catalog.listInUsePointKeys(ctx.organizationId);
      const search = typeof args.search === "string" ? args.search.toLowerCase() : "";
      const domain = typeof args.domain === "string" ? args.domain.toLowerCase() : undefined;
      const unit = typeof args.unit === "string" ? args.unit.toLowerCase() : undefined;
      const rows = (await ctx.catalog.listPointKeys(ctx.organizationId)).filter(
        (row) =>
          (!search || row.code.toLowerCase().includes(search) || row.name.toLowerCase().includes(search)) &&
          (domain === undefined || (row.domain ?? "").toLowerCase() === domain) &&
          (unit === undefined || (row.unit ?? "").toLowerCase() === unit),
      );
      const ranked = [...rows.filter((row) => inUse.has(row.code)), ...rows.filter((row) => !inUse.has(row.code))].map((row) => ({
        ...row,
        inUse: inUse.has(row.code),
      }));
      const { shown, omitted } = echoedItems(ranked, TOOL_LIST_MAX_ITEMS);
      return succeed({ pointKeys: shown, more: moreTail(omitted, "point keys") || undefined });
    }

    case "find_existing": {
      // F3.26 (ADR 0095 decisions 1, 2, 6): no write and no action line. The
      // note and the tail come before the items, so a result cut at
      // TOOL_RESULT_MAX_CHARS loses rows, never the note or the count. `total`
      // is exact, so it still counts the rows the cut hides when `more` is
      // absent (F3.26 review L2).
      const query = args as ExistingQuery;
      const { rows, total } = await ctx.inventory.listExisting(ctx.organizationId, query);
      const { shown } = echoedItems(rows, TOOL_LIST_MAX_ITEMS);
      return succeed({
        kind: query.kind,
        note: EXISTING_SCOPE_NOTE,
        total,
        more: moreTail(total - shown.length, `${query.kind}s`) || undefined,
        items: shown,
      });
    }

    case "list_location_types":
      return succeed({ types: ctx.activeTypes.map((type) => ({ code: type.code, label: type.label })) });

    case "list_protocols": {
      const context = await ctx.protocols.getContextForOrganization(ctx.organizationId);
      const example = draft.location?.name
        ? `${draft.location.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-RTU-1`
        : "LOCATION-RTU-1";
      // F3.24a (ADR 0093 decision 5): the catalog's fields, without the schema object.
      return succeed({ catalog: context.catalog.map(describeProtocol), protocols: ctx.protocols.formatForAssistant(context, example) });
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
      // F3.24a (ADR 0093 decision 5): a config ingest would refuse never enters the draft.
      const problem = configProblem(rtu.protocol, rtu.config);
      if (problem) {
        return fail(problem);
      }
      return write(state, { rtus: [...(draft.rtus ?? []), rtu] }, `Added RTU ${rtu.code} (${rtu.protocol})${rtuActionTail(rtu.protocol)}`);
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
      // F3.24a (ADR 0093 decision 5): after the freeze, the merged config is checked against the patched protocol.
      const problem = configProblem(updated.protocol, config);
      if (problem) {
        return fail(problem);
      }
      // Security review M2: the line names what changed, and the new host.
      const changed = Object.keys(patch).flatMap((key) =>
        key === "config" ? Object.keys(patch.config ?? {}).map((field) => `config.${field}`) : [key],
      );
      const { shown, omitted } = echoedItems(changed.map((field) => quoteCell(field)), 10);
      const fields = [...shown, moreTail(omitted, "fields")].filter(Boolean).join(", ") || "no fields";
      const host = patch.config && "host" in patch.config ? `, host ${quoteCell(String(config?.host ?? ""))}` : "";
      return write(state, { rtus: rtus.map((rtu, i) => (i === index ? updated : rtu)) }, `Updated RTU ${updated.code}: ${fields}${host}${rtuActionTail(updated.protocol)}`);
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
      const existing = draft.pointKeys ?? [];
      // F4.225: the commit refuses a declared unit or domain that the catalog,
      // or an earlier declaration of the same code, contradicts. Only the
      // appended key is judged; a contradiction already in the draft (a PATCH
      // can put one there) is the validator's to report.
      const problem = pointKeyDeclarationProblems([...existing, key], ctx.templates.pointKeyFields).find(
        (candidate) => candidate.index === existing.length,
      );
      if (problem) {
        return fail(problem.message);
      }
      return write(state, { pointKeys: [...existing, key] }, `Added point key ${quoteCell(key.code)}`);
    }

    case "remove_point_key": {
      const hit = removeAt(draft.pointKeys, (args as { index: number }).index);
      if (!hit) {
        return fail("There is no point key at that index.");
      }
      // F4.195: an authored draft template resolves its point keys at commit
      // against the draft and the catalog, as `add_template` checks them. A key
      // that resolves only through this declaration cannot leave while a
      // template uses it, or the proposal succeeds and the commit fails. A
      // second declaration of the same code keeps it resolved, so one copy of a
      // duplicate can leave. F4.196: the validator's rule (`unresolvedPointKey`)
      // against the context's catalog decides whether the key still resolves.
      // F4.213: a stock entry is read through its catalog ref (its points' keys
      // and its formulas' keys), as validation reads it since F4.205; a stock
      // code the catalog does not ship needs nothing here (validation names it).
      const code = hit.removed.code;
      const catalog = ctx.templates.pointKeys;
      const before = new Set((draft.pointKeys ?? []).map((key) => key.code));
      const after = new Set(hit.rest.map((key) => key.code));
      const breaks = unresolvedPointKey(code, before, catalog) === null && unresolvedPointKey(code, after, catalog) !== null;
      // F3.23 (ADR 0092 decision 2, F4.195 left open): the mappings that lose
      // their key are the ones the mapping rule refuses once it is gone.
      const rows = draft.assetPoints ?? [];
      const mappings = !breaks
        ? []
        : assetPointProblems([], rows, { assets: draft.assets, pointKeys: hit.rest }, catalog)
            .filter((problem) => problem.kind === "key" && rows[problem.index]?.pointKey === code)
            .map((problem) => quoteCell(rows[problem.index]!.sourceDataKey));
      if (mappings.length > 0) {
        const { shown, omitted } = echoedItems(mappings, 10);
        return fail(
          `Point key ${quoteCell(code)} is used by mappings: ${[...shown, moreTail(omitted, "mappings")].filter(Boolean).join(", ")}. ` +
            "Remove those mappings first.",
        );
      }
      const users = !breaks
        ? []
        : (draft.templates ?? [])
            .filter((entry) => {
              if (!isStockEntry(entry)) {
                return entry.points.some((point) => point.pointKey === code);
              }
              const stock = ctx.templates.stock.find((ref) => ref.code === entry.stockCode);
              return stock !== undefined && templateRefPointKeys(stock).has(code);
            })
            .map((entry) => quoteCell(draftTemplateCode(entry)));
      if (users.length > 0) {
        const { shown, omitted } = echoedItems(users, 10);
        return fail(
          `Point key ${quoteCell(code)} is used by draft templates: ${[...shown, moreTail(omitted, "templates")].filter(Boolean).join(", ")}. ` +
            "Remove those templates first.",
        );
      }
      return write(state, { pointKeys: hit.rest }, `Removed point key ${quoteCell(code)}`);
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
      // F3.23 (ADR 0092 decision 2): the validator's mapping rule, so a
      // mapping written here cannot fail the commit as 23503 or 23505.
      const point = args as z.infer<typeof draftAssetPointSchema>;
      const problems = assetPointProblems(draft.assetPoints ?? [], [point], draft, ctx.templates.pointKeys);
      if (problems.length > 0) {
        return fail(problems[0]!.message);
      }
      const asset = draft.assets![point.assetIndex]!;
      return write(
        state,
        { assetPoints: [...(draft.assetPoints ?? []), point] },
        `Mapped ${quoteCell(point.sourceDataKey)} → ${quoteCell(point.pointKey)} on asset ${quoteCell(asset.code)}`,
      );
    }

    case "remove_asset_point": {
      const hit = removeAt(draft.assetPoints, (args as { index: number }).index);
      return hit
        ? write(state, { assetPoints: hit.rest }, `Removed mapping ${quoteCell(hit.removed.sourceDataKey)} → ${quoteCell(hit.removed.pointKey)}`)
        : fail("There is no mapping at that index.");
    }

    case "use_existing_point_keys": {
      const value = (args as { value: boolean }).value;
      if (value && ctx.templates.pointKeys.get("kw") === false) {
        return fail(EXISTING_KEYS_KW_INACTIVE_ERROR);
      }
      if (value && ctx.templates.pointKeys.get("kw") !== true) {
        return fail(EXISTING_KEYS_NEED_KW_ERROR);
      }
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
        // F4.192: with no field error, the phase is what holds the draft back,
        // so the refusal names it rather than ending on nothing.
        const phase = problem === null && shown.length === 0 ? `It is at the ${result.suggestedPhase} phase, not review.` : null;
        const reasons = [problem, ...shown.map((e) => `${e.path}: ${e.message}`), phase].filter(Boolean).join("; ");
        return fail(`The draft is not ready to commit. ${cutToBound(reasons, 2_000)}`);
      }
      const summary = commitSummary(draft, ctx.templates);
      state.pendingProposal = { summary };
      return succeed(
        { proposed: true, summary, next: "Tell the user to type `confirm commit` or use the Commit button. You cannot commit." },
        `Proposed commit: ${summary}`,
      );
    }

    case "suggest_replies": {
      // F3.25 (ADR 0094 decision 9): no action line and no write. The last call
      // wins; `agentReplies` filters the list before it reaches the client.
      const { replies } = args as z.infer<(typeof TOOL_SCHEMAS)["suggest_replies"]>;
      state.suggestedReplies = [...replies];
      return succeed({ replies });
    }
  }
}
