import type { OnboardingDraft } from "@bms/shared";

import { buildSystemPrompt, runAgentTurn } from "./onboarding-agent-loop";
import { calls, FakeLlmProvider, toolCall } from "./onboarding-agent-loop.spec";
import {
  CREDENTIAL_TOOL_ERROR,
  runTool,
  TOOL_DEFINITIONS,
  TOOL_LIST_MAX_ITEMS,
  TOOL_RESULT_CUT_TAIL,
  TOOL_RESULT_MAX_CHARS,
  type ToolContext,
  type ToolState,
} from "./onboarding-agent-tools";
import { commitSummary, MAX_COMMIT_SUMMARY_CHARS } from "./onboarding-commit-proposal";
import type { StockTemplateRef, TemplatePointRef, TemplateRef, ValidateTemplateContext } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function point(pointKey: string, pattern: string | null = null): TemplatePointRef {
  return { pointKey, kind: "measured", required: true, sourceDataKeyPattern: pattern };
}

function ref(code: string, version: number | null, status: TemplateRef["status"], points: TemplatePointRef[], name = code): TemplateRef {
  return { code, version, name, domain: "electrical", status, points, alarmCount: 0, dashboardWidgetCount: 0 };
}

function context(templates: ValidateTemplateContext): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [],
    catalog: { listPointKeys: async () => [] },
    protocols: { getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }), formatForAssistant: () => "" },
    validator: new OnboardingValidateService(),
    templates,
  };
}

async function run(name: string, args: unknown, templates: ValidateTemplateContext): Promise<{ ok: boolean; content: string; body: Record<string, unknown> }> {
  const state: ToolState = { working: {} };
  const out = await runTool({ id: "c1", name, arguments: JSON.stringify(args) }, state, context(templates));
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(out.content) as Record<string, unknown>;
  } catch {
    // a cut result is not JSON; the caller reads `content`
  }
  return { ok: out.ok, content: out.content, body };
}

const ORG: ValidateTemplateContext = {
  organization: [
    ref("METER", 1, "published", [point("kw")]),
    ref("METER", 2, "published", [point("kw", "{asset_code}-kw"), point("kvar", "{asset_code}-{phase}")]),
    ref("METER", 3, "draft", []),
    ref("DRAFT-ONLY", 1, "draft", []),
    ref("OLD", 1, "archived", []),
  ],
  stock: [ref("STOCK-A", null, null, [point("flow")], "Flow meter"), ref("STOCK-B", null, null, [point("level")], "Level probe")],
};

/** T21 (with the FORBIDDEN walk in `onboarding-agent-tools.spec.ts`, which covers every tool) */
export async function assertToolsAre24(): Promise<void> {
  assert(TOOL_DEFINITIONS.length === 24, `there are 24 tools, got ${TOOL_DEFINITIONS.length}`);
  for (const name of [
    "list_templates",
    "get_template",
    "list_stock_templates",
    "add_template",
    "import_stock_template",
    "remove_template",
    "add_template_assets",
  ]) {
    assert(TOOL_DEFINITIONS.some((t) => t.name === name), `${name} is registered`);
  }
}

/** R1 */
export async function assertListTemplatesIsPublishedOnlyWithHighestVersion(): Promise<void> {
  const out = await run("list_templates", {}, ORG);
  const items = out.body.templates as { code: string; version: number; domain: string; pointCount: number }[];
  assert(out.ok && items.length === 1, `one published code is listed, got ${out.content}`);
  assert(items[0]?.code === "METER" && items[0].version === 2, "the highest published version is named");
  assert(items[0]?.pointCount === 2 && items[0].domain === "electrical", "pointCount and domain come from that version");
  assert(!out.content.includes("DRAFT-ONLY") && !out.content.includes("OLD"), "draft-only and archived codes are excluded");
  const searched = await run("list_templates", { search: "zzz" }, ORG);
  assert((searched.body.templates as unknown[]).length === 0, "search filters codes");
}

/** R2 */
export async function assertListTemplatesIsBoundedAtOneHundred(): Promise<void> {
  const organization = Array.from({ length: TOOL_LIST_MAX_ITEMS + 1 }, (_, i) => ref(`T${String(i).padStart(3, "0")}`, 1, "published", [point("kw")]));
  const out = await run("list_templates", {}, { organization, stock: [] });
  assert((out.body.templates as unknown[]).length === TOOL_LIST_MAX_ITEMS, "100 are shown");
  assert(typeof out.body.more === "string" && out.body.more.includes("1"), `a more tail counts the rest, got ${String(out.body.more)}`);
}

/** R3 */
export async function assertGetTemplateByCodeReturnsPointsAndVariables(): Promise<void> {
  const out = await run("get_template", { code: "METER" }, ORG);
  const points = out.body.points as TemplatePointRef[];
  assert(out.ok && points.length === 2 && points[1]?.pointKey === "kvar", `highest published points, got ${out.content}`);
  assert(JSON.stringify(out.body.variables) === JSON.stringify(["phase"]), `variables are templateVariables, got ${JSON.stringify(out.body.variables)}`);
  assert(out.body.version === 2, "the version is named");
  const v1 = await run("get_template", { code: "METER", version: 1 }, ORG);
  assert((v1.body.points as unknown[]).length === 1, "a named version is honoured");
}

/** R4 */
export async function assertGetTemplateByStockCodeReturnsTheStockEntry(): Promise<void> {
  const out = await run("get_template", { stockCode: "STOCK-A" }, ORG);
  assert(out.ok && (out.body.points as { pointKey: string }[])[0]?.pointKey === "flow", `stock points, got ${out.content}`);
  assert(JSON.stringify(out.body.variables) === "[]", "variables are empty for a patternless stock entry");
}

/** R5 */
export async function assertGetTemplateUnknownCodeFailsNamingIt(): Promise<void> {
  const a = await run("get_template", { code: "NOPE" }, ORG);
  assert(!a.ok && String(a.body.error).includes("NOPE"), `names the code, got ${a.content}`);
  const b = await run("get_template", { stockCode: "NOPE-STOCK" }, ORG);
  assert(!b.ok && String(b.body.error).includes("NOPE-STOCK"), `names the stock code, got ${b.content}`);
  const c = await run("get_template", { code: "METER", stockCode: "STOCK-A" }, ORG);
  assert(!c.ok, "both keys together are refused");
  const d = await run("get_template", { code: "DRAFT-ONLY" }, ORG);
  assert(!d.ok, "a draft-only template is not readable");
}

/** R6 */
export async function assertListStockTemplatesFiltersCodeAndName(): Promise<void> {
  const all = await run("list_stock_templates", {}, ORG);
  const items = all.body.templates as { stockCode: string; name: string; domain: string; pointCount: number }[];
  assert(items.length === 2 && items[0]?.stockCode === "STOCK-A" && items[0].pointCount === 1, `every entry, got ${all.content}`);
  const byName = await run("list_stock_templates", { search: "probe" }, ORG);
  assert((byName.body.templates as { stockCode: string }[]).map((t) => t.stockCode).join() === "STOCK-B", "search matches the name");
  const byCode = await run("list_stock_templates", { search: "stock-a" }, ORG);
  assert((byCode.body.templates as unknown[]).length === 1, "search matches the code, case-insensitively");
}

/** R7 */
export async function assertABigTemplateResultIsCut(): Promise<void> {
  const points = Array.from({ length: 300 }, (_, i) => point(`point_${i}`, `{asset_code}-s${i}`));
  const out = await run("get_template", { code: "BIG" }, { organization: [ref("BIG", 1, "published", points)], stock: [] });
  assert(out.content.endsWith(TOOL_RESULT_CUT_TAIL), "a 300-point result ends with the fixed tail");
  assert(out.content.length <= TOOL_RESULT_MAX_CHARS + TOOL_RESULT_CUT_TAIL.length, "and is bounded");
}

// ---------------------------------------------------------------------------
// P4 — the four write tools, the bounds and the proposal (ADR 0091 decisions 3, 6, 7, 8, 9).
// Each refusal builds a call that breaks exactly one rule; the message names what broke it.

function optional(pointKey: string): TemplatePointRef {
  return { pointKey, kind: "measured", required: false, sourceDataKeyPattern: null };
}

function derived(pointKey: string): TemplatePointRef {
  return { pointKey, kind: "derived", required: false, sourceDataKeyPattern: null };
}

function stockRef(code: string, stockVersion: number, points: TemplatePointRef[]): StockTemplateRef {
  return { ...ref(code, null, null, points, `${code} stock`), domain: "water", stockVersion };
}

/** METER held in three versions; one stock entry with a required, an optional and a derived point. */
const WRITE: ValidateTemplateContext = {
  organization: [
    ref("METER", 1, "published", [point("kw", "{asset_code}-kw")]),
    ref("METER", 2, "published", [point("kw", "{asset_code}-kw"), point("kvar", "{asset_code}-{phase}")]),
    ref("METER", 3, "draft", []),
  ],
  stock: [stockRef("WTP-PUMP", 3, [point("flow"), optional("level"), derived("efficiency")])],
};

const RTU = {
  code: "RTU-1",
  displayName: "RTU-1",
  protocol: "mqtt" as const,
  config: { host: "broker", port: 8883, tls: true, topic: "a/b" },
  credentialsSet: false,
  ingestEnabled: false,
};

/** A ready draft: one location, one RTU (ingest off), one point key, one plain asset and its mapping. */
function baseDraft(extra: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", latitude: 20.1, longitude: 85.1, type: "smoc_campus" },
    rtus: [RTU],
    pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }],
    assets: [{ rtuIndex: 0, code: "BERHAMPUR-ASSET-1", name: "Meter", siteName: "Berhampur", domain: "electrical" }],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s01", unit: "kW" }],
    ...extra,
  } as OnboardingDraft;
}

/** An authored template with one required point whose pattern needs the variable `ch`. */
const CHILLER = {
  code: "CHILLER",
  name: "Chiller",
  domain: "hvac",
  points: [{ pointKey: "kw", sourceDataKeyPattern: "{asset_code}-{ch}" }],
};

function chillerAsset(code: string, vars?: Record<string, string>) {
  return { code, name: `Chiller ${code}`, siteName: "Berhampur", ...(vars ? { sourceDataKeyVars: vars } : {}) };
}

function writeContext(templates: ValidateTemplateContext): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }],
    catalog: { listPointKeys: async () => [{ code: "energy_kwh", name: "Energy", unit: "kWh", domain: "electrical" }] },
    protocols: { getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }), formatForAssistant: () => "" },
    validator: new OnboardingValidateService(),
    templates,
  };
}

async function runOn(
  name: string,
  args: unknown,
  draft: OnboardingDraft,
  templates: ValidateTemplateContext = WRITE,
): Promise<{ ok: boolean; content: string; error: string; actionLine?: string; state: ToolState }> {
  const state: ToolState = { working: draft };
  const out = await runTool({ id: "c1", name, arguments: JSON.stringify(args) }, state, writeContext(templates));
  const body = JSON.parse(out.content) as { error?: string };
  return { ok: out.ok, content: out.content, error: String(body.error ?? ""), actionLine: out.actionLine, state };
}

/** T1 */
export async function assertT1AddTemplateAppendsAnAuthoredEntry(): Promise<void> {
  const out = await runOn("add_template", CHILLER, baseDraft());
  const entry = out.state.working.templates?.[0];
  assert(out.ok && out.state.working.templates?.length === 1, `one entry is appended, got ${out.content}`);
  assert(entry !== undefined && "code" in entry && entry.code === "CHILLER" && entry.points.length === 1, "the entry is the authored body");
  assert(out.actionLine === "Added template CHILLER (1 point)", `the action line is code-written: ${out.actionLine}`);
}

/** T2 */
export async function assertT2AddTemplateRefusesACodeTheDraftHolds(): Promise<void> {
  const out = await runOn("add_template", { ...CHILLER, name: "Second" }, baseDraft({ templates: [CHILLER] }));
  assert(!out.ok && out.error.includes("'CHILLER'") && out.error.includes("already in this draft"), `refused, got ${out.content}`);
  assert(out.state.working.templates?.length === 1, "the draft keeps one entry");
}

/** T3 */
export async function assertT3AddTemplateRefusesACodeTheOrganizationHoldsNamingTheVersions(): Promise<void> {
  const out = await runOn("add_template", { ...CHILLER, code: "METER" }, baseDraft());
  assert(!out.ok && out.error.includes("'METER'") && out.error.includes("1, 2, 3"), `refused naming every version, got ${out.content}`);
  assert(out.state.working.templates === undefined, "nothing is written");
}

/** T4 */
export async function assertT4AddTemplateRefusesAnUnknownPointKey(): Promise<void> {
  const out = await runOn("add_template", { ...CHILLER, points: [{ pointKey: "kw" }, { pointKey: "nope_key" }] }, baseDraft());
  assert(!out.ok && out.error.includes("'nope_key'") && !out.error.includes("'kw'"), `refused naming the unknown key only, got ${out.content}`);
}

/** T4, positive sibling: a draft point key and a catalog point key are both accepted. */
export async function assertT4AddTemplateAcceptsADraftAndACatalogPointKey(): Promise<void> {
  const out = await runOn("add_template", { ...CHILLER, points: [{ pointKey: "kw" }, { pointKey: "energy_kwh" }] }, baseDraft());
  assert(out.ok && out.actionLine === "Added template CHILLER (2 points)", `accepted, got ${out.content}`);
}

/** T5 */
export async function assertT5AddTemplateRefusesABadPatternGrammar(): Promise<void> {
  const out = await runOn("add_template", { ...CHILLER, points: [{ pointKey: "kw", sourceDataKeyPattern: "CH{unit_FLOW" }] }, baseDraft());
  assert(!out.ok && out.error.includes("'CH{unit_FLOW'") && out.error.includes("brace outside"), `refused, got ${out.content}`);
}

/** T6 (label) */
export async function assertT6AddTemplateRefusesACredentialLookingLabel(): Promise<void> {
  const out = await runOn("add_template", { ...CHILLER, points: [{ pointKey: "kw", label: "password: hunter2" }] }, baseDraft());
  assert(!out.ok && out.error === CREDENTIAL_TOOL_ERROR, `refused as a credential, got ${out.content}`);
  assert(out.state.working.templates === undefined, "nothing is written");
}

/** T6 (pattern) */
export async function assertT6AddTemplateRefusesACredentialLookingPattern(): Promise<void> {
  const out = await runOn("add_template", { ...CHILLER, points: [{ pointKey: "kw", sourceDataKeyPattern: "password: hunter2" }] }, baseDraft());
  assert(!out.ok && out.error === CREDENTIAL_TOOL_ERROR, `refused as a credential, got ${out.content}`);
}

/** T6 (import_stock_template's `patterns`) */
export async function assertT6ImportStockTemplateRefusesACredentialLookingPattern(): Promise<void> {
  const out = await runOn("import_stock_template", { stockCode: "WTP-PUMP", patterns: { flow: "password: hunter2" } }, baseDraft());
  assert(!out.ok && out.error === CREDENTIAL_TOOL_ERROR, `refused as a credential, got ${out.content}`);
}

/** T7 */
export async function assertT7ImportStockTemplateAppendsAStockEntry(): Promise<void> {
  const out = await runOn("import_stock_template", { stockCode: "WTP-PUMP", patterns: { flow: "{asset_code}-flow" } }, baseDraft());
  assert(out.ok, `imported, got ${out.content}`);
  assert(
    JSON.stringify(out.state.working.templates) === JSON.stringify([{ stockCode: "WTP-PUMP", patterns: { flow: "{asset_code}-flow" } }]),
    `the stock entry is written, got ${JSON.stringify(out.state.working.templates)}`,
  );
  assert(out.actionLine === "Imported stock template WTP-PUMP v3 (3 points)", `the action line: ${out.actionLine}`);
}

/** T8 */
export async function assertT8ImportStockTemplateRefusesAnUnknownCodeNamingTheAvailableOnes(): Promise<void> {
  const out = await runOn("import_stock_template", { stockCode: "NOPE" }, baseDraft());
  assert(!out.ok && out.error.includes("'NOPE'") && out.error.includes("'WTP-PUMP'"), `refused naming the codes, got ${out.content}`);
}

/** Decision 6 at the import call site: a stock code the organization already holds is refused, naming the versions. */
export async function assertT8ImportStockTemplateRefusesACodeTheOrganizationHolds(): Promise<void> {
  const held: ValidateTemplateContext = { ...WRITE, organization: [ref("WTP-PUMP", 4, "published", [point("flow", "x")])] };
  const out = await runOn("import_stock_template", { stockCode: "WTP-PUMP" }, baseDraft(), held);
  assert(!out.ok && out.error.includes("'WTP-PUMP'") && out.error.includes("versions: 4"), `refused, got ${out.content}`);
}

/** T9 */
export async function assertT9ImportStockTemplateRefusesAPatternKeyThatIsNoMeasuredPoint(): Promise<void> {
  const out = await runOn("import_stock_template", { stockCode: "WTP-PUMP", patterns: { flow: "{asset_code}-f", efficiency: "{asset_code}-e" } }, baseDraft());
  assert(!out.ok && out.error.includes("'efficiency'") && out.error.includes("not a measured point"), `refused, got ${out.content}`);
  assert(!out.error.includes("'flow'"), "the measured key is not named");
}

/** T9 (grammar of a `patterns` value) */
export async function assertT9ImportStockTemplateRefusesABadPatternGrammar(): Promise<void> {
  const out = await runOn("import_stock_template", { stockCode: "WTP-PUMP", patterns: { flow: "F{x" } }, baseDraft());
  assert(!out.ok && out.error.includes("'F{x'") && out.error.includes("brace outside"), `refused, got ${out.content}`);
}

/** T10 (refused while referenced) */
export async function assertT10RemoveTemplateIsRefusedWhileAnAssetReferencesIt(): Promise<void> {
  const draft = baseDraft({ templates: [CHILLER] });
  draft.assets!.push({ rtuIndex: 0, code: "CH-1", name: "Chiller 1", siteName: "Berhampur", domain: "hvac", template: { code: "CHILLER" } });
  const out = await runOn("remove_template", { code: "CHILLER" }, draft);
  assert(!out.ok && out.error.includes("'CH-1'") && !out.error.includes("'BERHAMPUR-ASSET-1'"), `refused naming the asset, got ${out.content}`);
  assert(out.state.working.templates?.length === 1, "the template stays");
}

/** T10 (allowed otherwise) */
export async function assertT10RemoveTemplateRemovesAnUnreferencedTemplate(): Promise<void> {
  const out = await runOn("remove_template", { code: "CHILLER" }, baseDraft({ templates: [CHILLER] }));
  assert(out.ok && out.state.working.templates?.length === 0, `removed, got ${out.content}`);
  assert(out.actionLine === "Removed template CHILLER", `the action line: ${out.actionLine}`);
}

/** T10 (a code the draft does not hold) */
export async function assertT10RemoveTemplateRefusesAnUnknownCode(): Promise<void> {
  const out = await runOn("remove_template", { code: "NOPE" }, baseDraft({ templates: [CHILLER] }));
  assert(!out.ok && out.error.includes("'NOPE'"), `refused naming it, got ${out.content}`);
}

/** T11 */
export async function assertT11AddTemplateAssetsAppendsTemplatedAssets(): Promise<void> {
  const args = { code: "CHILLER", rtuIndex: 0, assets: [chillerAsset("CH-1", { ch: "1" }), chillerAsset("CH-2", { ch: "2" })] };
  const out = await runOn("add_template_assets", args, baseDraft({ templates: [CHILLER] }));
  const added = (out.state.working.assets ?? []).slice(1);
  assert(out.ok && added.length === 2, `two assets are appended, got ${out.content}`);
  assert(added.every((asset) => asset.rtuIndex === 0 && asset.domain === "hvac"), "each is on the RTU, in the template's domain");
  assert(
    JSON.stringify(added[1]?.template) === JSON.stringify({ code: "CHILLER", sourceDataKeyVars: { ch: "2" } }),
    `the template ref carries the code and the variables, got ${JSON.stringify(added[1]?.template)}`,
  );
  assert(out.actionLine === "Added 2 assets from CHILLER v1 on RTU-1", `the action line: ${out.actionLine}`);
}

/** T12 (no version given: the highest published) */
export async function assertT12AddTemplateAssetsPinsTheHighestPublishedVersion(): Promise<void> {
  const out = await runOn("add_template_assets", { code: "METER", rtuIndex: 0, assets: [chillerAsset("M-1", { phase: "a" })] }, baseDraft());
  const template = out.state.working.assets?.[1]?.template;
  assert(out.ok && template?.version === 2, `version 2 is written, got ${out.content}`);
  assert(out.actionLine === "Added 1 asset from METER v2 on RTU-1", `the action line: ${out.actionLine}`);
}

/** T12 (a named version) */
export async function assertT12AddTemplateAssetsPinsTheNamedVersion(): Promise<void> {
  const out = await runOn("add_template_assets", { code: "METER", version: 1, rtuIndex: 0, assets: [chillerAsset("M-1")] }, baseDraft());
  assert(out.ok && out.state.working.assets?.[1]?.template?.version === 1, `version 1 is written, got ${out.content}`);
}

/** T13 */
export async function assertT13AddTemplateAssetsRefusesAMissingRtu(): Promise<void> {
  const out = await runOn("add_template_assets", { code: "CHILLER", rtuIndex: 5, assets: [chillerAsset("CH-1", { ch: "1" })] }, baseDraft({ templates: [CHILLER] }));
  assert(!out.ok && out.error.includes("index 5"), `refused naming the index, got ${out.content}`);
  assert(out.state.working.assets?.length === 1, "nothing is written");
}

/** T14 (V6 at tool time) */
export async function assertT14AddTemplateAssetsRefusesAnUnresolvedVariable(): Promise<void> {
  const out = await runOn("add_template_assets", { code: "CHILLER", rtuIndex: 0, assets: [chillerAsset("CH-1")] }, baseDraft({ templates: [CHILLER] }));
  assert(!out.ok && out.error.includes("'ch'") && out.error.includes("'CH-1'"), `refused naming the variable and the asset, got ${out.content}`);
}

/** T14 (V6 at tool time, code review): a key the instantiate core would refuse as over 128 characters (4 + 1 + 128). */
export async function assertT14AddTemplateAssetsRefusesAKeyOverTheLengthLimit(): Promise<void> {
  const draft = baseDraft({ templates: [CHILLER] });
  const out = await runOn("add_template_assets", { code: "CHILLER", rtuIndex: 0, assets: [chillerAsset("CH-1", { ch: "c".repeat(128) })] }, draft);
  assert(
    !out.ok && out.error.includes("'CH-1'") && out.error.includes("133 characters, over the 128 limit"),
    `refused naming the asset and the length, got ${out.content}`,
  );
  assert(out.state.working.assets?.length === 1, "nothing is written");
}

/** T14 (V5 at tool time, owner ruling Q1-C): a required measured point with no pattern. */
export async function assertT14AddTemplateAssetsRefusesARequiredPointWithNoPattern(): Promise<void> {
  const out = await runOn("add_template_assets", { code: "WTP-PUMP", rtuIndex: 0, assets: [chillerAsset("P-1")] }, baseDraft({ templates: [{ stockCode: "WTP-PUMP" }] }));
  assert(!out.ok && out.error.includes("'flow'") && out.error.includes("no source-key pattern"), `refused naming the point, got ${out.content}`);
}

/** T15 (V7 at tool time): a grammatical key that is no variable of the template. */
export async function assertT15AddTemplateAssetsRefusesAVariableTheTemplateDoesNotAskFor(): Promise<void> {
  const out = await runOn(
    "add_template_assets",
    { code: "CHILLER", rtuIndex: 0, assets: [chillerAsset("CH-1", { ch: "1", phase2: "x" })] },
    baseDraft({ templates: [CHILLER] }),
  );
  assert(!out.ok && out.error.includes("'phase2'") && out.error.includes("'ch'"), `refused naming the key and the variables, got ${out.content}`);
}

/** T16 */
export async function assertT16AddTemplateAssetsRefusesACredentialLookingValue(): Promise<void> {
  const out = await runOn(
    "add_template_assets",
    { code: "CHILLER", rtuIndex: 0, assets: [chillerAsset("CH-1", { ch: "password: hunter2" })] },
    baseDraft({ templates: [CHILLER] }),
  );
  assert(!out.ok && out.error === CREDENTIAL_TOOL_ERROR, `refused as a credential, got ${out.content}`);
}

/** T17 */
export async function assertT17ABatchOver200IsASchemaRefusal(): Promise<void> {
  const assets = Array.from({ length: 201 }, (_, i) => chillerAsset(`CH-${i}`, { ch: String(i) }));
  const out = await runOn("add_template_assets", { code: "CHILLER", rtuIndex: 0, assets }, baseDraft({ templates: [CHILLER] }));
  assert(!out.ok && out.error.startsWith("Invalid arguments") && out.error.includes("assets"), `a schema refusal, got ${out.content}`);
}

/** T18 */
export async function assertT18RemoveAssetRemovesATemplatedAsset(): Promise<void> {
  const draft = baseDraft({ templates: [CHILLER] });
  draft.assets!.push({ rtuIndex: 0, code: "CH-1", name: "Chiller 1", siteName: "Berhampur", domain: "hvac", template: { code: "CHILLER", sourceDataKeyVars: { ch: "1" } } });
  const out = await runOn("remove_asset", { index: 1 }, draft);
  assert(out.ok && out.state.working.assets?.length === 1, `removed, got ${out.content}`);
  assert(out.actionLine === "Removed asset CH-1", `the action line: ${out.actionLine}`);
}

/** T19 */
export async function assertT19ProposeCommitNamesThePublishAndTheCounts(): Promise<void> {
  const chiller = { ...CHILLER, domain: "electrical" };
  const draft = baseDraft({ templates: [chiller] });
  for (const code of ["CH-1", "CH-2"]) {
    draft.assets!.push({ rtuIndex: 0, code, name: `Chiller ${code}`, siteName: "Berhampur", domain: "electrical", template: { code: "CHILLER", sourceDataKeyVars: { ch: code } } });
  }
  const out = await runOn("propose_commit", {}, draft);
  const summary = out.state.pendingProposal?.summary ?? "";
  assert(out.ok, `proposed, got ${out.content}`);
  for (const part of [
    "1 template: will publish CHILLER v1 (cannot be edited afterwards), 1 point",
    "2 templated assets",
    "2 asset points",
    "0 seeded rules",
    "0 dashboard widgets",
  ]) {
    assert(summary.includes(part), `the summary holds "${part}", got ${summary}`);
  }
  assert(out.actionLine === `Proposed commit: ${summary}`, "the action line is the summary");
}

/** T20 */
export function assertT20TheSummaryAtTheCapsIsBounded(): void {
  const code = (i: number) => `T${String(i).padStart(2, "0")}`.padEnd(64, "X");
  const points = Array.from({ length: 200 }, (_, j) => ({ pointKey: `p${j}`, sourceDataKeyPattern: `{asset_code}-${j}` }));
  const templates = Array.from({ length: 50 }, (_, i) => ({ code: code(i), name: "N", domain: "electrical", points }));
  const assets = Array.from({ length: 200 }, (_, i) => ({
    rtuIndex: 0,
    code: `A-${i}`,
    name: "Asset",
    siteName: "Site",
    domain: "electrical",
    template: { code: code(i % 50) },
  }));
  const rtus = Array.from({ length: 100 }, (_, i) => ({ ...RTU, code: `R${i}`.padEnd(64, "Y") }));
  const draft = baseDraft({ templates, assets, rtus, assetPoints: [] });
  draft.location = { ...draft.location!, name: "L".repeat(300) };
  const summary = commitSummary(draft, WRITE);
  assert(summary.length <= MAX_COMMIT_SUMMARY_CHARS, `the summary fits the stored bound (${summary.length})`);
  assert(summary.includes("50 templates:") && summary.includes("…and 40 more templates"), "ten templates are named and the rest counted");
  assert(summary.includes("200 templated assets") && summary.includes("40000 asset points"), `the counts are true, got ${summary.slice(-120)}`);
}

/** T22 — the 8-call claim: a whole stock scenario in one turn. */
export async function assertT22AStockScenarioFinishesUnderTheCallCap(): Promise<void> {
  const pumps = ["PUMP-1", "PUMP-2"].map((code, i) => ({ code, name: `Pump ${i + 1}`, siteName: "Berhampur", sourceDataKeyVars: { ch: String(i + 1) } }));
  const llm = new FakeLlmProvider([
    calls(toolCall("list_stock_templates", {})),
    calls(toolCall("get_template", { stockCode: "WTP-PUMP" })),
    calls(toolCall("import_stock_template", { stockCode: "WTP-PUMP", patterns: { flow: "{asset_code}-{ch}" } })),
    calls(toolCall("add_template_assets", { code: "WTP-PUMP", rtuIndex: 0, assets: pumps })),
    calls(toolCall("validate_draft", {})),
    calls(toolCall("propose_commit", {})),
    { kind: "final", text: "Proposed." },
  ]);
  const result = await runAgentTurn({
    message: "Import the pump template and put two pumps on RTU-1",
    draft: baseDraft(),
    phase: "review",
    orgName: "Ion Exchange",
    history: [],
    llm,
    tools: writeContext(WRITE),
  });
  assert(result.stopReason === "final" && result.record.toolCalls === 6, `final after 6 calls, got ${result.stopReason}/${result.record.toolCalls}`);
  assert(
    result.commitProposal?.summary.includes("will publish WTP-PUMP v1 (cannot be edited afterwards), 3 points") === true,
    `a proposal names the publish, got ${result.commitProposal?.summary}`,
  );
  assert(result.actionLines.includes("Added 2 assets from WTP-PUMP v1 on RTU-1"), `the assets were added, got ${result.actionLines.join(" | ")}`);
}

/** T23 */
export function assertT23TheSystemPromptNamesTheTemplateTools(): void {
  const prompt = buildSystemPrompt({ orgName: "Ion Exchange", phase: "assets", typeCodes: ["smoc_campus"], draft: {} });
  assert(prompt.includes("get_template") && prompt.includes("add_template_assets"), "the prompt names get_template and add_template_assets");
}

/** T19 (the counts): an asset point per measured point whose pattern resolves; rules and widget rows per asset. */
export function assertT19TheCountsReadTheTemplatePerAsset(): void {
  const pump = { ...ref("PUMP", 1, "published", [point("kw", "{asset_code}-kw"), point("kvar", "{asset_code}-{phase}"), derived("eff")]), alarmCount: 2, dashboardWidgetCount: 3 };
  const draft = baseDraft();
  for (const code of ["P-1", "P-2"]) {
    draft.assets!.push({ rtuIndex: 0, code, name: "Pump", siteName: "Berhampur", domain: "electrical", template: { code: "PUMP", version: 1 } });
  }
  const summary = commitSummary(draft, { organization: [pump], stock: [] });
  for (const part of ["2 templated assets", "2 asset points", "4 seeded rules", "6 dashboard widgets"]) {
    assert(summary.includes(part), `the summary holds "${part}", got ${summary}`);
  }
  assert(!summary.includes("will publish"), "a draft with no template entry publishes nothing");
}

/** T19 (the counts, code review): a point whose key resolves over 128 characters is not counted as an asset point. */
export function assertT19TheCountsSkipAKeyOverTheLengthLimit(): void {
  const pump = ref("PUMP", 1, "published", [point("kw", "{asset_code}-kw"), point("kvar", "{asset_code}-{phase}")]);
  const draft = baseDraft();
  const vars = { phase: "p".repeat(128) };
  draft.assets!.push({ rtuIndex: 0, code: "P-1", name: "Pump", siteName: "Berhampur", domain: "electrical", template: { code: "PUMP", version: 1, sourceDataKeyVars: vars } });
  const summary = commitSummary(draft, { organization: [pump], stock: [] });
  assert(summary.includes("1 templated asset") && summary.includes("1 asset point"), `only kw counts, got ${summary}`);
}
