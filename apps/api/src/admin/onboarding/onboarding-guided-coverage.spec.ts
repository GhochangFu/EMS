import type { OnboardingDraft, OnboardingPhase } from "@bms/shared";

import { isToolName, TOOL_DEFINITIONS, type ToolName } from "./onboarding-agent-tools";
import { handleRuleBasedTurn, type RuleBasedTurnDeps } from "./onboarding-chat-rule-based";
import { GUIDED_TOOL_COVERAGE } from "./onboarding-guided-writes";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * F3.27 U5 (ADR 0090 Amendment 2 B7) — the tool-coverage spec. Every registry
 * tool is classified guided-covered or agent-only with a reason, and every
 * guided-covered tool is proven by driving the guided mode and finding its
 * code-written action line.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ACTIVE_TYPE = { code: "smoc_campus", label: "SMOC campus" } as never;
// F3.23 (ADR 0092 decision 3): "use existing keys" needs `kw` active in the fleet catalog, as the global seed holds it.
const TURN = { types: [ACTIVE_TYPE], templates: { ...EMPTY_TEMPLATE_CONTEXT, pointKeys: new Map([["kw", true]]) } };

const PLACE = { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", type: "smoc_campus", latitude: 22.3, longitude: 87.3 };
const MODBUS_RTU = { code: "RTU-1", displayName: "RTU-1", protocol: "modbus_tcp", config: { host: "127.0.0.1", port: 502, unitId: 1, pollIntervalMs: 5000 }, credentialsSet: false, ingestEnabled: false };
const MQTT_RTU = { code: "RTU-1", displayName: "RTU-1", protocol: "mqtt", config: { host: "h", port: 8883, tls: true, topic: "" }, credentialsSet: true, ingestEnabled: true };
const KW = { code: "kw", name: "Active Power", domain: "electrical", unit: "kW" };
const ASSET = { rtuIndex: 0, code: "BERHAMPUR-ASSET-1", name: "Primary Device", siteName: "Berhampur", domain: "electrical" };

type Proof = { readonly draft: unknown; readonly message: string; readonly phase: OnboardingPhase; readonly linePrefix: string };

/** One proof per guided tool: a draft at the step, the message that reaches the branch, and the action line it must answer. */
const PROOF: Readonly<Partial<Record<ToolName, Proof>>> = {
  set_location: { draft: {}, message: "Berhampur", phase: "location", linePrefix: "Set location" },
  add_rtu: { draft: { location: PLACE }, message: "modbus please", phase: "rtu", linePrefix: "Added RTU" },
  update_rtu: { draft: { location: PLACE, rtus: [MQTT_RTU] }, message: "topic: plant/a/rtu-1", phase: "rtu", linePrefix: "Updated RTU" },
  add_point_key: { draft: { location: PLACE, rtus: [MODBUS_RTU] }, message: "kw", phase: "point_keys", linePrefix: "Added point key" },
  add_asset: { draft: { location: PLACE, rtus: [MODBUS_RTU], pointKeys: [KW] }, message: "One asset", phase: "assets", linePrefix: "Added asset" },
  map_point: { draft: { location: PLACE, rtus: [MODBUS_RTU], pointKeys: [KW], assets: [ASSET] }, message: "auto map", phase: "mappings", linePrefix: "Mapped" },
  use_existing_point_keys: { draft: { location: PLACE, rtus: [MODBUS_RTU] }, message: "use existing keys", phase: "point_keys", linePrefix: "Point keys: using" },
};

function guidedNames(): string[] {
  return Object.entries(GUIDED_TOOL_COVERAGE)
    .filter(([, entry]) => entry.mode === "guided")
    .map(([name]) => name)
    .sort();
}

/** Claim 1 — both directions: the registry and the table name the same tools. */
export function assertTheTableAndTheRegistryNameTheSameTools(): void {
  for (const definition of TOOL_DEFINITIONS) {
    assert(definition.name in GUIDED_TOOL_COVERAGE, `${definition.name} has no GUIDED_TOOL_COVERAGE entry`);
  }
  for (const key of Object.keys(GUIDED_TOOL_COVERAGE)) {
    assert(isToolName(key), `GUIDED_TOOL_COVERAGE names "${key}", which is not a registry tool`);
  }
  assert(Object.keys(GUIDED_TOOL_COVERAGE).length === TOOL_DEFINITIONS.length, "the table and the registry differ in size");
}

/** Claim 2 — an agent-only tool carries a reason that names a row, an ADR decision or the fixed prompts. */
export function assertEveryAgentOnlyToolHasAReason(): void {
  for (const [name, entry] of Object.entries(GUIDED_TOOL_COVERAGE)) {
    if (entry.mode !== "agent_only") {
      continue;
    }
    assert(entry.reason.trim().length > 0, `${name} has an empty reason`);
    assert(/F3\.2[3-6]|ADR \d{4}|Amendment|fixed prompts|B\d|finalizeTurn/.test(entry.reason), `${name}'s reason names no row or decision: ${entry.reason}`);
  }
}

/** Claim 3a — the proof map and the guided classification list the same tools. */
export function assertTheProofMapCoversEveryGuidedTool(): void {
  const proved = Object.keys(PROOF).sort();
  assert(JSON.stringify(proved) === JSON.stringify(guidedNames()), `PROOF ${JSON.stringify(proved)} vs guided ${JSON.stringify(guidedNames())}`);
}

function depsFor(): RuleBasedTurnDeps {
  const validator = new OnboardingValidateService();
  const catalog = { listPointKeys: async () => [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }] };
  return {
    validateService: validator,
    catalogService: { ...catalog, formatPointKeysForChat: () => "" } as never,
    tools: {
      organizationId: "org-1",
      activeTypes: TURN.types,
      catalog: {
        ...catalog,
        listInUsePointKeys: async () => {
          throw new Error("a guided turn read the in-use point keys");
        },
      },
      inventory: {
        listExisting: async () => {
          throw new Error("a guided turn read the inventory");
        },
      },
      protocols: {
        getContextForOrganization: async () => {
          throw new Error("a guided turn read the protocols");
        },
        formatForAssistant: () => {
          throw new Error("a guided turn formatted the protocols");
        },
      },
      validator,
      templates: TURN.templates,
    },
    finalizeTurn: (assistantMessage, draftPatch, currentPhase, suggestedReplies) => ({
      assistantMessage,
      draftPatch,
      currentPhase,
      suggestedReplies,
      actionLines: [],
    }),
  };
}

/** Claim 3b — each guided tool's branch answers an action line with its prefix. */
export async function assertEveryGuidedToolAnswersItsActionLine(): Promise<void> {
  for (const [name, proof] of Object.entries(PROOF) as [ToolName, Proof][]) {
    const result = await handleRuleBasedTurn(depsFor(), proof.message, proof.draft as OnboardingDraft, proof.phase, "Eskom", TURN);
    assert(
      result.actionLines.some((line) => line.startsWith(proof.linePrefix)),
      `${name}: no action line starts with "${proof.linePrefix}", got ${JSON.stringify(result.actionLines)}`,
    );
  }
}
