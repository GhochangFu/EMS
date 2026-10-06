import { MAX_ONBOARDING_RTUS, type OnboardingDraft } from "@bms/shared";

import { CREDENTIAL_TOOL_ERROR, TOOL_DEFINITIONS, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import { draftCountProblem } from "./onboarding-draft-caps";
import { GUIDED_TOOL_COVERAGE, guidedWrite } from "./onboarding-guided-writes";
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

/** The protocol and catalog reads throw: no guided write may reach them. */
function context(): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }] as never,
    catalog: {
      listPointKeys: async () => {
        throw new Error("a guided write read the catalog");
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

/** A count cap refuses with the `draftCountProblem` sentence, and the working draft keeps its RTUs. */
export async function assertACountCapIsRefusedWithTheCapSentence(): Promise<void> {
  const rtus = Array.from({ length: MAX_ONBOARDING_RTUS }, (_, i) => ({ ...MQTT_RTU, code: `RTU-${i}`, credentialsSet: false }));
  const state: ToolState = { working: { rtus } as OnboardingDraft };
  const out = await guidedWrite("add_rtu", { ...MQTT_RTU, code: "RTU-X" }, state, context());
  const expected = draftCountProblem({ rtus: [...rtus, { ...MQTT_RTU, code: "RTU-X", credentialsSet: false }] } as OnboardingDraft);
  assert(expected !== null, "the fixture is over the cap");
  assert(!out.ok && out.error === expected, `the cap sentence is the error: ${JSON.stringify(out)}`);
  assert(state.working.rtus?.length === MAX_ONBOARDING_RTUS, "the working draft still holds the cap");
}

/** A credential in an RTU config is refused with the registry's sentence. */
export async function assertACredentialIsRefused(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await guidedWrite("add_rtu", { ...MQTT_RTU, config: { ...MQTT_RTU.config, password: "x" } }, state, context());
  assert(!out.ok && out.error === CREDENTIAL_TOOL_ERROR, `the credential error: ${JSON.stringify(out)}`);
  assert((state.working.rtus?.length ?? 0) === 0, "nothing was written");
}

/** A location name that is the prompt-budget marker is refused, and the error names the marker. */
export async function assertAPromptMarkerIsRefused(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await guidedWrite("set_location", { name: PROMPT_OMITTED_MARKER }, state, context());
  assert(!out.ok && out.error.includes("withheld-value marker"), `the marker error: ${JSON.stringify(out)}`);
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
  assert(!out.ok && out.error === DRAFT_TOO_DEEP_MESSAGE, `the depth error: ${JSON.stringify(out)}`);
  assert((state.working.pointKeys?.length ?? 0) === 0, "nothing was written");
}

/** Every registry tool is classified (U5 deepens this into the B7 coverage spec). */
export function assertEveryToolIsClassified(): void {
  const missing = TOOL_DEFINITIONS.map((tool) => tool.name).filter(
    (name) => !Object.prototype.hasOwnProperty.call(GUIDED_TOOL_COVERAGE, name),
  );
  assert(missing.length === 0, `unclassified tools: ${missing.join(", ")}`);
}
