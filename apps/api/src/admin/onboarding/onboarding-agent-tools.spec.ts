import type { OnboardingDraft } from "@bms/shared";

import {
  CREDENTIALED_CONNECTION_ERROR,
  CREDENTIAL_TOOL_ERROR,
  EXISTING_KEYS_NEED_KW_ERROR,
  TOOL_DEFINITIONS,
  TOOL_LIST_MAX_ITEMS,
  TOOL_RESULT_CUT_TAIL,
  TOOL_RESULT_MAX_CHARS,
  runTool,
  type ToolContext,
  type ToolState,
} from "./onboarding-agent-tools";
import { COMMIT_UNIQUE_CONFLICTS } from "./onboarding-commit-conflict";
import { commitSummary } from "./onboarding-commit-proposal";
import { PROMPT_OMITTED_MARKER } from "./onboarding-prompt-budget";
import { EMPTY_TEMPLATE_CONTEXT, unresolvedPointKey, type ValidateTemplateContext } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const TYPES = [
  { code: "smoc_campus", label: "SMOC campus" },
  { code: "pump_station", label: "Pump station" },
];

function catalog(count = 3): ToolContext["catalog"] {
  return {
    listPointKeys: async () =>
      Array.from({ length: count }, (_, i) => ({
        code: i === 1 ? "energy_kwh" : `key_${i}`,
        name: i === 2 ? "Active Power" : `Key ${i}`,
        unit: null,
        domain: null,
      })),
    listInUsePointKeys: async () => new Set<string>(),
  };
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: TYPES,
    catalog: catalog(),
    protocols: {
      getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }),
      formatForAssistant: () => "MQTT, Modbus TCP",
    },
    validator: new OnboardingValidateService(),
    templates: EMPTY_TEMPLATE_CONTEXT,
    inventory: { listExisting: async () => ({ rows: [], total: 0 }) },
    ...overrides,
  };
}

const PLAIN_RTU = { code: "RTU-1", displayName: "RTU-1", protocol: "mqtt" as const, config: { host: "broker", port: 8883, tls: true, topic: "a/b" } };

function readyDraft(): OnboardingDraft {
  return {
    location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", latitude: 20.1, longitude: 85.1, type: "smoc_campus" },
    // ingest off: an MQTT RTU with ingest on and no credentials is not ready to commit.
    rtus: [{ ...PLAIN_RTU, credentialsSet: false, ingestEnabled: false }],
    pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }],
    assets: [{ rtuIndex: 0, code: "BERHAMPUR-ASSET-1", name: "Meter", siteName: "Berhampur", domain: "electrical" }],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s01", unit: "kW" }],
  } as OnboardingDraft;
}

/** F3.23: a fleet catalog that holds `kw` active, as the global seed does. */
const KW_ACTIVE: ValidateTemplateContext = { ...EMPTY_TEMPLATE_CONTEXT, pointKeys: new Map([["kw", true]]) };

function call(name: string, args: unknown): { id: string; name: string; arguments: string } {
  return { id: "c1", name, arguments: typeof args === "string" ? args : JSON.stringify(args) };
}

function parsed(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

const FORBIDDEN = ["credentialsSet", "_secrets", "_commitProposal", "rtuTargetCount", "importedFromExcel"];

/** Every tool's JSON Schema; none carries a field the agent must never write. */
export function assertEveryToolHasAJsonSchemaWithNoForbiddenProperty(): void {
  assert(TOOL_DEFINITIONS.length === 29, `there are 29 tools, got ${TOOL_DEFINITIONS.length}`);
  for (const tool of TOOL_DEFINITIONS) {
    const text = JSON.stringify(tool.parameters);
    for (const field of FORBIDDEN) {
      assert(!text.includes(`"${field}"`), `${tool.name}'s schema carries no ${field}`);
    }
    assert(tool.parameters.type === "object", `${tool.name}'s parameters are an object schema`);
  }
  const meta = TOOL_DEFINITIONS.find((t) => t.name === "use_existing_point_keys");
  const props = Object.keys((meta?.parameters.properties ?? {}) as object);
  assert(props.length === 1 && props[0] === "value", "use_existing_point_keys takes exactly `value`");
}

export async function assertAddRtuRefusesASecretKeyAtDepth(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call("add_rtu", { ...PLAIN_RTU, config: { mqtt: { auth: { Password: "x" } } } }), state, context());
  assert(!out.ok && parsed(out.content).error === CREDENTIAL_TOOL_ERROR, "a password key three levels down refuses the call");
  assert((state.working.rtus?.length ?? 0) === 0, "the working draft is unchanged");
  assert(out.actionLine === undefined, "a refused call writes no action line");
}

export async function assertAddRtuRefusesACredentialLookingValue(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call("add_rtu", { ...PLAIN_RTU, config: { note: "password: hunter2" } }), state, context());
  assert(!out.ok && parsed(out.content).error === CREDENTIAL_TOOL_ERROR, "a credential-looking value refuses the call");
  assert((state.working.rtus?.length ?? 0) === 0, "the working draft is unchanged");
}

/** `sharedAccessKey` is a fragment only the redactors' list carries, so a private list would miss it. */
export async function assertUpdateRtuRefusesTheSameTwoShapes(): Promise<void> {
  for (const config of [{ azure: { sharedAccessKey: "abc" } }, { note: "password: hunter2" }]) {
    const state: ToolState = { working: readyDraft() };
    const out = await runTool(call("update_rtu", { index: 0, patch: { config } }), state, context());
    assert(!out.ok && parsed(out.content).error === CREDENTIAL_TOOL_ERROR, `update_rtu refuses ${JSON.stringify(config)}`);
    assert(JSON.stringify(state.working.rtus?.[0]?.config) === JSON.stringify(PLAIN_RTU.config), "the stored RTU is unchanged");
  }
}

export async function assertAddRtuAcceptsAPlainConfig(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call("add_rtu", PLAIN_RTU), state, context());
  assert(out.ok, "a host/port/tls/topic config is accepted");
  assert(state.working.rtus?.length === 1, "the RTU is appended");
  assert(state.working.rtus?.[0]?.credentialsSet === false, "a new RTU has no credentials set");
  assert(out.actionLine === "Added RTU RTU-1 (mqtt)", `the action line is code-written: ${out.actionLine}`);
}

export async function assertUpdateRtuKeepsCredentialsSet(): Promise<void> {
  const draft = readyDraft();
  draft.rtus![0]!.credentialsSet = true;
  const state: ToolState = { working: draft };
  // The patch schema omits credentialsSet and strips unknown keys, so an argument
  // naming it is dropped, not applied.
  const out = await runTool(call("update_rtu", { index: 0, patch: { displayName: "Main RTU", credentialsSet: false } }), state, context());
  assert(out.ok && state.working.rtus?.[0]?.displayName === "Main RTU", "the display name changes");
  assert(state.working.rtus?.[0]?.credentialsSet === true, "the stored credentialsSet survives, whatever the arguments say");
}

export async function assertAWriteOverACapIsAToolError(): Promise<void> {
  const rtus = Array.from({ length: 100 }, (_, i) => ({ ...PLAIN_RTU, code: `RTU-${i}`, credentialsSet: false }));
  const state: ToolState = { working: { rtus } as OnboardingDraft };
  const out = await runTool(call("add_rtu", { ...PLAIN_RTU, code: "RTU-X" }), state, context());
  assert(!out.ok && String(parsed(out.content).error).includes("more than the 100"), "the 101st RTU is refused with the cap sentence");
  assert(state.working.rtus?.length === 100, "the working draft still holds 100");
}

export async function assertSetLocationRefusesAnInactiveTypeNamingTheActiveCodes(): Promise<void> {
  const state: ToolState = { working: readyDraft() };
  const out = await runTool(call("set_location", { name: "Berhampur", type: "warehouse" }), state, context());
  const error = String(parsed(out.content).error);
  assert(!out.ok && error.includes("smoc_campus") && error.includes("pump_station"), "the error names the active codes");
  assert(state.working.location?.type === "smoc_campus", "the stored type is unchanged");
  const kept = await runTool(call("set_location", { name: "Berhampur North" }), state, context());
  assert(kept.ok && state.working.location?.type === "smoc_campus", "a call with no type keeps the stored one");
  assert(state.working.location?.name === "Berhampur North", "the name changes");
}

export async function assertSetLocationDerivesSlugAndCode(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call("set_location", { name: "Berhampur", type: "pump_station" }), state, context());
  const location = state.working.location;
  assert(out.ok, "set_location succeeds");
  assert(location?.slug === "berhampur" && location?.code === "BERHAMPUR", "slug and code derive from the name");
  assert(location?.latitude === 19.076 && location?.longitude === 72.8777, "the coordinates take the shared Mumbai defaults (F3.79)");
  assert(out.actionLine === "Set location Berhampur (pump_station)", `the action line is code-written: ${out.actionLine}`);
}

export async function assertUseExistingPointKeysWritesOnlyThatFlag(): Promise<void> {
  const state: ToolState = { working: { onboardingMeta: { importedFromExcel: true } } as OnboardingDraft };
  const out = await runTool(call("use_existing_point_keys", { value: true }), state, context({ templates: KW_ACTIVE }));
  assert(out.ok, "the flag is set");
  assert(state.working.onboardingMeta?.useExistingPointKeys === true, "useExistingPointKeys flips");
  assert(state.working.onboardingMeta?.importedFromExcel === true, "the other meta field survives");
  const extra = await runTool(call("use_existing_point_keys", { value: true, rtuTargetCount: 9 }), state, context({ templates: KW_ACTIVE }));
  assert(!extra.ok, "no other meta field can ride along");
}

export async function assertProposeCommitRefusesAnUnreadyDraft(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call("propose_commit", {}), state, context());
  assert(!out.ok && String(parsed(out.content).error).startsWith("The draft is not ready to commit."), "an empty draft is refused");
  assert(state.pendingProposal === undefined, "no proposal is recorded");
}

/** F4.192 — a draft with no field error that is not at review is refused with its phase, not an empty reason. */
export async function assertProposeCommitNamesThePhaseWhenNoFieldErrorExplains(): Promise<void> {
  const state: ToolState = { working: { ...readyDraft(), assetPoints: [] } };
  const out = await runTool(call("propose_commit", {}), state, context());
  const error = String(parsed(out.content).error);
  assert(!out.ok && error === "The draft is not ready to commit. It is at the mappings phase, not review.", `got ${error}`);
}

/** F4.192 — a refusal a field error explains ends on that error and does not name the phase. */
export async function assertProposeCommitNamesNoPhaseWhenAFieldErrorExplains(): Promise<void> {
  const draft = readyDraft();
  const state: ToolState = { working: { ...draft, location: { ...draft.location!, type: "space_port" } } };
  const out = await runTool(call("propose_commit", {}), state, context());
  const error = String(parsed(out.content).error);
  assert(!out.ok && error.startsWith("The draft is not ready to commit. location.type: "), `the field error explains it: ${error}`);
  assert(!error.includes("phase, not review"), `no phase sentence rides along: ${error}`);
}

/** Also the model-not-on-the-commit-path gate: the tool takes no commit dependency at all. */
export async function assertProposeCommitRecordsASummary(): Promise<void> {
  const state: ToolState = { working: readyDraft() };
  const before = JSON.stringify(state.working);
  const out = await runTool(call("propose_commit", {}), state, context());
  assert(out.ok, "a ready draft is proposed");
  assert(state.pendingProposal?.summary === commitSummary(state.working, EMPTY_TEMPLATE_CONTEXT), "the pending proposal carries the code-written summary");
  assert(out.actionLine === `Proposed commit: ${commitSummary(state.working, EMPTY_TEMPLATE_CONTEXT)}`, "the action line names the summary");
  assert(JSON.stringify(state.working) === before, "proposing does not change the draft");
}

export async function assertAListResultIsBoundedAtOneHundredAndCountsTheRest(): Promise<void> {
  const out = await runTool(call("list_point_keys", {}), { working: {} }, context({ catalog: catalog(130) }));
  const result = parsed(out.content);
  assert(TOOL_LIST_MAX_ITEMS === 100, "the list bound is 100");
  assert((result.pointKeys as unknown[]).length === 100, "100 keys are named");
  assert(result.more === "…and 30 more point keys", `the rest are counted: ${String(result.more)}`);
}

export async function assertListPointKeysSearchFiltersCodeAndName(): Promise<void> {
  const byCode = parsed((await runTool(call("list_point_keys", { search: "ENERGY" }), { working: {} }, context())).content);
  assert(JSON.stringify((byCode.pointKeys as { code: string }[]).map((k) => k.code)) === '["energy_kwh"]', "search matches the code");
  const byName = parsed((await runTool(call("list_point_keys", { search: "active" }), { working: {} }, context())).content);
  assert(JSON.stringify((byName.pointKeys as { code: string }[]).map((k) => k.code)) === '["key_2"]', "search matches the name");
}

export async function assertAToolResultIsCutToTheBound(): Promise<void> {
  const draft = readyDraft();
  // A surrogate pair built from code units, not a literal (AGENTS.md §4.5).
  draft.location!.province = `${"P".repeat(TOOL_RESULT_MAX_CHARS)}${String.fromCharCode(0xd83d, 0xde00)}`;
  draft.rtus = Array.from({ length: 60 }, (_, i) => ({ ...PLAIN_RTU, code: `RTU-${i}`, displayName: "D".repeat(120), credentialsSet: false }));
  const out = await runTool(call("get_draft", {}), { working: draft }, context());
  assert(out.content.length <= TOOL_RESULT_MAX_CHARS + TOOL_RESULT_CUT_TAIL.length, `the result is bounded (${out.content.length})`);
  assert(out.content.endsWith(TOOL_RESULT_CUT_TAIL), "a cut result ends with the fixed tail");
  const body = out.content.slice(0, -TOOL_RESULT_CUT_TAIL.length);
  const last = body.charCodeAt(body.length - 1);
  assert(!(last >= 0xd800 && last <= 0xdbff), "the cut never leaves a lone high surrogate");
}

export async function assertUnknownToolAndBadArgumentsAreToolErrors(): Promise<void> {
  const state: ToolState = { working: {} };
  for (const bad of [call("drop_database", {}), call("add_point_key", "{not json"), call("add_point_key", { code: "has space", name: "X" })]) {
    let out;
    try {
      out = await runTool(bad, state, context());
    } catch {
      assert(false, `${bad.name} threw instead of returning a tool error`);
    }
    assert(out !== undefined && !out.ok && parsed(out.content).ok === false, `${bad.name} ${bad.arguments} is a tool error`);
  }
  assert((state.working.pointKeys?.length ?? 0) === 0, "nothing was written");
}

export async function assertAMarkerInArgumentsIsRefused(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call("add_point_key", { code: "kw", name: "kW", description: PROMPT_OMITTED_MARKER }), state, context());
  assert(!out.ok, "an argument echoing the withheld-value marker is refused");
  assert((state.working.pointKeys?.length ?? 0) === 0, "nothing was written");
}

/** Not in the plan's list by name; the loop relies on it (ALaterWriteDropsThePendingProposal). */
export async function assertASuccessfulWriteDropsThePendingProposal(): Promise<void> {
  const state: ToolState = { working: readyDraft(), pendingProposal: { summary: "s" } };
  const failed = await runTool(call("add_point_key", { code: "has space", name: "X" }), state, context());
  assert(!failed.ok && state.pendingProposal !== undefined, "a refused write keeps the proposal");
  const ok = await runTool(call("add_point_key", { code: "kvar", name: "Reactive" }), state, context());
  assert(ok.ok && state.pendingProposal === undefined, "a successful write drops it");
}

/** Security review M1: short credential names the substring list misses. */
export async function assertShortCredentialNamesAreRefused(): Promise<void> {
  for (const config of [{ user: "admin", pass: "hunter2" }, { auth: { u: "a" } }, { basicAuth: "admin:x" }, { pw: "x" }]) {
    const state: ToolState = { working: {} };
    const out = await runTool(call("add_rtu", { ...PLAIN_RTU, config: { ...PLAIN_RTU.config, ...config } }), state, context());
    assert(!out.ok && parsed(out.content).error === CREDENTIAL_TOOL_ERROR, `${JSON.stringify(config)} is refused`);
  }
}

/** Security review L2: the two `meta` carriers are walked too. */
export async function assertMetaCredentialsAreRefused(): Promise<void> {
  const location = await runTool(call("set_location", { name: "Berhampur", meta: { broker: { password: "x" } } }), { working: {} }, context());
  assert(!location.ok && parsed(location.content).error === CREDENTIAL_TOOL_ERROR, "set_location meta is walked");
  const asset = await runTool(
    call("add_asset", { rtuIndex: 0, code: "A-1", name: "Meter", siteName: "Site", domain: "electrical", meta: { token: "x" } }),
    { working: readyDraft() },
    context(),
  );
  assert(!asset.ok && parsed(asset.content).error === CREDENTIAL_TOOL_ERROR, "add_asset meta is walked");
}

/**
 * `F3.22` (ADR 0091 decision 2, code review): `add_asset` refuses a `template`,
 * so an unpinned organization ref cannot enter the draft through it —
 * `add_template_assets` is the one writer, and it pins the version. A refusal,
 * not a silent strip into a plain asset.
 */
export async function assertAddAssetRefusesATemplate(): Promise<void> {
  const asset = { rtuIndex: 0, code: "P-001", name: "Pump 1", siteName: "Site A", domain: "water" };
  const refused: ToolState = { working: readyDraft() };
  const before = refused.working.assets?.length ?? 0;
  const out = await runTool(call("add_asset", { ...asset, template: { code: "ORG-T" } }), refused, context());
  assert(!out.ok && String(parsed(out.content).error).includes("template"), `a template is refused, got ${out.content}`);
  assert((refused.working.assets?.length ?? 0) === before, "nothing is written");
  const control: ToolState = { working: readyDraft() };
  const ok = await runTool(call("add_asset", asset), control, context());
  assert(ok.ok && control.working.assets?.length === before + 1, `positive control: the plain asset is added, got ${ok.content}`);
}

/** Security review M2: a credentialed RTU keeps its connection; the action line names what changed. */
export async function assertACredentialedRtuKeepsItsConnection(): Promise<void> {
  for (const patch of [{ config: { host: "evil.example" } }, { config: { port: 1883 } }, { protocol: "modbus_tcp" }, { code: "RTU-9" }]) {
    const state: ToolState = { working: readyDraft() };
    state.working.rtus![0]!.credentialsSet = true;
    const out = await runTool(call("update_rtu", { index: 0, patch }), state, context());
    assert(!out.ok && parsed(out.content).error === CREDENTIALED_CONNECTION_ERROR, `${JSON.stringify(patch)} is refused`);
  }
  const state: ToolState = { working: readyDraft() };
  state.working.rtus![0]!.credentialsSet = true;
  const topic = await runTool(call("update_rtu", { index: 0, patch: { config: { topic: "x/y" } } }), state, context());
  assert(topic.ok, "positive control: a topic change on a credentialed RTU is allowed");
  assert(topic.actionLine === "Updated RTU RTU-1: 'config.topic'", `the line names the field: ${topic.actionLine}`);
}

/** Code review #3: `config` merges one level deep. */
export async function assertUpdateRtuMergesConfig(): Promise<void> {
  const state: ToolState = { working: readyDraft() };
  const out = await runTool(call("update_rtu", { index: 0, patch: { config: { topic: "x/y" } } }), state, context());
  const config = state.working.rtus?.[0]?.config as Record<string, unknown>;
  assert(out.ok && config.topic === "x/y" && config.host === "broker" && config.port === 8883 && config.tls === true, "host, port and TLS are kept");
  const moved = await runTool(call("update_rtu", { index: 0, patch: { config: { host: "new.example" } } }), state, context());
  assert(moved.ok && moved.actionLine === "Updated RTU RTU-1: 'config.host', host 'new.example'", `the line names the new host: ${moved.actionLine}`);
}

/** The remove-then-re-add path: a removed credentialed code cannot be reused. */
export async function assertARemovedCredentialedCodeCannotBeReAdded(): Promise<void> {
  const working = { ...readyDraft(), rtus: [], assets: [], assetPoints: [], _secrets: { "RTU-1": { c: "x", iv: "y" } } } as unknown as OnboardingDraft;
  const out = await runTool(call("add_rtu", { ...PLAIN_RTU, config: { host: "evil.example", port: 8883, tls: true, topic: "a/b" } }), { working }, context());
  assert(!out.ok && String(parsed(out.content).error).includes("still holds stored credentials"), "the code is refused");
  const other = await runTool(call("add_rtu", { ...PLAIN_RTU, code: "RTU-2" }), { working }, context());
  assert(other.ok, "positive control: another code is accepted");
}

/** Code review #1: a referenced RTU or asset is refused; otherwise later indexes shift down. */
export async function assertRemovingKeepsIndexesPointingAtTheSameParent(): Promise<void> {
  const refused = await runTool(call("remove_rtu", { index: 0 }), { working: readyDraft() }, context());
  assert(!refused.ok && String(parsed(refused.content).error).includes("BERHAMPUR-ASSET-1"), "an RTU with assets is refused, naming them");
  const busy = await runTool(call("remove_asset", { index: 0 }), { working: readyDraft() }, context());
  assert(!busy.ok && String(parsed(busy.content).error).includes("s01"), "an asset with mappings is refused, naming them");

  const two = readyDraft();
  two.rtus = [{ ...PLAIN_RTU, code: "RTU-0", credentialsSet: false }, ...two.rtus!];
  two.assets = [{ ...two.assets![0]!, rtuIndex: 1 }];
  const state: ToolState = { working: two };
  const shifted = await runTool(call("remove_rtu", { index: 0 }), state, context());
  assert(shifted.ok && state.working.assets?.[0]?.rtuIndex === 0, "the asset still points at RTU-1, now at index 0");
  assert(state.working.rtus?.[0]?.code === "RTU-1", "and RTU-1 is the one left");

  const assets = readyDraft();
  assets.assets = [{ ...assets.assets![0]!, code: "A-0" }, ...assets.assets!];
  assets.assetPoints = [{ ...assets.assetPoints![0]!, assetIndex: 1 }];
  const astate: ToolState = { working: assets };
  const ashift = await runTool(call("remove_asset", { index: 0 }), astate, context());
  assert(ashift.ok && astate.working.assetPoints?.[0]?.assetIndex === 0, "the mapping still points at its asset");
}

/** Code review #4: a type-only call keeps a stored slug and code. */
export async function assertSetLocationKeepsStoredIdentifiersForTheSameName(): Promise<void> {
  const draft = readyDraft();
  draft.location = { ...draft.location!, name: "West Campus HQ", slug: "wc-hq", code: "WCHQ" };
  const state: ToolState = { working: draft };
  await runTool(call("set_location", { name: "West Campus HQ", type: "pump_station" }), state, context());
  assert(state.working.location?.slug === "wc-hq" && state.working.location?.code === "WCHQ", "slug and code are kept");
  await runTool(call("set_location", { name: "East Yard" }), state, context());
  assert(state.working.location?.slug === "east-yard" && state.working.location?.code === "EAST_YARD", "a new name derives them");
}

/** Security review L6: a write past the stored-draft depth is refused. */
export async function assertADeepWriteIsRefused(): Promise<void> {
  let deep: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < 12; i++) {
    deep = { child: deep };
  }
  const state: ToolState = { working: {} };
  const out = await runTool(call("add_rtu", { ...PLAIN_RTU, config: { ...PLAIN_RTU.config, extra: deep } }), state, context());
  assert(!out.ok && String(parsed(out.content).error).startsWith("The draft nests deeper than"), "the depth bound holds");
  assert((state.working.rtus?.length ?? 0) === 0, "nothing was written");
}

/** F3.27 (U3): a refusal carries its sentence as `error`, so the guided mode never parses `content`. */
export async function assertAFailedOutcomeCarriesItsError(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call("x", {}), state, context());
  assert(!out.ok && out.error === "Unknown tool 'x'.", `the error field: ${String(out.error)}`);
  const passed = await runTool(call("add_rtu", PLAIN_RTU), state, context());
  assert(passed.ok && passed.error === undefined, "a passing outcome carries no error");
}

/** F3.25 (ADR 0094 decision 9): suggest_replies records the chips and changes nothing in the draft. */
export async function assertSuggestRepliesSetsTheRepliesAndWritesNothing(): Promise<void> {
  const draft = readyDraft();
  const state: ToolState = { working: draft };
  const out = await runTool(call("suggest_replies", { replies: ["MQTT", "Modbus"] }), state, context());
  assert(out.ok, `the call passes: ${out.content}`);
  assert(JSON.stringify(state.suggestedReplies) === '["MQTT","Modbus"]', `the replies are recorded, got ${JSON.stringify(state.suggestedReplies)}`);
  assert(out.actionLine === undefined, "no action line: it changes nothing in the draft");
  assert(state.working === draft, "the working draft is the same object");
}

/** F3.25: five replies and an empty reply are invalid arguments, and nothing is recorded. */
export async function assertSuggestRepliesRefusesFiveAndAnEmptyReply(): Promise<void> {
  for (const replies of [["a", "b", "c", "d", "e"], [""]]) {
    const state: ToolState = { working: {} };
    const out = await runTool(call("suggest_replies", { replies }), state, context());
    assert(!out.ok && String(out.error).startsWith("Invalid arguments"), `${JSON.stringify(replies)} is refused, got ${out.content}`);
    assert(state.suggestedReplies === undefined, "a refused call records nothing");
  }
  const four = await runTool(call("suggest_replies", { replies: ["a", "b", "c", "d"] }), { working: {} }, context());
  assert(four.ok, "four replies pass (the adjacent positive)");
}

/** F3.23 T-A (ADR 0092 decision 2): map_point refuses a key that resolves nowhere, with the validator's sentence. */
export async function assertMapPointRefusesAnUndeclaredKey(): Promise<void> {
  const state: ToolState = { working: readyDraft() };
  const out = await runTool(call("map_point", { assetIndex: 0, pointKey: "kvar", sourceDataKey: "s02" }), state, context());
  const sentence = unresolvedPointKey("kvar", new Set(["kw"]), new Map());
  assert(!out.ok && out.error === sentence, `refused with the unresolved-key sentence, got ${out.content}`);
  assert(state.working.assetPoints?.length === 1, "the mappings are unchanged");
  assert(out.actionLine === undefined, "a refused call writes no action line");
}

/** F3.23 T-A control: a declared key appends, and the line quotes every model string. */
export async function assertMapPointAppendsADeclaredKeyWithAQuotedLine(): Promise<void> {
  const state: ToolState = { working: { ...readyDraft(), assetPoints: [] } };
  const out = await runTool(call("map_point", { assetIndex: 0, pointKey: "kw", sourceDataKey: "s02" }), state, context());
  assert(out.ok && state.working.assetPoints?.length === 1, `the mapping is appended, got ${out.content}`);
  assert(out.actionLine === "Mapped 's02' → 'kw' on asset 'BERHAMPUR-ASSET-1'", `the quoted line: ${out.actionLine}`);
}

/** F3.23 T-B: a second mapping of one point key on one asset is the commit's unique conflict, refused before it. */
export async function assertMapPointRefusesADuplicatePointKeyOnTheAsset(): Promise<void> {
  const state: ToolState = { working: readyDraft() };
  const out = await runTool(call("map_point", { assetIndex: 0, pointKey: "kw", sourceDataKey: "s02" }), state, context());
  const sentence = COMMIT_UNIQUE_CONFLICTS.get("asset_points_asset_id_point_key_unique")?.message;
  assert(sentence !== undefined && !out.ok && out.error === sentence, `refused with the unique-conflict sentence, got ${out.content}`);
  assert(state.working.assetPoints?.length === 1, "the mappings are unchanged");
}

/** F3.23 T-C: a templated asset takes no mapping (the F3.22 V4 sentence). */
export async function assertMapPointRefusesATemplatedAsset(): Promise<void> {
  const draft: OnboardingDraft = { ...readyDraft(), assetPoints: [] };
  draft.assets = [{ ...draft.assets![0]!, template: { code: "PUMP" } }];
  const state: ToolState = { working: draft };
  const out = await runTool(call("map_point", { assetIndex: 0, pointKey: "kw", sourceDataKey: "s02" }), state, context());
  const sentence = "Asset 'BERHAMPUR-ASSET-1' is built from a template; its points come from the template, so map no point to it";
  assert(!out.ok && out.error === sentence, `refused with the V4 sentence, got ${out.content}`);
  assert(state.working.assetPoints?.length === 0, "nothing is written");
}

/** F3.23 T-D (F4.195 left open): a key only the draft declares cannot leave while a mapping uses it. */
export async function assertRemovePointKeyIsRefusedWhileAMappingUsesIt(): Promise<void> {
  const state: ToolState = { working: readyDraft() };
  const out = await runTool(call("remove_point_key", { index: 0 }), state, context());
  assert(
    !out.ok && out.error === "Point key 'kw' is used by mappings: 's01'. Remove those mappings first.",
    `refused naming the mapping, got ${out.content}`,
  );
  assert(state.working.pointKeys?.length === 1, "the point key stays");
}

/** F3.23 T-D control: with `kw` active in the catalog the mapping still resolves, so the key leaves. */
export async function assertRemovePointKeyRemovesAKeyTheCatalogStillResolves(): Promise<void> {
  const state: ToolState = { working: readyDraft() };
  const out = await runTool(call("remove_point_key", { index: 0 }), state, context({ templates: KW_ACTIVE }));
  assert(out.ok && state.working.pointKeys?.length === 0, `removed, got ${out.content}`);
  assert(out.actionLine === "Removed point key 'kw'", `the quoted line: ${out.actionLine}`);
  assert(state.working.assetPoints?.length === 1, "the mapping stays");
}

/** F3.23 T-E (ADR 0092 decision 3): the existing catalog cannot be chosen when it holds no active `kw`. */
export async function assertUseExistingPointKeysIsRefusedWithoutAnActiveKw(): Promise<void> {
  const state: ToolState = { working: { onboardingMeta: { importedFromExcel: true } } as OnboardingDraft };
  const out = await runTool(call("use_existing_point_keys", { value: true }), state, context());
  assert(!out.ok && out.error === EXISTING_KEYS_NEED_KW_ERROR, `refused, got ${out.content}`);
  assert(JSON.stringify(state.working.onboardingMeta) === '{"importedFromExcel":true}', "onboardingMeta is unchanged");
}

/** F3.23 T-E control: declaring the keys in the draft is never refused, whatever the catalog holds. */
export async function assertUseExistingPointKeysFalsePassesWithoutAnActiveKw(): Promise<void> {
  const state: ToolState = { working: { onboardingMeta: { importedFromExcel: true } } as OnboardingDraft };
  const out = await runTool(call("use_existing_point_keys", { value: false }), state, context());
  assert(out.ok && state.working.onboardingMeta?.useExistingPointKeys === false, `the flag is set, got ${out.content}`);
}

/** F3.23 T-F (F4.195 left open): the add_point_key line quotes the code. */
export async function assertAddPointKeyLineIsQuoted(): Promise<void> {
  const added = await runTool(call("add_point_key", { code: "kw", name: "Active Power" }), { working: {} }, context());
  assert(added.ok && added.actionLine === "Added point key 'kw'", `the add line: ${added.actionLine}`);
}

/** F3.23 T-F: the remove_asset_point line quotes both keys. */
export async function assertRemoveAssetPointLineIsQuoted(): Promise<void> {
  const removed = await runTool(call("remove_asset_point", { index: 0 }), { working: readyDraft() }, context());
  assert(removed.ok && removed.actionLine === "Removed mapping 's01' → 'kw'", `the remove line: ${removed.actionLine}`);
}
