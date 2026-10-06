import type { OnboardingDraft } from "@bms/shared";

import { handleRuleBasedTurn, type ChatTurnResult, type RuleBasedTurnDeps } from "./onboarding-chat-rule-based";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * F4.217 — the guided mode lives in `onboarding-chat-rule-based.ts` and takes
 * its collaborators through one `deps` object. These specs drive the module
 * directly, with a `finalizeTurn` fake that records what it was given, so the
 * seam is gated apart from `OnboardingChatService` (whose own specs reach the
 * same code through the service).
 */

const ACTIVE_TYPE = { code: "smoc_campus", label: "SMOC campus" } as never;
const TURN = { types: [ACTIVE_TYPE], templates: EMPTY_TEMPLATE_CONTEXT };

type Finalized = Parameters<RuleBasedTurnDeps["finalizeTurn"]>;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A location of the active type and no RTU, so the guided mode is at the RTU step. */
function locationOnlyDraft(): OnboardingDraft {
  return { location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", type: "smoc_campus", latitude: 22.3, longitude: 87.3 } } as never;
}

async function runTurn(message: string): Promise<{ result: ChatTurnResult; finalized: Finalized[] }> {
  const finalized: Finalized[] = [];
  const deps: RuleBasedTurnDeps = {
    validateService: new OnboardingValidateService(),
    catalogService: { listPointKeys: async () => [], formatPointKeysForChat: () => "" } as never,
    finalizeTurn: (...args) => {
      finalized.push(args);
      const [assistantMessage, draftPatch, currentPhase, suggestedReplies] = args;
      return { assistantMessage, draftPatch, currentPhase, suggestedReplies, actionLines: [] };
    },
  };
  const result = await handleRuleBasedTurn(deps, message, locationOnlyDraft(), "rtu", "Eskom", TURN, "org-1");
  return { result, finalized };
}

/** R1 — the append branch, `detectProtocol` and `defaultConfig` moved intact. */
export async function assertANamedProtocolAppendsAnRtuWithItsDefaultConfig(): Promise<void> {
  const { result } = await runTurn("modbus please");
  const rtu = result.draftPatch.rtus?.[0];
  assert(rtu?.protocol === "modbus_tcp", `expected modbus_tcp, got ${String(rtu?.protocol)}`);
  assert(rtu?.config?.port === 502, `expected port 502, got ${String(rtu?.config?.port)}`);
}

/** R2 — `defaultConfig` reads the topic out of the message. */
export async function assertAMqttMessageCarriesItsTopicIntoTheConfig(): Promise<void> {
  const { result } = await runTurn("mqtt topic: plant/a");
  const rtu = result.draftPatch.rtus?.[0];
  assert(rtu?.config?.topic === "plant/a", `expected topic plant/a, got ${String(rtu?.config?.topic)}`);
  assert(rtu?.ingestEnabled === true, "an MQTT RTU must be ingest-enabled");
}

/** R3 — `confirmStepTurn` and `stepPrompt` answer through the passed-in `finalizeTurn`, with an empty patch. */
export async function assertAConfirmStepAnswersThroughFinalizeWithNoPatch(): Promise<void> {
  const { result, finalized } = await runTurn("confirm rtu");
  assert(finalized.length === 1, `expected one finalizeTurn call, got ${finalized.length}`);
  assert(Object.keys(finalized[0][1]).length === 0, "a confirm reply must change nothing");
  assert(finalized[0][2] === "rtu", `expected phase rtu, got ${finalized[0][2]}`);
  // The generic "starts like a confirm" guard also answers with an empty patch; only `confirmStepTurn` names the step.
  assert(result.assistantMessage.startsWith("The RTU step is not complete yet."), `expected the step lead, got ${result.assistantMessage}`);
  assert(result.draftPatch.rtus === undefined, "a confirm reply must not append an RTU");
}

/** C3 (F4.220) — "restart" holds `rest` inside a word; it names no protocol, so the append falls back to MQTT. */
export async function assertAnEmbeddedProtocolWordFallsBackToMqtt(): Promise<void> {
  const { result } = await runTurn("restart it please");
  const protocol = result.draftPatch.rtus?.[0]?.protocol;
  assert(protocol === "mqtt", `expected mqtt, got ${String(protocol)}`);
}

/** C4 (F4.220) — every spelling the guided mode accepted before the word boundary still maps to its protocol. */
export async function assertAProtocolFormIsDetected(word: string, protocol: string): Promise<void> {
  const { result } = await runTurn(word);
  const got = result.draftPatch.rtus?.[0]?.protocol;
  assert(got === protocol, `"${word}" expected ${protocol}, got ${String(got)}`);
}
