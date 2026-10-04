import { runTool, TOOL_DEFINITIONS, TOOL_LIST_MAX_ITEMS, TOOL_RESULT_CUT_TAIL, TOOL_RESULT_MAX_CHARS, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import type { TemplatePointRef, TemplateRef, ValidateTemplateContext } from "./onboarding-template-refs";
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

export async function assertToolsAre20(): Promise<void> {
  assert(TOOL_DEFINITIONS.length === 20, `there are 20 tools, got ${TOOL_DEFINITIONS.length}`);
  for (const name of ["list_templates", "get_template", "list_stock_templates"]) {
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
