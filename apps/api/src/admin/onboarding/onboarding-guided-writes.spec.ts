import { MAX_ONBOARDING_RTUS, type OnboardingDraft } from "@bms/shared";

import { CREDENTIAL_TOOL_ERROR, EXISTING_KEYS_NEED_KW_ERROR, INVALID_CONFIG_PREFIX, TOOL_DEFINITIONS, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import {
  GUIDED_CONFIG_REFUSAL,
  GUIDED_CREDENTIAL_REFUSAL,
  GUIDED_DEPTH_REFUSAL,
  GUIDED_EXISTING_KEYS_REFUSAL,
  GUIDED_KW_INACTIVE_REFUSAL,
  GUIDED_MARKER_REFUSAL,
  GUIDED_OTHER_REFUSAL,
  GUIDED_SCHEMA_REFUSAL,
  GUIDED_TOOL_COVERAGE,
  guidedCapRefusal,
  guidedRefusal,
  guidedWrite,
} from "./onboarding-guided-writes";
import { PROMPT_OMITTED_MARKER } from "./onboarding-prompt-budget";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { DRAFT_TOO_DEEP_MESSAGE, MAX_ONBOARDING_DRAFT_DEPTH } from "./onboarding.schema";

/**
 * F3.27 (ADR 0090 Amendment 2 B4) — `guidedWrite` is the one way the guided
 * mode writes the draft: it runs the registry's `runTool`, so the caps, the
 * depth bound, the credential and prompt-marker refusals and the code-written
 * action line are the agent path's own. These cases drive it directly; the
 * guided branches call it from U4 on.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The protocol, catalog and inventory reads throw: no guided write may reach them. */
function context(): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }] as never,
    catalog: {
      listPointKeys: async () => {
        throw new Error("a guided write read the catalog");
      },
      listInUsePointKeys: async () => {
        throw new Error("a guided write read the catalog");
      },
    },
    inventory: {
      listExisting: async () => {
        throw new Error("a guided write read the inventory");
      },
    },
    protocols: {
      getContextForOrganization: async () => {
        throw new Error("a guided write read the protocols");
      },
      formatForAssistant: () => {
        throw new Error("a guided write formatted the protocols");
      },
    },
    validator: new OnboardingValidateService(),
    templates: EMPTY_TEMPLATE_CONTEXT,
  };
}

const MQTT_RTU = { code: "RTU-1", displayName: "RTU-1", protocol: "mqtt" as const, config: { host: "broker", port: 8883, tls: true, topic: "a/b" } };

/** A count cap refuses with the guided cap sentence (the cap, not the over-cap count), and the working draft keeps its RTUs. */
export async function assertACountCapIsRefusedWithTheCapSentence(): Promise<void> {
  const rtus = Array.from({ length: MAX_ONBOARDING_RTUS }, (_, i) => ({ ...MQTT_RTU, code: `RTU-${i}`, credentialsSet: false }));
  const state: ToolState = { working: { rtus } as OnboardingDraft };
  const out = await guidedWrite("add_rtu", { ...MQTT_RTU, code: "RTU-X" }, state, context());
  const expected = guidedCapRefusal("RTUs", MAX_ONBOARDING_RTUS);
  assert(!out.ok && out.error === expected, `the cap sentence is the error: ${JSON.stringify(out)}`);
  assert(state.working.rtus?.length === MAX_ONBOARDING_RTUS, "the working draft still holds the cap");
}

/** A credential in an RTU config is refused with the guided sentence, never the model-facing one. */
export async function assertACredentialIsRefused(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await guidedWrite("add_rtu", { ...MQTT_RTU, config: { ...MQTT_RTU.config, password: "x" } }, state, context());
  assert(!out.ok && out.error === GUIDED_CREDENTIAL_REFUSAL, `the credential error: ${JSON.stringify(out)}`);
  assert(out.ok || out.error !== CREDENTIAL_TOOL_ERROR, "the model-facing sentence does not reach the guided reply");
  assert((state.working.rtus?.length ?? 0) === 0, "nothing was written");
}

/** A location name that is the prompt-budget marker is refused, and the error names the marker. */
export async function assertAPromptMarkerIsRefused(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await guidedWrite("set_location", { name: PROMPT_OMITTED_MARKER }, state, context());
  assert(!out.ok && out.error === GUIDED_MARKER_REFUSAL, `the marker error: ${JSON.stringify(out)}`);
  assert(state.working.location === undefined, "nothing was written");
}

/** A passing write answers the code-written action line and applies the value. */
export async function assertAPassingWriteAnswersItsActionLine(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await guidedWrite("add_rtu", MQTT_RTU, state, context());
  assert(out.ok && out.actionLine === "Added RTU RTU-1 (mqtt)", `the action line: ${JSON.stringify(out)}`);
  assert(state.working.rtus?.length === 1, "the RTU is in the working draft");
}

/** A draft past the depth bound refuses the next write with the `PATCH` sentence. */
export async function assertTheDepthBoundIsRefused(): Promise<void> {
  let deep: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < MAX_ONBOARDING_DRAFT_DEPTH; i++) {
    deep = { child: deep };
  }
  const draft = { rtus: [{ ...MQTT_RTU, credentialsSet: false, config: { ...MQTT_RTU.config, extra: deep } }] } as OnboardingDraft;
  const state: ToolState = { working: draft };
  const out = await guidedWrite("add_point_key", { code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }, state, context());
  assert(!out.ok && out.error === GUIDED_DEPTH_REFUSAL, `the depth error: ${JSON.stringify(out)}`);
  assert(out.ok || out.error !== DRAFT_TOO_DEEP_MESSAGE, "the PATCH sentence does not reach the guided reply");
  assert((state.working.pointKeys?.length ?? 0) === 0, "nothing was written");
}

/** A schema refusal outside `set_location` answers the generic schema sentence, never zod text. */
export async function assertASchemaRefusalIsTheGuidedSentence(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await guidedWrite("add_point_key", { code: "kw" }, state, context());
  assert(!out.ok && out.error === GUIDED_SCHEMA_REFUSAL, `the schema error: ${JSON.stringify(out)}`);
}

/** A refusal `guidedRefusal` does not classify fails closed to the generic sentence, not the registry text. */
export async function assertAnUnclassifiedRefusalFailsClosed(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await guidedWrite("update_rtu", { index: 3, patch: {} }, state, context());
  assert(!out.ok && out.error === GUIDED_OTHER_REFUSAL, `the fallback error: ${JSON.stringify(out)}`);
}

/** Every registry tool is classified (U5 deepens this into the B7 coverage spec). */
export function assertEveryToolIsClassified(): void {
  const missing = TOOL_DEFINITIONS.map((tool) => tool.name).filter(
    (name) => !Object.prototype.hasOwnProperty.call(GUIDED_TOOL_COVERAGE, name),
  );
  assert(missing.length === 0, `unclassified tools: ${missing.join(", ")}`);
}

/** F3.23 G1 (ADR 0092 decision 3): the no-active-kw refusal answers its own guided sentence, not the fallback. */
export function assertTheExistingKeysRefusalIsItsGuidedSentence(): void {
  const sentence = guidedRefusal("use_existing_point_keys", EXISTING_KEYS_NEED_KW_ERROR);
  assert(sentence === GUIDED_EXISTING_KEYS_REFUSAL, `the guided sentence, got ${sentence}`);
}

/** F3.23 G1, driven: "use existing keys" on a catalog with no active kw writes nothing and answers that sentence. */
export async function assertUseExistingKeysWithoutKwIsRefusedOnTheGuidedPath(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await guidedWrite("use_existing_point_keys", { value: true }, state, context());
  assert(!out.ok && out.error === GUIDED_EXISTING_KEYS_REFUSAL, `the guided refusal: ${JSON.stringify(out)}`);
  assert(state.working.onboardingMeta === undefined, "nothing was written");
}

/**
 * F3.23 review — a catalog that holds `kw` inactive answers its own sentence, which never says "Say kw":
 * a draft declaration of `kw` would land and auto map's `map_point` would then refuse it, a loop.
 */
export async function assertUseExistingKeysWithAnInactiveKwIsRefusedWithoutTheSayKwLoop(): Promise<void> {
  const state: ToolState = { working: {} };
  const ctx = { ...context(), templates: { ...EMPTY_TEMPLATE_CONTEXT, pointKeys: new Map([["kw", false]]) } };
  const out = await guidedWrite("use_existing_point_keys", { value: true }, state, ctx);
  assert(!out.ok && out.error === GUIDED_KW_INACTIVE_REFUSAL, `the inactive-kw refusal: ${JSON.stringify(out)}`);
  assert(!out.ok && !out.error.includes("Say **kw**"), "the sentence does not point to the declaration loop");
  assert(state.working.onboardingMeta === undefined, "nothing was written");
}

/** F3.24a G1 (ADR 0093 decision 5, plan Q4): a protocol-config refusal answers its own guided sentence. */
export function assertAConfigRefusalAnswersItsGuidedSentence(): void {
  const sentence = guidedRefusal("add_rtu", `${INVALID_CONFIG_PREFIX}mqtt: port: Expected number`);
  assert(sentence === GUIDED_CONFIG_REFUSAL, `the config sentence, got ${sentence}`);
}

/** G1's adjacent negative: an unrelated refusal still fails closed. */
export function assertAnUnrelatedRefusalIsNotTheConfigSentence(): void {
  const sentence = guidedRefusal("add_rtu", "Something else went wrong.");
  assert(sentence === GUIDED_OTHER_REFUSAL, `the fallback, got ${sentence}`);
}
