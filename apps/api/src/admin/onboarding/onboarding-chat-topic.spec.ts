import type { OnboardingDraft } from "@bms/shared";

import { needsMqttSetup } from "./onboarding-chat-summaries";
import { MAX_RTU_TOPIC_CHARS } from "./onboarding-excel.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.208` — the MQTT topic of an onboarding RTU: its length bound on the
 * draft, and the guided chat turn that sets it.
 *
 * Split from `onboarding-chat.service.spec.ts`, which is at AGENTS.md §4.5's
 * line ceiling; the guided-turn cases import its `ruleBasedTurn` harness rather
 * than copy it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type DraftRtu = NonNullable<OnboardingDraft["rtus"]>[number];

/** A location that passes `inferPhase`'s location gate, so a case reaches the RTU step. */
const LOCATION: NonNullable<OnboardingDraft["location"]> = {
  name: "Lotapata",
  slug: "lotapata",
  code: "LOTAPATA",
  type: "smoc_campus",
  latitude: 20.1,
  longitude: 85.1,
};

const ACTIVE_TYPES = ["smoc_campus"] as const;

/** An enabled MQTT RTU whose credential is stored; only the topic varies. */
function credentialedRtu(topic: string, overrides: Partial<DraftRtu> = {}): DraftRtu {
  return {
    code: "RTU-1",
    displayName: "RTU-1",
    protocol: "mqtt",
    ingestEnabled: true,
    credentialsSet: true,
    config: { host: "h", port: 8883, tls: true, topic },
    ...overrides,
  };
}

function draftWith(...rtus: DraftRtu[]): OnboardingDraft {
  return { location: { ...LOCATION }, rtus };
}

const OVER_LONG = "t".repeat(MAX_RTU_TOPIC_CHARS + 1);
const AT_BOUND = "t".repeat(MAX_RTU_TOPIC_CHARS);
const TOO_LONG_MESSAGE = "MQTT topic is longer than 255 characters";

// ---------------------------------------------------------------------------
// Task 2 — the length bound on the draft
// ---------------------------------------------------------------------------

/** A1 — an over-long topic counts as unusable, credential or not. */
export function assertAnOverLongTopicNeedsSetup(): void {
  assert(
    needsMqttSetup(credentialedRtu(OVER_LONG)),
    "a credentialed MQTT RTU with a 256-character topic still needs MQTT setup",
  );
}

/** A2 — `inferPhase` keeps such a draft on the RTU step instead of moving on to point keys. */
export function assertAnOverLongTopicKeepsTheRtuStep(): void {
  const phase = new OnboardingValidateService().inferPhase(draftWith(credentialedRtu(OVER_LONG)), ACTIVE_TYPES);
  assert(phase === "rtu", `an over-long topic keeps the phase at rtu, got ${phase}`);
}

function topicErrors(topic: string): string[] {
  const result = new OnboardingValidateService().validate(
    draftWith(credentialedRtu(topic)),
    ACTIVE_TYPES,
    EMPTY_TEMPLATE_CONTEXT,
  );
  return result.errors.filter((error) => error.path === "rtus.0.config.topic").map((error) => error.message);
}

/** A3 — `validate` names the over-long topic, so `readyToCommit` cannot reach the `varchar(255)` insert. */
export function assertAnOverLongTopicIsAValidationError(): void {
  const messages = topicErrors(OVER_LONG);
  assert(
    messages.includes(TOO_LONG_MESSAGE),
    `validate reports "${TOO_LONG_MESSAGE}" at rtus.0.config.topic, got ${JSON.stringify(messages)}`,
  );
}

/** A4 — the bound is inclusive: a topic of exactly 255 characters is not an error. */
export function assertATopicAtTheBoundIsNotAnError(): void {
  const messages = topicErrors(AT_BOUND);
  assert(messages.length === 0, `a 255-character topic is legal, got ${JSON.stringify(messages)}`);
}
