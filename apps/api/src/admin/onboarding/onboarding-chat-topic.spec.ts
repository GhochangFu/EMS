import type { OnboardingDraft } from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { OnboardingChatService } from "./onboarding-chat.service";
import type { ChatTurnResult } from "./onboarding-chat.service";
import { ruleBasedTurn } from "./onboarding-chat.service.spec";
import { needsMqttSetup } from "./onboarding-chat-summaries";
import { mergeDraftPatch } from "./onboarding-draft-merge";
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

// ---------------------------------------------------------------------------
// Task 3 — the guided `topic: x` turn writes to the RTU in hand
// ---------------------------------------------------------------------------

/** The draft a guided session holds after "MQTT" and the Credentials field: one RTU, no topic. */
function waitingForATopic(overrides: Partial<DraftRtu> = {}): OnboardingDraft {
  return draftWith(credentialedRtu("", overrides));
}

function patchedRtus(result: ChatTurnResult): DraftRtu[] {
  return result.draftPatch.rtus ?? [];
}

/** T1 — the turn updates the RTU in hand; it does not append a second one. */
export async function assertATopicTurnUpdatesTheRtuInHand(): Promise<void> {
  const result = await ruleBasedTurn("topic: plant/a/rtu-1", waitingForATopic(), "rtu");
  assert(patchedRtus(result).length === 1, `one RTU after the turn, got ${patchedRtus(result).length}`);
}

/** T2 — the topic lands in that RTU's `config.topic`. */
export async function assertATopicTurnWritesTheTopic(): Promise<void> {
  const result = await ruleBasedTurn("topic: plant/a/rtu-1", waitingForATopic(), "rtu");
  const topic = patchedRtus(result)[0]?.config.topic;
  assert(topic === "plant/a/rtu-1", `config.topic is the typed topic, got ${String(topic)}`);
}

/** T3 — the rest of `config` is kept: the turn merges into it rather than replacing it. */
export async function assertATopicTurnKeepsTheRestOfTheConfig(): Promise<void> {
  const result = await ruleBasedTurn("topic: plant/a/rtu-1", waitingForATopic(), "rtu");
  const host = patchedRtus(result)[0]?.config.host;
  assert(host === "h", `config.host survives the topic turn, got ${String(host)}`);
}

/** T4 — with a credential and a topic the draft moves on to point keys. */
export async function assertATopicTurnMovesToPointKeys(): Promise<void> {
  const result = await ruleBasedTurn("topic: plant/a/rtu-1", waitingForATopic(), "rtu");
  assert(result.currentPhase === "point_keys", `the phase moves to point_keys, got ${result.currentPhase}`);
}

/**
 * T4b — the reply prompts the step the *patched* draft is at. `finalizeTurn`
 * takes the validator's phase and ignores the one passed to it, so T4 cannot
 * see a prompt computed for the wrong step; this case can.
 */
export async function assertATopicTurnOffersThePointKeyReply(): Promise<void> {
  const result = await ruleBasedTurn("topic: plant/a/rtu-1", waitingForATopic(), "rtu");
  const replies = result.suggestedReplies ?? [];
  assert(replies.includes("kw"), `the point-key reply "kw" is offered, got ${JSON.stringify(replies)}`);
}

/** T5 — the row's Done gate: "confirm rtu" on the stored draft says the RTU step is complete. */
export async function assertConfirmRtuIsCompleteAfterATopicTurn(): Promise<void> {
  const draft = waitingForATopic();
  const turn = await ruleBasedTurn("topic: plant/a/rtu-1", draft, "rtu");
  const confirm = await ruleBasedTurn("confirm rtu", mergeDraftPatch(draft, turn.draftPatch), turn.currentPhase);
  assert(
    confirm.assistantMessage.startsWith("The RTU step is complete."),
    `"confirm rtu" answers that the step is complete, got ${confirm.assistantMessage}`,
  );
}

/** T6 — an over-long topic is cut to the column's width, as `defaultConfig` cuts it. */
export async function assertAnOverLongTopicTurnIsCut(): Promise<void> {
  const result = await ruleBasedTurn(`topic: ${"p".repeat(300)}`, waitingForATopic(), "rtu");
  const topic = String(patchedRtus(result)[0]?.config.topic ?? "");
  assert(topic.length === MAX_RTU_TOPIC_CHARS, `the stored topic is cut to 255, got ${topic.length}`);
}

/** T7 — the turn sets a topic and nothing else: an RTU without a credential still waits for one. */
export async function assertATopicTurnDoesNotStandInForTheCredential(): Promise<void> {
  const result = await ruleBasedTurn("topic: plant/a/rtu-1", waitingForATopic({ credentialsSet: false }), "rtu");
  assert(result.currentPhase === "rtu", `the phase stays at rtu, got ${result.currentPhase}`);
  assert(
    result.assistantMessage.includes("1 MQTT RTU(s) still need credentials"),
    `the reply names the waiting credential, got ${result.assistantMessage}`,
  );
}

/** T8 — with no MQTT RTU in the draft the turn still appends one, as before this row. */
export async function assertATopicTurnWithNoRtuAppends(): Promise<void> {
  const result = await ruleBasedTurn("topic: plant/a/rtu-1", draftWith(), "rtu");
  const rtus = patchedRtus(result);
  assert(rtus.length === 1, `the turn appends one RTU to an empty list, got ${rtus.length}`);
  assert(rtus[0]?.config.topic === "plant/a/rtu-1", "the appended RTU carries the topic");
}

/**
 * T9 — a topic that itself contains a protocol word (`mqtt/…`) still updates.
 * The protocol test reads the message *without* the topic, or a real topic such
 * as `site/sim/rtu` would be taken for a new RTU's protocol.
 */
export async function assertATopicNamingAProtocolStillUpdates(): Promise<void> {
  const result = await ruleBasedTurn("topic: mqtt/plant/rtu-1", waitingForATopic(), "rtu");
  assert(patchedRtus(result).length === 1, `one RTU after the turn, got ${patchedRtus(result).length}`);
}

/** T10 — "add another rtu" with a topic still adds an RTU. */
export async function assertAddAnotherRtuWithATopicAppends(): Promise<void> {
  const result = await ruleBasedTurn("add another rtu topic: plant/b", waitingForATopic(), "rtu");
  assert(patchedRtus(result).length === 2, `"add another rtu" appends, got ${patchedRtus(result).length} RTU(s)`);
}

/** Three credentialed MQTT RTUs with the given topics, coded RTU-1..RTU-3. */
function threeRtus(topics: [string, string, string]): OnboardingDraft {
  return draftWith(
    ...topics.map((topic, i) => credentialedRtu(topic, { code: `RTU-${i + 1}`, displayName: `RTU-${i + 1}` })),
  );
}

/** T11 (owner ruling) — the RTU in hand is the first one still waiting for a topic, not the first or the last. */
export async function assertTheFirstWaitingRtuIsInHand(): Promise<void> {
  const result = await ruleBasedTurn("topic: plant/new", threeRtus(["plant/a", "", "plant/c"]), "rtu");
  const topics = patchedRtus(result).map((rtu) => rtu.config.topic);
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/a", "plant/new", "plant/c"]),
    `the topic lands on RTU-2, the first waiting, got ${JSON.stringify(topics)}`,
  );
}

/** T12 (owner ruling) — with none waiting, the last enabled MQTT RTU is in hand. */
export async function assertTheLastRtuIsInHandWhenNoneWaits(): Promise<void> {
  const result = await ruleBasedTurn("topic: plant/new", threeRtus(["plant/a", "plant/b", "plant/c"]), "point_keys");
  const topics = patchedRtus(result).map((rtu) => rtu.config.topic);
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/a", "plant/b", "plant/new"]),
    `the topic lands on RTU-3, the last, got ${JSON.stringify(topics)}`,
  );
}

// ---------------------------------------------------------------------------
// A5 — a topic-only PATCH keeps the stored credential (regression guard)
// ---------------------------------------------------------------------------

const KEY_A = Buffer.alloc(32, 0x01).toString("base64");
const KEY_VARS = ["CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_ENCRYPTION_KEY_VERSION", "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS"];

/** Built as `onboarding-chat-credentials.spec.ts` builds it: `mergeDraft` needs the real crypto. */
function credentialChatService(): OnboardingChatService {
  return new OnboardingChatService(
    new OnboardingValidateService(),
    new CredentialCryptoService(),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
  );
}

type StoredDraft = { rtus?: DraftRtu[]; _secrets?: Record<string, unknown> };

/**
 * Stores a credential, then merges the patch the web's Topic field sends: the
 * same RTU with a new topic. The patch says `credentialsSet: false`, so a
 * `true` after the merge was derived from the store, not echoed from the body.
 */
function mergeATopicOnlyPatch(): StoredDraft {
  const previous = Object.fromEntries(KEY_VARS.map((key) => [key, process.env[key]]));
  process.env.CREDENTIAL_ENCRYPTION_KEY = KEY_A;
  process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION = "2";
  delete process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
  try {
    const service = credentialChatService();
    const rtu = credentialedRtu("", { credentialsSet: false });
    const stored = service.mergeDraft(draftWith(rtu), {}, { rtuIndex: 0, credentials: { password: "x" } });
    const patched = { ...rtu, config: { ...rtu.config, topic: "plant/a" } };
    return service.mergeDraft(stored, { rtus: [patched] }) as StoredDraft;
  } finally {
    for (const key of KEY_VARS) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/** A5a — the encrypted blob of the RTU survives a PATCH that only changes its topic. */
export function assertATopicOnlyPatchKeepsTheSecret(): void {
  const next = mergeATopicOnlyPatch();
  assert(next._secrets?.["RTU-1"] !== undefined, "the stored credential of RTU-1 survives the topic patch");
}

/** A5b — and the RTU still reads as credentialed, with the new topic. */
export function assertATopicOnlyPatchKeepsCredentialsSet(): void {
  const next = mergeATopicOnlyPatch();
  assert(next.rtus?.[0]?.credentialsSet === true, "RTU-1 still reads credentialsSet: true");
  assert(next.rtus?.[0]?.config.topic === "plant/a", "RTU-1 carries the patched topic");
}
