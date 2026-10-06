import { MAX_ONBOARDING_ASSET_POINTS, MAX_ONBOARDING_ASSETS, MAX_ONBOARDING_POINT_KEYS, MAX_ONBOARDING_RTUS } from "@bms/shared";

import {
  CREDENTIAL_TOOL_ERROR,
  EXISTING_KEYS_KW_INACTIVE_ERROR,
  EXISTING_KEYS_NEED_KW_ERROR,
  PROMPT_MARKER_TOOL_ERROR,
  runTool,
  type ToolContext,
  type ToolName,
  type ToolState,
} from "./onboarding-agent-tools";
import { DRAFT_TOO_DEEP_MESSAGE } from "./onboarding.schema";

/**
 * F3.27 (ADR 0090 Amendment 2 B4, B5) — the guided mode's one write path.
 *
 * Every guided draft write builds its arguments in code and runs them through
 * the registry's `runTool`, the call the agent loop makes. So the count caps,
 * the depth bound, the element schemas, the credential and prompt-marker
 * refusals and the code-written action line are the same on both paths. The
 * result is reduced to what a guided reply needs: the action line, or a
 * guided sentence for the refusal (`content` is never parsed back).
 */
export type GuidedWriteResult = { readonly ok: true; readonly actionLine: string } | { readonly ok: false; readonly error: string };

/** B4 — the guided answer to a credential refusal; it addresses the user, where `CREDENTIAL_TOOL_ERROR` addresses the model. */
export const GUIDED_CREDENTIAL_REFUSAL =
  "Credentials never go through this chat. Enter them in the **Credentials** field on the RTU step.";

/** B4 — the guided answer to an argument that carries the prompt-budget marker. */
export const GUIDED_MARKER_REFUSAL = "That text stands for a withheld value. Send the real value.";

/** B4 — the guided answer to a draft past the depth bound. */
export const GUIDED_DEPTH_REFUSAL =
  "The draft has settings nested too deeply to change in this chat. Open the preview and flatten the RTU, asset or location settings.";

/** B4 — the guided answer when `set_location`'s element schema refuses the name (a one-character or blank reply). */
export const GUIDED_LOCATION_NAME_REFUSAL = "A location name needs at least 2 characters.";

/** F3.23 (ADR 0092 decision 3) — the guided answer when "use existing keys" meets a catalog with no active `kw`. */
export const GUIDED_EXISTING_KEYS_REFUSAL = "The point-key catalog is not ready for this site. Say **kw** to declare the key in this draft.";

/**
 * F3.23 review — the guided answer when the catalog holds `kw` inactive. "Say **kw**" would loop: the
 * declaration lands, then auto map's `map_point` refuses the inactive key. Reactivation is the only way out.
 */
export const GUIDED_KW_INACTIVE_REFUSAL =
  "The point-key catalog holds **kw** as inactive, so this site cannot map it. Reactivate **kw** in Point Keys, then try again.";

/** B4 — the guided answer to any other element-schema refusal. */
export const GUIDED_SCHEMA_REFUSAL = "That value is not valid for this step. Open the preview to check the draft.";

/** B4 — the guided answer to a refusal this file does not classify: fail closed, never the raw text. */
export const GUIDED_OTHER_REFUSAL = "The draft cannot take this change. Open the preview to check the draft.";

/** B4 — the guided answer at a count cap: the cap itself, never the over-cap count the merged draft would hold. */
export function guidedCapRefusal(label: string, cap: number): string {
  return `The draft is at the limit of ${cap} ${label} that one onboarding session can commit. Commit this draft, then add the rest in a second session.`;
}

/** The array each guided append grows, for the cap sentence. */
const GUIDED_CAPS: Partial<Record<ToolName, { readonly label: string; readonly cap: number }>> = {
  add_rtu: { label: "RTUs", cap: MAX_ONBOARDING_RTUS },
  add_point_key: { label: "point keys", cap: MAX_ONBOARDING_POINT_KEYS },
  add_asset: { label: "assets", cap: MAX_ONBOARDING_ASSETS },
  map_point: { label: "asset points", cap: MAX_ONBOARDING_ASSET_POINTS },
};

/**
 * B4 — maps a registry refusal to the guided sentence for its class. The
 * registry's sentences are written for the model ("Tell the user ...",
 * zod issue text), so none of them reaches a guided reply.
 */
export function guidedRefusal(name: ToolName, error: string): string {
  if (error === CREDENTIAL_TOOL_ERROR) {
    return GUIDED_CREDENTIAL_REFUSAL;
  }
  if (error === PROMPT_MARKER_TOOL_ERROR) {
    return GUIDED_MARKER_REFUSAL;
  }
  if (error === DRAFT_TOO_DEEP_MESSAGE) {
    return GUIDED_DEPTH_REFUSAL;
  }
  if (error === EXISTING_KEYS_KW_INACTIVE_ERROR) {
    return GUIDED_KW_INACTIVE_REFUSAL;
  }
  if (error === EXISTING_KEYS_NEED_KW_ERROR) {
    return GUIDED_EXISTING_KEYS_REFUSAL;
  }
  if (error.startsWith("Invalid arguments: ")) {
    return name === "set_location" ? GUIDED_LOCATION_NAME_REFUSAL : GUIDED_SCHEMA_REFUSAL;
  }
  const cap = GUIDED_CAPS[name];
  if (cap && error.startsWith("The draft holds ")) {
    return guidedCapRefusal(cap.label, cap.cap);
  }
  return GUIDED_OTHER_REFUSAL;
}

/** Runs one guided write through the registry's `runTool`; a refusal comes back as its guided sentence (`guidedRefusal`). */
export async function guidedWrite(
  name: ToolName,
  args: Record<string, unknown>,
  state: ToolState,
  ctx: ToolContext,
): Promise<GuidedWriteResult> {
  const outcome = await runTool({ id: `guided-${name}`, name, arguments: JSON.stringify(args) }, state, ctx);
  return outcome.ok ? { ok: true, actionLine: outcome.actionLine ?? "" } : { ok: false, error: guidedRefusal(name, outcome.error ?? "") };
}

export type GuidedToolCoverage = { readonly mode: "guided" | "agent_only"; readonly reason: string };

const FIXED_PROMPTS = "the guided mode has fixed prompts";
const REMOVE_DEFERRED = "deferred, ADR 0090 Amendment 2";
const TEMPLATES_AGENT_ONLY = "B6 / ADR 0091 decision 11: templates are the Asset Templates editor's in guided mode";
const MAPPINGS_AGENT_ONLY =
  "F3.23 / ADR 0092 decision 6: bulk point keys and mappings are agent-only; the guided mode keeps its kw sample";

/**
 * ADR 0090 Amendment 2 B7 — every registry tool is either covered by a guided
 * branch or agent-only with a reason. `Record<ToolName, …>` makes a tool the
 * registry adds and this table omits a compile error; the coverage spec makes
 * it a test failure too.
 */
export const GUIDED_TOOL_COVERAGE: Readonly<Record<ToolName, GuidedToolCoverage>> = {
  set_location: { mode: "guided", reason: "the location step" },
  add_rtu: { mode: "guided", reason: "the RTU step" },
  update_rtu: { mode: "guided", reason: "the topic: turn (Amendment 2 Q-D)" },
  add_point_key: { mode: "guided", reason: "the point-key step" },
  add_asset: { mode: "guided", reason: "the asset step" },
  map_point: { mode: "guided", reason: "the mapping step (auto map)" },
  use_existing_point_keys: { mode: "guided", reason: "the use existing keys turn" },
  get_draft: { mode: "agent_only", reason: FIXED_PROMPTS },
  list_point_keys: { mode: "agent_only", reason: FIXED_PROMPTS },
  list_location_types: { mode: "agent_only", reason: FIXED_PROMPTS },
  list_protocols: { mode: "agent_only", reason: FIXED_PROMPTS },
  remove_rtu: { mode: "agent_only", reason: REMOVE_DEFERRED },
  remove_point_key: { mode: "agent_only", reason: REMOVE_DEFERRED },
  remove_asset: { mode: "agent_only", reason: REMOVE_DEFERRED },
  remove_asset_point: { mode: "agent_only", reason: REMOVE_DEFERRED },
  validate_draft: { mode: "agent_only", reason: "finalizeTurn validates every turn" },
  propose_commit: { mode: "agent_only", reason: "B3: the Commit button" },
  suggest_replies: { mode: "agent_only", reason: "ADR 0094 decision 9: the guided prompts carry their own replies" },
  list_templates: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  get_template: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  list_stock_templates: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  add_template: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  import_stock_template: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  remove_template: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  add_template_assets: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  add_point_keys: { mode: "agent_only", reason: MAPPINGS_AGENT_ONLY },
  map_points: { mode: "agent_only", reason: MAPPINGS_AGENT_ONLY },
  get_asset_points: { mode: "agent_only", reason: MAPPINGS_AGENT_ONLY },
};
