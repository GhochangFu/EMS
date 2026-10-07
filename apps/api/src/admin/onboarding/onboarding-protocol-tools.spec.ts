import { PROTOCOL_CATALOG, type OnboardingDraft } from "@bms/shared";

import {
  CREDENTIALED_CONNECTION_ERROR,
  INVALID_CONFIG_PREFIX,
  TOOL_DEFINITIONS,
  runTool,
  type ToolContext,
  type ToolOutcome,
  type ToolState,
} from "./onboarding-agent-tools";
import { OnboardingProtocolService } from "./onboarding-protocol.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F3.24a` / ADR 0093 decisions 5, 6 — `add_rtu` and `update_rtu` refuse a
 * config the protocol's draft schema refuses; `list_protocols` returns the
 * catalog; an RTU on a protocol no adapter serves is config only.
 *
 * Assertions live here; `onboarding-protocol-tools.test.ts` is the vitest
 * entry point (ADR 0014). One claim per exported function.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function context(): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }],
    catalog: { listPointKeys: async () => [], listInUsePointKeys: async () => new Set<string>() },
    protocols: {
      getContextForOrganization: async () => ({ catalog: PROTOCOL_CATALOG, orgExamples: [] }),
      formatForAssistant: OnboardingProtocolService.prototype.formatForAssistant,
    },
    validator: new OnboardingValidateService(),
    templates: EMPTY_TEMPLATE_CONTEXT,
    inventory: { listExisting: async () => ({ rows: [], total: 0 }) },
  };
}

function call(name: string, args: unknown): { id: string; name: string; arguments: string } {
  return { id: "c1", name, arguments: JSON.stringify(args) };
}

function addRtu(protocol: string, config: Record<string, unknown>): ReturnType<typeof call> {
  return call("add_rtu", { code: "RTU-1", displayName: "RTU-1", protocol, config });
}

function stateWith(rtu: Record<string, unknown>): ToolState {
  const stored = { code: "RTU-1", displayName: "RTU-1", credentialsSet: false, ...rtu };
  return { working: { rtus: [stored] } as OnboardingDraft };
}

function parsed(outcome: ToolOutcome): Record<string, unknown> {
  return JSON.parse(outcome.content) as Record<string, unknown>;
}

/** T1 — a wildcard topic is refused with the prefix and the path, never the value; the draft is untouched. */
export async function assertAddRtuRefusesAnInvalidMqttConfigAndLeavesTheDraft(): Promise<void> {
  const state: ToolState = { working: {} };
  const before = JSON.stringify(state.working);
  const out = await runTool(addRtu("mqtt", { topic: "x/#" }), state, context());
  const error = out.error ?? "";
  assert(!out.ok, `refused: ${JSON.stringify(out)}`);
  assert(error.startsWith(INVALID_CONFIG_PREFIX), `the prefix: ${error}`);
  assert(error.includes("topic"), `names topic: ${error}`);
  assert(!error.includes("x/#"), `no value echoed: ${error}`);
  assert(JSON.stringify(state.working) === before, "the draft is unchanged");
}

/** T1's adjacent positive — an ordinary topic is added with the plain MQTT action line. */
export async function assertAddRtuAcceptsAnOrdinaryMqttTopic(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(addRtu("mqtt", { topic: "x/1" }), state, context());
  assert(out.ok && out.actionLine === "Added RTU RTU-1 (mqtt)", `the action line: ${JSON.stringify(out)}`);
}

/** T2 — a string port is refused naming `port`. */
export async function assertAddRtuRefusesAStringPort(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(addRtu("mqtt", { port: "8883", topic: "x/1" }), state, context());
  const error = out.error ?? "";
  assert(!out.ok && error.startsWith(INVALID_CONFIG_PREFIX) && error.includes("port"), `names port: ${JSON.stringify(out)}`);
  assert(!error.includes("8883"), `no value echoed: ${error}`);
}

/** T3 — the guided MQTT add (an empty topic, `tls`) is accepted. */
export async function assertAddRtuAcceptsAnEmptyMqttTopic(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(addRtu("mqtt", { host: "h", port: 8883, tls: true, topic: "" }), state, context());
  assert(out.ok, `accepted: ${JSON.stringify(out)}`);
}

/** T4 — an unwired protocol is config only in the action line. */
export async function assertAnUnwiredProtocolIsConfigOnlyInTheActionLine(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(addRtu("modbus_tcp", { port: "not a number", anything: { deep: true } }), state, context());
  assert(out.ok && out.actionLine === "Added RTU RTU-1 (modbus_tcp) (config only, not ingested)", `the action line: ${JSON.stringify(out)}`);
}

/** T4's adjacent negative — an MQTT line carries no config-only tail. */
export async function assertAnMqttActionLineHasNoConfigOnlyTail(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(addRtu("mqtt", { topic: "x/1" }), state, context());
  assert(out.ok && !(out.actionLine ?? "").includes("config only"), `no tail: ${JSON.stringify(out)}`);
}

const STORED_MQTT = { protocol: "mqtt", config: { host: "h", port: 8883, topic: "a/b" } };

/** T5 — a merged config with port 0 is refused naming `port`; the draft is untouched. */
export async function assertUpdateRtuRefusesAnInvalidMergedConfigAndLeavesTheDraft(): Promise<void> {
  const state = stateWith(STORED_MQTT);
  const before = JSON.stringify(state.working);
  const out = await runTool(call("update_rtu", { index: 0, patch: { config: { port: 0 } } }), state, context());
  const error = out.error ?? "";
  assert(!out.ok && error.startsWith(INVALID_CONFIG_PREFIX) && error.includes("port"), `names port: ${JSON.stringify(out)}`);
  assert(JSON.stringify(state.working) === before, "the draft is unchanged");
}

/** T5's adjacent positive — a valid port is applied. */
export async function assertUpdateRtuAcceptsAValidPort(): Promise<void> {
  const state = stateWith(STORED_MQTT);
  const out = await runTool(call("update_rtu", { index: 0, patch: { config: { port: 8884 } } }), state, context());
  assert(out.ok, `accepted: ${JSON.stringify(out)}`);
  assert(state.working.rtus?.[0]?.config?.port === 8884, "the port is applied");
}

const STORED_MODBUS = { protocol: "modbus_tcp", config: { port: "502" } };

/** T6 — the merged config is checked against the patched protocol. */
export async function assertUpdateRtuChecksAgainstThePatchedProtocol(): Promise<void> {
  const state = stateWith(STORED_MODBUS);
  const before = JSON.stringify(state.working);
  const out = await runTool(call("update_rtu", { index: 0, patch: { protocol: "mqtt" } }), state, context());
  const error = out.error ?? "";
  assert(!out.ok && error.startsWith(`${INVALID_CONFIG_PREFIX}mqtt`) && error.includes("port"), `names port: ${JSON.stringify(out)}`);
  assert(JSON.stringify(state.working) === before, "the draft is unchanged");
}

/** T6's positive — a patch to an unwired protocol is accepted with the config-only tail. */
export async function assertUpdateRtuToAnUnwiredProtocolIsConfigOnly(): Promise<void> {
  const state = stateWith(STORED_MODBUS);
  const out = await runTool(call("update_rtu", { index: 0, patch: { protocol: "simulator" } }), state, context());
  assert(out.ok && (out.actionLine ?? "").endsWith(" (config only, not ingested)"), `the tail: ${JSON.stringify(out)}`);
}

/** T7 — a credentialed RTU's connection freeze answers before the config check. */
export async function assertTheCredentialedFreezeRunsBeforeTheConfigCheck(): Promise<void> {
  const state = stateWith({ ...STORED_MQTT, credentialsSet: true });
  const out = await runTool(call("update_rtu", { index: 0, patch: { config: { host: "elsewhere", port: 0 } } }), state, context());
  assert(!out.ok && out.error === CREDENTIALED_CONNECTION_ERROR, `the freeze: ${JSON.stringify(out)}`);
}

const VIEW_KEYS = ["code", "label", "description", "ingestWired", "supportsDiscovery", "requiredFields", "optionalFields", "exampleConfig"];

/** T8 — `list_protocols` returns the eight catalog views and the text; it writes nothing. */
export async function assertListProtocolsReturnsTheCatalogWithFields(): Promise<void> {
  const state: ToolState = { working: {} };
  const before = JSON.stringify(state.working);
  const out = await runTool(call("list_protocols", {}), state, context());
  const result = parsed(out);
  const catalog = result.catalog as Record<string, unknown>[];
  assert(out.ok && Array.isArray(catalog) && catalog.length === 8, `eight entries: ${out.content.slice(0, 200)}`);
  for (const entry of catalog) {
    const keys = Object.keys(entry).sort();
    assert(JSON.stringify(keys) === JSON.stringify([...VIEW_KEYS].sort()), `the view keys: ${keys.join(", ")}`);
    assert(!("draftConfigSchema" in entry), "no schema object");
  }
  assert(catalog[0]?.code === "mqtt", `mqtt first: ${String(catalog[0]?.code)}`);
  assert(JSON.stringify(catalog[0]?.requiredFields) === JSON.stringify(["topic"]), "mqtt requires topic");
  assert(typeof result.protocols === "string" && result.protocols.includes("Required: topic"), "the text names the field");
  assert(out.actionLine === undefined, "no action line");
  assert(JSON.stringify(state.working) === before, "the draft is unchanged");
}

/** T9 — no new tool. */
export function assertTheToolCountStaysTwentyNine(): void {
  assert(TOOL_DEFINITIONS.length === 29, `29 tools, got ${TOOL_DEFINITIONS.length}`);
}
