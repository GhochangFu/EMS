import type { OnboardingDraft, OnboardingDraftAssetPoint, OnboardingDraftPointKey } from "@bms/shared";

import { CREDENTIAL_TOOL_ERROR, runTool, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import { COMMIT_UNIQUE_CONFLICTS } from "./onboarding-commit-conflict";
import { draftCountProblem } from "./onboarding-draft-caps";
import { MAX_ASSET_POINTS_PER_CALL, MAX_POINT_KEYS_PER_CALL } from "./onboarding-mapping-tools";
import { pointKeyConflictMessage } from "./onboarding-point-key-conflict";
import { EMPTY_TEMPLATE_CONTEXT, unresolvedPointKey, type ValidateTemplateContext } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F3.23` U3 (ADR 0092 decision 4) — `add_point_keys`, `map_points` and
 * `get_asset_points`, driven through `runTool` so the credential walk, the
 * schema and the dispatch all run. One exported claim per `it()`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A fleet catalog that holds `kw` active, as the global seed does. */
const KW_ACTIVE: ValidateTemplateContext = { ...EMPTY_TEMPLATE_CONTEXT, pointKeys: new Map([["kw", true]]) };

function context(templates: ValidateTemplateContext = KW_ACTIVE): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }],
    catalog: { listPointKeys: async () => [], listInUsePointKeys: async () => new Set<string>() },
    protocols: {
      getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }),
      formatForAssistant: () => "MQTT",
    },
    validator: new OnboardingValidateService(),
    templates,
    inventory: { listExisting: async () => ({ rows: [], total: 0 }) },
  };
}

const ASSET_CODE = "BERHAMPUR-ASSET-1";

/** One RTU, two plain assets, no point keys and no mappings. */
function baseDraft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", latitude: 20.1, longitude: 85.1, type: "smoc_campus" },
    rtus: [{ code: "RTU-1", displayName: "RTU-1", protocol: "mqtt", credentialsSet: false, ingestEnabled: false, config: { host: "broker" } }],
    assets: [
      { rtuIndex: 0, code: ASSET_CODE, name: "Meter", siteName: "Berhampur", domain: "electrical" },
      { rtuIndex: 0, code: "BERHAMPUR-ASSET-2", name: "Meter 2", siteName: "Berhampur", domain: "electrical" },
    ],
    pointKeys: [],
    assetPoints: [],
    ...overrides,
  } as OnboardingDraft;
}

function key(code: string, extra: Partial<OnboardingDraftPointKey> = {}): OnboardingDraftPointKey {
  return { code, name: `Key ${code}`, ...extra };
}

function call(name: string, args: unknown): { id: string; name: string; arguments: string } {
  return { id: "c1", name, arguments: JSON.stringify(args) };
}

function parsed(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

function snapshot(state: ToolState): string {
  return JSON.stringify(state.working);
}

const DUPLICATE_SOURCE = COMMIT_UNIQUE_CONFLICTS.get("asset_points_asset_source_key_idx")!.message;

// ---------------------------------------------------------------- add_point_keys

/** K1 — three keys append in order; the result and the line name the two the catalog lacks. */
export async function assertK1AddPointKeysAppendsInOrderAndNamesTheNewOnes(): Promise<void> {
  const state: ToolState = { working: baseDraft({ pointKeys: [key("v")] }) };
  const out = await runTool(call("add_point_keys", { keys: [key("kw"), key("kvar"), key("pf")] }), state, context());
  assert(out.ok, `the call succeeds: ${out.content}`);
  assert(
    JSON.stringify(state.working.pointKeys?.map((k) => k.code)) === JSON.stringify(["v", "kw", "kvar", "pf"]),
    "the keys append after the declared one, in order",
  );
  const result = parsed(out.content);
  assert(result.added === 3, "the result counts three keys");
  assert(JSON.stringify(result.newToCatalog) === JSON.stringify(["kvar", "pf"]), "newToCatalog names the two the catalog lacks");
  assert(
    out.actionLine === "Added 3 point keys: 'kw', 'kvar', 'pf' (2 new to the catalog)",
    `the action line is code-written: ${out.actionLine}`,
  );
}

/** K2 — a code repeated in the batch refuses every key. */
export async function assertK2ARepeatedCodeRefusesTheBatch(): Promise<void> {
  const state: ToolState = { working: baseDraft() };
  const before = snapshot(state);
  const out = await runTool(call("add_point_keys", { keys: [key("kvar"), key("pf"), key("kvar")] }), state, context());
  assert(!out.ok, "the call is refused");
  assert(out.error === "keys.2: Point key 'kvar' appears more than once in this call", `the refusal names the repeat: ${out.error}`);
  assert(snapshot(state) === before, "nothing is written");
}

/** K3 — a code the draft already declares refuses the batch. */
export async function assertK3AnAlreadyDeclaredCodeRefusesTheBatch(): Promise<void> {
  const state: ToolState = { working: baseDraft({ pointKeys: [key("pf")] }) };
  const before = snapshot(state);
  const out = await runTool(call("add_point_keys", { keys: [key("kvar"), key("pf")] }), state, context());
  assert(!out.ok, "the call is refused");
  assert(out.error === "keys.1: Point key 'pf' is already declared in this draft", `the refusal names the declared key: ${out.error}`);
  assert(snapshot(state) === before, "nothing is written");
}

/** K4 — a code the catalog holds inactive refuses with the validator's sentence. */
export async function assertK4AnInactiveCatalogCodeRefusesTheBatch(): Promise<void> {
  const catalog = new Map([
    ["kw", true],
    ["old", false],
  ]);
  const state: ToolState = { working: baseDraft() };
  const before = snapshot(state);
  const out = await runTool(call("add_point_keys", { keys: [key("kvar"), key("old")] }), state, context({ ...KW_ACTIVE, pointKeys: catalog }));
  const sentence = unresolvedPointKey("old", new Set(["kvar", "old"]), catalog);
  assert(sentence !== null && sentence.includes("inactive"), "control: the sentence is the inactive one");
  assert(!out.ok && out.error === `keys.1: ${sentence}`, `the refusal is the unresolvedPointKey sentence: ${out.error}`);
  assert(snapshot(state) === before, "nothing is written");
}

/** K5 — one key past the per-call bound is a schema refusal. */
export async function assertK5OneKeyPastTheBoundIsASchemaRefusal(): Promise<void> {
  const keys = Array.from({ length: MAX_POINT_KEYS_PER_CALL + 1 }, (_, i) => key(`n${i}`));
  const state: ToolState = { working: baseDraft() };
  const out = await runTool(call("add_point_keys", { keys }), state, context());
  assert(!out.ok && (out.error ?? "").startsWith("Invalid arguments: keys"), `101 keys are invalid arguments: ${out.error}`);
  assert((state.working.pointKeys?.length ?? 0) === 0, "nothing is written");
}

/** K5 — 100 keys onto a draft of 450 meet the draft cap through `write()`. */
export async function assertK5TheDraftCapBindsThroughWrite(): Promise<void> {
  const existing = Array.from({ length: 450 }, (_, i) => key(`e${i}`));
  const keys = Array.from({ length: MAX_POINT_KEYS_PER_CALL }, (_, i) => key(`n${i}`));
  const state: ToolState = { working: baseDraft({ pointKeys: existing }) };
  const out = await runTool(call("add_point_keys", { keys }), state, context());
  const expected = draftCountProblem({ pointKeys: [...existing, ...keys] });
  assert(expected !== null, "control: 550 keys exceed the draft cap");
  assert(!out.ok && out.error === expected, `the refusal is the draft-cap sentence: ${out.error}`);
  assert(state.working.pointKeys?.length === 450, "nothing is written");
}

/** K6 — a credential-looking description refuses the call (CREDENTIAL_CHECKED_TOOLS). */
export async function assertK6ACredentialInAKeyIsRefused(): Promise<void> {
  const state: ToolState = { working: baseDraft() };
  const out = await runTool(call("add_point_keys", { keys: [key("kvar", { description: "password: hunter2" })] }), state, context());
  assert(!out.ok && out.error === CREDENTIAL_TOOL_ERROR, `the credential walk refuses the call: ${out.error}`);
  assert((state.working.pointKeys?.length ?? 0) === 0, "nothing is written");
}

// ---------------------------------------------------------------- map_points

/** Forty distinct keys: `kw` (catalog) and `k1..k39` (declared). */
const FORTY_KEYS = Array.from({ length: 39 }, (_, i) => key(`k${i + 1}`));

function row(i: number, pointKey: string): Omit<OnboardingDraftAssetPoint, "assetIndex"> {
  return { pointKey, sourceDataKey: `s${String(i + 1).padStart(2, "0")}` };
}

function fortyRows(): Omit<OnboardingDraftAssetPoint, "assetIndex">[] {
  return Array.from({ length: 40 }, (_, i) => row(i, i === 0 ? "kw" : `k${i}`));
}

/** P1 — forty rows append on the call's asset; the line names ten and counts the rest. */
export async function assertP1MapPointsAppendsAndBoundsTheLine(): Promise<void> {
  const state: ToolState = { working: baseDraft({ pointKeys: FORTY_KEYS }) };
  const out = await runTool(call("map_points", { assetIndex: 0, points: fortyRows() }), state, context());
  assert(out.ok, `the call succeeds: ${out.content}`);
  assert(state.working.assetPoints?.length === 40, "forty rows are written");
  assert(state.working.assetPoints?.every((p) => p.assetIndex === 0) === true, "every row is on asset 0");
  assert(parsed(out.content).mapped === 40, "the result counts forty");
  const shown = fortyRows()
    .slice(0, 10)
    .map((p) => `'${p.sourceDataKey}' → '${p.pointKey}'`)
    .join(", ");
  assert(shown.startsWith("'s01' → 'kw', 's02' → 'k1'"), "control: the fixture's first pairs");
  assert(
    out.actionLine === `Mapped 40 points on asset '${ASSET_CODE}': ${shown}, …and 30 more mappings`,
    `the action line names ten and counts thirty: ${out.actionLine}`,
  );
}

/** P2 — one undeclared key in row 7 refuses the whole batch with a `points.7` path. */
export async function assertP2AnUndeclaredKeyRefusesTheBatch(): Promise<void> {
  const points = fortyRows().slice(0, 10);
  points[7] = { ...points[7]!, pointKey: "x" };
  const state: ToolState = { working: baseDraft({ pointKeys: FORTY_KEYS }) };
  const before = snapshot(state);
  const out = await runTool(call("map_points", { assetIndex: 0, points }), state, context());
  assert(!out.ok, "the call is refused");
  assert(out.error === "points.7: Point key 'x' is neither in this draft nor in the catalog", `the refusal names row 7: ${out.error}`);
  assert(snapshot(state) === before, "nothing is written");

  // Control: the same batch without row 7 writes.
  const control: ToolState = { working: baseDraft({ pointKeys: FORTY_KEYS }) };
  const ok = await runTool(call("map_points", { assetIndex: 0, points: points.filter((_, i) => i !== 7) }), control, context());
  assert(ok.ok && control.working.assetPoints?.length === 9, `control: the batch minus row 7 writes nine rows: ${ok.content}`);
}

/** P3 — a source data key repeated in the batch refuses it with the commit's unique-conflict sentence. */
export async function assertP3AnInBatchDuplicateSourceRefusesTheBatch(): Promise<void> {
  const points = fortyRows().slice(0, 4);
  points[3] = { ...points[3]!, sourceDataKey: points[1]!.sourceDataKey };
  const state: ToolState = { working: baseDraft({ pointKeys: FORTY_KEYS }) };
  const before = snapshot(state);
  const out = await runTool(call("map_points", { assetIndex: 0, points }), state, context());
  assert(!out.ok && out.error === `points.3: ${DUPLICATE_SOURCE}`, `the refusal is the unique-conflict sentence on row 3: ${out.error}`);
  assert(snapshot(state) === before, "nothing is written");
}

/** P4 — a templated asset refuses with the V4 sentence and no `points.` prefix. */
export async function assertP4ATemplatedAssetRefusesWithoutAPrefix(): Promise<void> {
  const draft = baseDraft({ pointKeys: FORTY_KEYS });
  draft.assets = [{ ...draft.assets![0]!, template: { code: "PUMP" } } as NonNullable<OnboardingDraft["assets"]>[number]];
  const state: ToolState = { working: draft };
  const before = snapshot(state);
  const out = await runTool(call("map_points", { assetIndex: 0, points: fortyRows().slice(0, 3) }), state, context());
  assert(
    !out.ok &&
      out.error === `Asset '${ASSET_CODE}' is built from a template; its points come from the template, so map no point to it`,
    `the refusal is the V4 sentence: ${out.error}`,
  );
  assert(snapshot(state) === before, "nothing is written");
}

/** P5 — a credential-looking source data key refuses the call (CREDENTIAL_CHECKED_TOOLS). */
export async function assertP5ACredentialInARowIsRefused(): Promise<void> {
  const state: ToolState = { working: baseDraft({ pointKeys: FORTY_KEYS }) };
  const out = await runTool(
    call("map_points", { assetIndex: 0, points: [{ pointKey: "kw", sourceDataKey: "token: abc123def456" }] }),
    state,
    context(),
  );
  assert(!out.ok && out.error === CREDENTIAL_TOOL_ERROR, `the credential walk refuses the call: ${out.error}`);
  assert((state.working.assetPoints?.length ?? 0) === 0, "nothing is written");
}

/** Two hundred distinct declared keys and their rows on asset 0. */
function twoHundred(): { keys: OnboardingDraftPointKey[]; points: Omit<OnboardingDraftAssetPoint, "assetIndex">[] } {
  const keys = Array.from({ length: MAX_ASSET_POINTS_PER_CALL }, (_, i) => key(`n${i}`));
  return { keys, points: keys.map((k, i) => ({ pointKey: k.code, sourceDataKey: `t${i}` })) };
}

/** P6 — one row past the per-call bound is a schema refusal. */
export async function assertP6OneRowPastTheBoundIsASchemaRefusal(): Promise<void> {
  const { keys, points } = twoHundred();
  const state: ToolState = { working: baseDraft({ pointKeys: keys }) };
  const out = await runTool(call("map_points", { assetIndex: 0, points: [...points, { pointKey: "kw", sourceDataKey: "extra" }] }), state, context());
  assert(!out.ok && (out.error ?? "").startsWith("Invalid arguments: points"), `201 rows are invalid arguments: ${out.error}`);
  assert((state.working.assetPoints?.length ?? 0) === 0, "nothing is written");
}

/** P6 — 200 rows onto 4,900 meet the draft cap through `write()`. */
export async function assertP6TheDraftCapBindsThroughWrite(): Promise<void> {
  const { keys, points } = twoHundred();
  // On asset 1, so no pair collides with the new rows on asset 0.
  const existing = Array.from({ length: 4_900 }, (_, i) => ({ assetIndex: 1, pointKey: "kw", sourceDataKey: `e${i}` }));
  const state: ToolState = { working: baseDraft({ pointKeys: keys, assetPoints: existing }) };
  const out = await runTool(call("map_points", { assetIndex: 0, points }), state, context());
  const expected = draftCountProblem({ assetPoints: [...existing, ...points.map((p) => ({ assetIndex: 0, ...p }))] });
  assert(expected !== null, "control: 5,100 mappings exceed the draft cap");
  assert(!out.ok && out.error === expected, `the refusal is the draft-cap sentence: ${out.error}`);
  assert(state.working.assetPoints?.length === 4_900, "nothing is written");
}

/**
 * P7 — a row carrying its own `assetIndex` is refused, naming the element, and nothing is written: a
 * batch across two assets must be one call per asset, never silently folded onto the call's asset.
 */
export async function assertP7ARowsOwnAssetIndexIsRefused(): Promise<void> {
  const state: ToolState = { working: baseDraft({ pointKeys: FORTY_KEYS }) };
  const before = snapshot(state);
  const out = await runTool(
    call("map_points", { assetIndex: 0, points: [{ assetIndex: 1, pointKey: "kw", sourceDataKey: "s01" }] }),
    state,
    context(),
  );
  assert(!out.ok && (out.error ?? "").startsWith("Invalid arguments: "), `a schema refusal: ${out.content}`);
  assert((out.error ?? "").includes("points.0"), `the refusal names the element: ${out.error}`);
  assert(snapshot(state) === before, "nothing is written");
}

// ---------------------------------------------------------------- get_asset_points

/** R1 — the asset and its rows, each with its draft-wide index. */
export async function assertR1GetAssetPointsListsTheRowsWithDraftIndexes(): Promise<void> {
  const state: ToolState = {
    working: baseDraft({
      pointKeys: [key("kvar")],
      assetPoints: [
        { assetIndex: 1, pointKey: "kw", sourceDataKey: "x01" },
        { assetIndex: 0, pointKey: "kw", sourceDataKey: "s01", sensorCode: "CT-1", unit: "kW" },
        { assetIndex: 1, pointKey: "kvar", sourceDataKey: "x02" },
        { assetIndex: 0, pointKey: "kvar", sourceDataKey: "s02" },
      ],
    }),
  };
  const before = snapshot(state);
  const out = await runTool(call("get_asset_points", { assetIndex: 0 }), state, context());
  assert(out.ok, `the call succeeds: ${out.content}`);
  const result = parsed(out.content);
  assert(
    JSON.stringify(result.asset) === JSON.stringify({ code: ASSET_CODE, name: "Meter", templated: false }),
    `the asset is named: ${JSON.stringify(result.asset)}`,
  );
  assert(
    JSON.stringify(result.points) ===
      JSON.stringify([
        { index: 1, pointKey: "kw", sourceDataKey: "s01", sensorCode: "CT-1", unit: "kW" },
        { index: 3, pointKey: "kvar", sourceDataKey: "s02" },
      ]),
    `the rows carry their draft-wide index: ${JSON.stringify(result.points)}`,
  );
  assert(result.more === undefined, "nothing is cut");
  assert(out.actionLine === undefined && snapshot(state) === before, "a read writes nothing");
}

/** R2 — an unknown asset index fails. */
export async function assertR2AnUnknownAssetIndexFails(): Promise<void> {
  const out = await runTool(call("get_asset_points", { assetIndex: 2 }), { working: baseDraft() }, context());
  assert(!out.ok && out.error === "There is no asset at index 2; the draft has 2.", `the call fails: ${out.error}`);
}

/** R3 — 101 rows show 100 and count the rest. */
export async function assertR3GetAssetPointsIsBoundedAtOneHundred(): Promise<void> {
  const assetPoints = Array.from({ length: 101 }, (_, i) => ({ assetIndex: 0, pointKey: `n${i}`, sourceDataKey: `s${i}` }));
  const out = await runTool(call("get_asset_points", { assetIndex: 0 }), { working: baseDraft({ assetPoints }) }, context());
  const result = parsed(out.content);
  assert(out.ok && (result.points as unknown[]).length === 100, "100 rows are shown");
  assert(result.more === "…and 1 more mappings", `the rest is counted: ${String(result.more)}`);
}

// ---------------------------------------------------------------- F4.225

/** F4.225: the catalog holds `kw` active with unit `kW` and domain `electrical`. */
const KW_FIELDS: ValidateTemplateContext = { ...KW_ACTIVE, pointKeyFields: new Map([["kw", { unit: "kW", domain: "electrical" }]]) };

/**
 * F4.225 K1 — add_point_keys refuses a unit the catalog contradicts, all or none, at the index in the call.
 * The draft holds two keys already, so a draft-wide index (`keys.3`) would not match.
 */
export async function assertK1AddPointKeysRefusesACatalogContradictionAtItsCallIndex(): Promise<void> {
  const state: ToolState = { working: baseDraft({ pointKeys: [key("v"), key("a")] }) };
  const before = snapshot(state);
  const out = await runTool(call("add_point_keys", { keys: [key("flow"), key("kw", { unit: "MW" })] }), state, context(KW_FIELDS));
  const expected = `keys.1: ${pointKeyConflictMessage("kw", { field: "unit", declared: "MW", existing: "kW" }, "catalog")}`;
  assert(!out.ok && out.error === expected, `K1 the catalog sentence at keys.1, got ${JSON.stringify(out)}`);
  assert(snapshot(state) === before, "K1 nothing was written");
}

/** F4.225 K2 — the adjacent positive: a batch whose kw agrees with the catalog lands. */
export async function assertK2AddPointKeysAcceptsAnAgreeingBatch(): Promise<void> {
  const state: ToolState = { working: baseDraft() };
  const out = await runTool(call("add_point_keys", { keys: [key("flow"), key("kw", { unit: "kW" })] }), state, context(KW_FIELDS));
  assert(out.ok && state.working.pointKeys?.length === 2, `K2 both keys land, got ${JSON.stringify(out)}`);
}
