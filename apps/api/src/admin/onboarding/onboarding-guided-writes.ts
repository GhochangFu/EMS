import { runTool, type ToolContext, type ToolName, type ToolState } from "./onboarding-agent-tools";

/**
 * F3.27 (ADR 0090 Amendment 2 B4, B5) — the guided mode's one write path.
 *
 * Every guided draft write builds its arguments in code and runs them through
 * the registry's `runTool`, the call the agent loop makes. So the count caps,
 * the depth bound, the element schemas, the credential and prompt-marker
 * refusals and the code-written action line are the same on both paths. The
 * result is reduced to what a guided reply needs: the action line, or the
 * refusal's sentence (`ToolOutcome.error` — `content` is never parsed back).
 */
export type GuidedWriteResult = { readonly ok: true; readonly actionLine: string } | { readonly ok: false; readonly error: string };

export async function guidedWrite(
  name: ToolName,
  args: Record<string, unknown>,
  state: ToolState,
  ctx: ToolContext,
): Promise<GuidedWriteResult> {
  const outcome = await runTool({ id: `guided-${name}`, name, arguments: JSON.stringify(args) }, state, ctx);
  return outcome.ok ? { ok: true, actionLine: outcome.actionLine ?? "" } : { ok: false, error: outcome.error ?? "The tool failed." };
}

export type GuidedToolCoverage = { readonly mode: "guided" | "agent_only"; readonly reason: string };

const FIXED_PROMPTS = "the guided mode has fixed prompts";
const REMOVE_DEFERRED = "deferred, ADR 0090 Amendment 2";
const TEMPLATES_AGENT_ONLY = "B6 / ADR 0091 decision 11: templates are the Asset Templates editor's in guided mode";

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
  list_templates: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  get_template: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  list_stock_templates: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  add_template: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  import_stock_template: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  remove_template: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
  add_template_assets: { mode: "agent_only", reason: TEMPLATES_AGENT_ONLY },
};
