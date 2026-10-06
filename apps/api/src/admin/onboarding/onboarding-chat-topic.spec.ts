import type { OnboardingDraft } from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { OnboardingChatService } from "./onboarding-chat.service";
import type { ChatTurnResult } from "./onboarding-chat.service";
import { ruleBasedTurn } from "./onboarding-chat.service.spec";
import { MQTT_TOPIC_PLACEHOLDER, mqttSetupTemplate, needsMqttSetup, rtuInHand } from "./onboarding-chat-summaries";
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

/**
 * T12 (owner ruling) — with none waiting, the last enabled MQTT RTU is in hand.
 * Asserted on `rtuInHand` itself: since review a guided turn updates a topic
 * only while the derived phase is `rtu`, and a draft with none waiting has
 * moved past it (B2 is that turn).
 */
export function assertTheLastRtuIsInHandWhenNoneWaits(): void {
  const index = rtuInHand(threeRtus(["plant/a", "plant/b", "plant/c"]));
  assert(index === 2, `RTU-3, the last, is in hand, got index ${index}`);
}

/** The topics of the draft after the turn's patch is merged into it. */
function mergedTopics(draft: OnboardingDraft, result: ChatTurnResult): unknown[] {
  return (mergeDraftPatch(draft, result.draftPatch).rtus ?? []).map((rtu) => rtu.config.topic);
}

/** B1 — a sentence that mentions a topic without a colon does not overwrite the RTU in hand. */
export async function assertATopicQuestionDoesNotUpdate(): Promise<void> {
  const draft = waitingForATopic();
  const result = await ruleBasedTurn("what topic should I use", draft, "rtu");
  const topics = mergedTopics(draft, result);
  assert(topics[0] === "", `RTU-1 keeps its empty topic, got ${JSON.stringify(topics)}`);
}

/** B3 (F4.218) — the same sentence appends no RTU, where it used to add RTU-2 with topic `should`. */
export async function assertATopicQuestionAppendsNoRtu(): Promise<void> {
  const draft = waitingForATopic();
  const result = await ruleBasedTurn("what topic should I use", draft, "rtu");
  const count = (mergeDraftPatch(draft, result.draftPatch).rtus ?? []).length;
  assert(count === 1, `a topic question leaves one RTU, got ${count}`);
}

/** B3b — the positive partner of B3: the question is answered with the colon form, the draft untouched. */
export async function assertATopicQuestionIsAnsweredWithTheColonForm(): Promise<void> {
  const result = await ruleBasedTurn("what topic should I use", waitingForATopic(), "rtu");
  assert(
    result.assistantMessage.startsWith("I did not change the draft."),
    `the reply says the draft is unchanged, got ${result.assistantMessage}`,
  );
  assert(result.assistantMessage.includes("topic: <topic>"), `the reply shows the colon form, got ${result.assistantMessage}`);
  assert(result.currentPhase === "rtu", `the phase stays at rtu, got ${result.currentPhase}`);
}

/** B3c — guard boundary: a protocol reply that forgot the colon is still an append. */
export async function assertAForgottenColonWithAProtocolWordStillAppends(): Promise<void> {
  const draft = waitingForATopic();
  const result = await ruleBasedTurn("mqtt topic plant/x", draft, "rtu");
  const count = (mergeDraftPatch(draft, result.draftPatch).rtus ?? []).length;
  assert(count === 2, `"mqtt topic plant/x" appends an RTU, got ${count} RTU(s)`);
}

/** B4 (F4.218) — the append-time capture needs the colon: `topic plant/b` stores no topic. */
export async function assertAddAnotherRtuWithoutAColonStoresNoTopic(): Promise<void> {
  const result = await ruleBasedTurn("add another rtu topic plant/b", waitingForATopic(), "rtu");
  const topic = patchedRtus(result)[1]?.config.topic;
  assert(topic === "", `no colon, no topic, got ${JSON.stringify(topic)}`);
}

/** B5 — the positive control of B4: with the colon the append stores the topic. */
export async function assertAddAnotherRtuWithAColonStoresTheTopic(): Promise<void> {
  const result = await ruleBasedTurn("add another rtu topic: plant/b", waitingForATopic(), "rtu");
  const topic = patchedRtus(result)[1]?.config.topic;
  assert(topic === "plant/b", `the colon form stores the topic, got ${JSON.stringify(topic)}`);
}

/** B2 — "topic: x" past the RTU step changes no RTU's topic. */
export async function assertATopicTurnPastTheRtuStepDoesNotUpdate(): Promise<void> {
  const draft = threeRtus(["plant/a", "plant/b", "plant/c"]);
  const result = await ruleBasedTurn("topic: plant/new", draft, "point_keys");
  const topics = mergedTopics(draft, result);
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/a", "plant/b", "plant/c"]),
    `every topic is unchanged past the RTU step, got ${JSON.stringify(topics)}`,
  );
}

/**
 * Enabled MQTT RTUs whose display names differ from their codes, as an
 * imported workbook's do: RTU-1 lacks only its credential, the others only a topic.
 */
function templateDraft(count: 2 | 3): OnboardingDraft {
  const rtus = [
    credentialedRtu("plant/a", { code: "RTU-1", displayName: "Pump House A", credentialsSet: false }),
    credentialedRtu("", { code: "RTU-2", displayName: "Pump House B" }),
    credentialedRtu("", { code: "RTU-3", displayName: "Pump House C" }),
  ];
  return draftWith(...rtus.slice(0, count));
}

/** The paste-back blocks of the service's own MQTT setup template, between its markers. */
function templateBlocks(draft: OnboardingDraft): string[] {
  const text = mqttSetupTemplate(draft);
  const body = text.slice(text.indexOf("START COPY"), text.indexOf("────────── END COPY"));
  return body.slice(body.indexOf("\n") + 1).trim().split("\n---\n");
}

/** C1 — the whole template pasted back with its first block's topic filled in sets that block's RTU. */
export async function assertAPastedTemplateSetsItsFirstBlocksRtu(): Promise<void> {
  const draft = templateDraft(2);
  const blocks = templateBlocks(draft);
  assert(blocks[0]?.startsWith("RTU: 'Pump House A'"), `the template lists RTU-1 first, got ${JSON.stringify(blocks)}`);
  blocks[0] = blocks[0].replace(/topic: .*/, "topic: plant/new");
  const result = await ruleBasedTurn(blocks.join("\n---\n"), draft, "rtu");
  const topics = mergedTopics(draft, result);
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/new", ""]),
    `the topic lands on RTU-1, the block it was written in, got ${JSON.stringify(topics)}`,
  );
}

/** C2 — one pasted block that names an RTU sets that RTU, not the RTU in hand. */
export async function assertAPastedBlockSetsTheRtuItNames(): Promise<void> {
  const draft = templateDraft(3);
  const block = templateBlocks(draft).find((text) => text.startsWith("RTU: 'Pump House C'")) ?? "";
  const result = await ruleBasedTurn(block.replace(/topic: .*/, "topic: plant/c"), draft, "rtu");
  const topics = mergedTopics(draft, result);
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/a", "", "plant/c"]),
    `the topic lands on RTU-3, the RTU the block names, got ${JSON.stringify(topics)}`,
  );
}

/** Runs each message as a guided turn on the draft the previous one left, from phase `rtu`. */
async function chainedTurns(draft: OnboardingDraft, messages: string[]): Promise<OnboardingDraft> {
  let current = draft;
  let phase: ChatTurnResult["currentPhase"] = "rtu";
  for (const message of messages) {
    const result = await ruleBasedTurn(message, current, phase);
    current = mergeDraftPatch(current, result.draftPatch);
    phase = result.currentPhase;
  }
  return current;
}

/**
 * G1 — the RTU in hand is the one whose *topic* is missing. A topic set on
 * RTU-1 before its credential is saved, then "add another rtu": the next bare
 * `topic:` belongs to RTU-2, not to RTU-1, which still lacks only a credential.
 */
export async function assertABareTopicLandsOnTheRtuMissingATopic(): Promise<void> {
  const draft = await chainedTurns(draftWith(), ["mqtt", "topic: plant/a", "add another rtu", "topic: plant/b"]);
  const topics = (draft.rtus ?? []).map((rtu) => rtu.config.topic);
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/a", "plant/b"]),
    `the second topic lands on RTU-2, got ${JSON.stringify(topics)}`,
  );
}

/** Enabled MQTT RTUs with a credential and no topic, one per display name, coded RTU-1..RTU-n. */
function namedRtus(...names: string[]): OnboardingDraft {
  return draftWith(...names.map((displayName, i) => credentialedRtu("", { code: `RTU-${i + 1}`, displayName })));
}

/** G2 — a block whose display name holds a protocol word (`Sim`) is still a topic turn, not a new RTU. */
export async function assertAPastedBlockNamingAProtocolWordSetsItsRtu(): Promise<void> {
  const draft = namedRtus("Pump House A", "Sim House C");
  const block = templateBlocks(draft).find((text) => text.startsWith("RTU: 'Sim House C'")) ?? "";
  const topics = mergedTopics(draft, await ruleBasedTurn(block.replace(/topic: .*/, "topic: plant/c"), draft, "rtu"));
  assert(
    JSON.stringify(topics) === JSON.stringify(["", "plant/c"]),
    `the topic lands on 'Sim House C' and no RTU is appended, got ${JSON.stringify(topics)}`,
  );
}

/** G3 — a later block's topic that holds a protocol word (`site/mqtt/b`) does not make the paste a new RTU. */
export async function assertALaterBlocksTopicDoesNotAppend(): Promise<void> {
  const draft = templateDraft(2);
  const blocks = templateBlocks(draft);
  blocks[0] = blocks[0].replace(/topic: .*/, "topic: plant/new");
  blocks[1] = blocks[1].replace(/topic: .*/, "topic: site/mqtt/b");
  const topics = mergedTopics(draft, await ruleBasedTurn(blocks.join("\n---\n"), draft, "rtu"));
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/new", ""]),
    `the first block's topic lands on RTU-1 and no RTU is appended, got ${JSON.stringify(topics)}`,
  );
}

/** H1 — the template's own placeholder is not a usable topic. */
export function assertThePlaceholderTopicNeedsSetup(): void {
  assert(
    needsMqttSetup(credentialedRtu(MQTT_TOPIC_PLACEHOLDER)),
    `a credentialed MQTT RTU whose topic is "${MQTT_TOPIC_PLACEHOLDER}" still needs MQTT setup`,
  );
}

/** H2 — an unedited block pasted back does not move the draft past the RTU step. */
export async function assertAnUneditedBlockKeepsTheRtuStep(): Promise<void> {
  const draft = waitingForATopic();
  const result = await ruleBasedTurn(templateBlocks(draft)[0] ?? "", draft, "rtu");
  assert(result.currentPhase === "rtu", `the phase stays at rtu, got ${result.currentPhase}`);
}

/** G4 — a block that names a disabled MQTT RTU does not set its topic; the RTU in hand takes it. */
export async function assertABlockNamingADisabledRtuDoesNotTargetIt(): Promise<void> {
  const draft = draftWith(
    credentialedRtu("", { code: "RTU-1", displayName: "Pump House A" }),
    credentialedRtu("", { code: "RTU-2", displayName: "Pump House B", ingestEnabled: false }),
  );
  const topics = mergedTopics(draft, await ruleBasedTurn("RTU: 'Pump House B'\ntopic: plant/x", draft, "rtu"));
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/x", ""]),
    `the disabled RTU-2 keeps its empty topic, got ${JSON.stringify(topics)}`,
  );
}

/** G5 — a block may name its RTU by code. */
export async function assertABlockNamingAnRtuByCodeSetsIt(): Promise<void> {
  const draft = templateDraft(3);
  const topics = mergedTopics(draft, await ruleBasedTurn("RTU: RTU-3\ntopic: plant/c", draft, "rtu"));
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/a", "", "plant/c"]),
    `the topic lands on RTU-3, named by its code, got ${JSON.stringify(topics)}`,
  );
}

/** G6 — a block may name its RTU by its display name without the template's quotes. */
export async function assertABlockNamingAnRtuByBareNameSetsIt(): Promise<void> {
  const draft = templateDraft(3);
  const topics = mergedTopics(draft, await ruleBasedTurn("RTU: Pump House C\ntopic: plant/c", draft, "rtu"));
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/a", "", "plant/c"]),
    `the topic lands on RTU-3, named by its bare display name, got ${JSON.stringify(topics)}`,
  );
}

/** G7 — a name two RTUs share picks neither; the RTU in hand takes the topic. */
export async function assertASharedNameFallsBackToTheRtuInHand(): Promise<void> {
  const draft = namedRtus("Pump House A", "Pump House", "Pump House");
  const topics = mergedTopics(draft, await ruleBasedTurn("RTU: 'Pump House'\ntopic: plant/x", draft, "rtu"));
  assert(
    JSON.stringify(topics) === JSON.stringify(["plant/x", "", ""]),
    `the topic lands on RTU-1, the RTU in hand, got ${JSON.stringify(topics)}`,
  );
}

/** D1 — the bound is inclusive: a credentialed MQTT RTU with a 255-character topic is not waiting. */
export function assertATopicAtTheBoundDoesNotNeedSetup(): void {
  assert(!needsMqttSetup(credentialedRtu(AT_BOUND)), "a 255-character topic does not need MQTT setup");
}

/** E1 — a disabled MQTT RTU with nothing set is never in hand; the enabled one after it is. */
export function assertADisabledMqttRtuIsNotInHand(): void {
  const disabled = credentialedRtu("", { code: "RTU-1", ingestEnabled: false, credentialsSet: false });
  const index = rtuInHand(draftWith(disabled, credentialedRtu("", { code: "RTU-2" })));
  assert(index === 1, `RTU-2, the enabled MQTT RTU, is in hand, got index ${index}`);
}

/** E2 — a non-MQTT RTU after the last MQTT one is never in hand. */
export function assertANonMqttRtuIsNotInHand(): void {
  const modbus: DraftRtu = { code: "RTU-2", displayName: "RTU-2", protocol: "modbus_tcp", config: {}, credentialsSet: false };
  const index = rtuInHand(draftWith(credentialedRtu("plant/a"), modbus));
  assert(index === 0, `RTU-1, the last MQTT RTU, is in hand, got index ${index}`);
}

/** The validation messages at `rtus.0.config.topic` for a one-RTU draft. */
function rtuTopicErrors(rtu: DraftRtu): string[] {
  const result = new OnboardingValidateService().validate(draftWith(rtu), ACTIVE_TYPES, EMPTY_TEMPLATE_CONTEXT);
  return result.errors.filter((error) => error.path === "rtus.0.config.topic").map((error) => error.message);
}

/** F1 — a non-string `config.topic` is skipped as the commit skips it, so an over-long `mqttTopic` is the error. */
export function assertANonStringTopicFallsBackToMqttTopic(): void {
  const messages = rtuTopicErrors(credentialedRtu("", { config: { topic: 42, mqttTopic: OVER_LONG } }));
  assert(messages.includes(TOO_LONG_MESSAGE), `the over-long mqttTopic is an error, got ${JSON.stringify(messages)}`);
}

/** F2 — the commit writes the topic for every protocol, so an over-long one on a Modbus RTU is an error too. */
export function assertAnOverLongTopicOnAModbusRtuIsAnError(): void {
  const modbus: DraftRtu = {
    code: "RTU-1",
    displayName: "RTU-1",
    protocol: "modbus_tcp",
    config: { topic: OVER_LONG },
    credentialsSet: false,
  };
  const messages = rtuTopicErrors(modbus);
  assert(messages.includes(TOO_LONG_MESSAGE), `the over-long topic is an error, got ${JSON.stringify(messages)}`);
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

// ---------------------------------------------------------------------------
// F4.215 — a wildcard topic is unusable (ingest refuses it: mqtt.ts refine)
// ---------------------------------------------------------------------------

const WILDCARDS = ["#", "+", "plant/a/#", "plant/+/rtu-1"];
const WILDCARD_MESSAGE = "MQTT topic must name one device; # and + are wildcards";

/** W1 — a wildcard topic counts as unusable, credential or not. */
export function assertAWildcardTopicNeedsSetup(): void {
  for (const topic of WILDCARDS) {
    assert(needsMqttSetup(credentialedRtu(topic)), `a credentialed MQTT RTU with topic "${topic}" still needs MQTT setup`);
  }
}

/** W2 — `inferPhase` keeps such a draft on the RTU step. */
export function assertAWildcardTopicKeepsTheRtuStep(): void {
  const phase = new OnboardingValidateService().inferPhase(draftWith(credentialedRtu("plant/a/#")), ACTIVE_TYPES);
  assert(phase === "rtu", `a wildcard topic keeps the phase at rtu, got ${phase}`);
}

/** W3 — `validate` names the wildcard with exactly one message (not the length or required one). */
export function assertAWildcardTopicIsAValidationError(): void {
  for (const topic of WILDCARDS) {
    const messages = topicErrors(topic);
    assert(
      JSON.stringify(messages) === JSON.stringify([WILDCARD_MESSAGE]),
      `validate reports only the wildcard message for "${topic}", got ${JSON.stringify(messages)}`,
    );
  }
}

/** W4 — the wildcard RTU is the one in hand, so the next `topic:` turn repairs it. */
export function assertAWildcardTopicIsInHand(): void {
  const index = rtuInHand(draftWith(credentialedRtu("plant/#"), credentialedRtu("ok/topic", { code: "RTU-2" })));
  assert(index === 0, `the RTU with the wildcard topic is in hand, got index ${index}`);
}

/** W5 — the refusal is gated on `mqtt`: a wildcard on a Modbus RTU is not an error. */
export function assertAWildcardOnAModbusRtuIsNotAnError(): void {
  const result = new OnboardingValidateService().validate(
    draftWith(credentialedRtu("plant/#", { protocol: "modbus_tcp", ingestEnabled: false, credentialsSet: false })),
    ACTIVE_TYPES,
    EMPTY_TEMPLATE_CONTEXT,
  );
  const messages = result.errors.filter((error) => error.path === "rtus.0.config.topic").map((error) => error.message);
  assert(messages.length === 0, `a wildcard on a Modbus RTU is not an error, got ${JSON.stringify(messages)}`);
}
