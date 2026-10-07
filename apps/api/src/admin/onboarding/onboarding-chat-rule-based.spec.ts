import type { OnboardingDraft } from "@bms/shared";

import { handleRuleBasedTurn, NAMES_A_PROTOCOL, type ChatTurnResult, type RuleBasedTurnDeps } from "./onboarding-chat-rule-based";
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

async function runTurn(message: string): Promise<{ result: ChatTurnResult; finalized: Finalized[]; reads: string[] }> {
  const finalized: Finalized[] = [];
  // F3.26 review L4: `runTool` swallows the fakes' throws, so each also records its call.
  const reads: string[] = [];
  const deps: RuleBasedTurnDeps = {
    validateService: new OnboardingValidateService(),
    catalogService: { listPointKeys: async () => [], formatPointKeysForChat: () => "" } as never,
    // F3.27 (B4 seam): the guided writes' tool context; its organization is the turn's.
    tools: {
      organizationId: "org-1",
      activeTypes: TURN.types,
      catalog: {
        listPointKeys: async () => [],
        listInUsePointKeys: async () => {
          reads.push("listInUsePointKeys");
          throw new Error("a guided turn read the in-use point keys");
        },
      },
      inventory: {
        listExisting: async () => {
          reads.push("listExisting");
          throw new Error("a guided turn read the inventory");
        },
      },
      protocols: {
        getContextForOrganization: async () => {
          reads.push("getContextForOrganization");
          throw new Error("a guided turn read the protocols");
        },
        formatForAssistant: () => {
          reads.push("formatForAssistant");
          throw new Error("a guided turn formatted the protocols");
        },
      },
      validator: new OnboardingValidateService(),
      templates: TURN.templates,
    },
    finalizeTurn: (...args) => {
      finalized.push(args);
      const [assistantMessage, draftPatch, currentPhase, suggestedReplies] = args;
      return { assistantMessage, draftPatch, currentPhase, suggestedReplies, actionLines: [] };
    },
  };
  const result = await handleRuleBasedTurn(deps, message, locationOnlyDraft(), "rtu", "Eskom", TURN);
  return { result, finalized, reads };
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

/** C5 (F4.220) — the service intercept's matcher reads a versioned MQTT spelling, and no embedded word. */
export function assertNamesAProtocol(text: string, expected: boolean): void {
  const got = NAMES_A_PROTOCOL.test(text.toLowerCase());
  assert(got === expected, `"${text}" expected ${String(expected)}, got ${String(got)}`);
}

/** C4 (F4.220) — every spelling the guided mode accepted before the word boundary still maps to its protocol. */
export async function assertAProtocolFormIsDetected(word: string, protocol: string): Promise<void> {
  const { result } = await runTurn(word);
  const got = result.draftPatch.rtus?.[0]?.protocol;
  assert(got === protocol, `"${word}" expected ${protocol}, got ${String(got)}`);
}

/** F3.27 (ADR 0090 Amendment 2 B4, B5) — the RTU step writes through `add_rtu` and answers its action line. */
export async function assertANamedProtocolAnswersItsActionLine(): Promise<void> {
  const { result } = await runTurn("modbus please");
  assert(
    JSON.stringify(result.actionLines) === JSON.stringify(["Added RTU RTU-1 (modbus_tcp)"]),
    `the add_rtu action line, got ${JSON.stringify(result.actionLines)}`,
  );
}

/** F3.26 review L4 — the add_rtu turn answers its action line and reads nothing of the organization. */
export async function assertAGuidedTurnReadsNothingOfTheOrganization(): Promise<void> {
  const { result, reads } = await runTurn("modbus please");
  assert(result.actionLines.length === 1, `the turn answered its action line, got ${JSON.stringify(result.actionLines)}`);
  assert(reads.length === 0, `a guided turn read ${JSON.stringify(reads)}`);
}
