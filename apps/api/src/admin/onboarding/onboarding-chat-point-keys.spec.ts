import type { OnboardingDraft } from "@bms/shared";

import { OnboardingChatService } from "./onboarding-chat.service";
import type { ChatTurnResult } from "./onboarding-chat.service";
import { chatService, ruleBasedTurn } from "./onboarding-chat.service.spec";
import { mergeDraftPatch } from "./onboarding-draft-merge";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F4.195` — the guided chat and `excelImportFollowUp` ask `draftNeedsPointKeys`,
 * the question `inferPhase` asks, so neither adds or asks for a point key that
 * the phase skipped. Kept out of `onboarding-chat.service.spec.ts`, which is at
 * AGENTS.md §4.5's line ceiling.
 *
 * The draft is at review in every branch above the point-key one: an active
 * location type, one RTU with ingest off, and two templated assets. No
 * template context is needed, because the branch reads only the assets'
 * `template` field.
 */
function allTemplatedDraft(): OnboardingDraft {
  return {
    location: { name: "Lotapata", slug: "lotapata", code: "LOTAPATA", type: "smoc_campus", latitude: 20.1, longitude: 85.1 },
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU 1",
        protocol: "mqtt",
        config: { host: "broker", port: 8883, tls: true, topic: "plant/rtu-1" },
        credentialsSet: false,
        ingestEnabled: false,
      },
    ],
    assets: [
      { rtuIndex: 0, code: "SOFT-1", name: "Softener 1", siteName: "Lotapata", domain: "water", template: { code: "water-softener", version: 1 } },
      { rtuIndex: 0, code: "SOFT-2", name: "Softener 2", siteName: "Lotapata", domain: "water", template: { code: "water-softener", version: 1 } },
    ],
    pointKeys: [],
  };
}

const IN_REVIEW = "We're in review. Say **create it** to commit, or tell me what to change.";

/** F4.195 — a turn on an all-templated review draft with no point key adds no `kw` and answers from review. */
export async function assertAnAllTemplatedReviewDraftIsNotGivenAPointKey(): Promise<void> {
  const result = await ruleBasedTurn("hello", allTemplatedDraft(), "review");
  assert(result.assistantMessage === IN_REVIEW, `the review branch answers, got ${result.assistantMessage}`);
  assert(result.draftPatch.pointKeys === undefined, `no point key is added, got ${JSON.stringify(result.draftPatch.pointKeys)}`);
}

/** F4.195 — a draft that uses the existing catalog is not given `kw` either; it goes on to its first asset. */
export async function assertADraftThatUsesTheExistingCatalogIsNotGivenAPointKey(): Promise<void> {
  const draft: OnboardingDraft = { ...allTemplatedDraft(), assets: [], onboardingMeta: { useExistingPointKeys: true } };
  const result = await ruleBasedTurn("hello", draft, "assets");
  assert(result.draftPatch.assets?.length === 1, `the assets branch answers, got ${result.assistantMessage}`);
  assert(result.draftPatch.pointKeys === undefined, `no point key is added, got ${JSON.stringify(result.draftPatch.pointKeys)}`);
}

/** F4.195, the positive control — a draft with a plain asset and no point key is still given `kw`. */
export async function assertADraftWithAPlainAssetIsStillGivenAPointKey(): Promise<void> {
  const draft = allTemplatedDraft();
  draft.assets!.push({ rtuIndex: 0, code: "PLAIN-1", name: "Plain 1", siteName: "Lotapata", domain: "electrical" });
  const result = await ruleBasedTurn("hello", draft, "review");
  assert(result.draftPatch.pointKeys?.[0]?.code === "kw", `kw is added, got ${JSON.stringify(result.draftPatch.pointKeys)}`);
}

/**
 * `F4.199` — the guided mode's reply lists. The client sends a button's text
 * as a chat turn, and "Validate" and "Add point key kw" are not turns the
 * guided mode answers as buttons, so they are no longer offered.
 */
function repliesOf(result: { suggestedReplies?: readonly string[] }): string {
  return JSON.stringify(result.suggestedReplies);
}

export async function assertTheYesAnswerOffersOnlyViewDraft(): Promise<void> {
  const result = await ruleBasedTurn("yes", {}, "location");
  assert(
    result.assistantMessage.startsWith("I'll prepare the commit"),
    `this case must reach the yes branch, got ${result.assistantMessage}`,
  );
  assert(repliesOf(result) === JSON.stringify(["View draft"]), `got ${repliesOf(result)}`);
}

export async function assertTheMappingAddedAnswerOffersCreateItAndViewDraft(): Promise<void> {
  const draft = allTemplatedDraft();
  draft.assets!.push({ rtuIndex: 0, code: "PLAIN-1", name: "Plain 1", siteName: "Lotapata", domain: "electrical" });
  draft.pointKeys = [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }];
  const result = await ruleBasedTurn("hello", draft, "mappings");
  assert(result.assistantMessage.startsWith("Mapping added."), `this case must reach the mapping branch, got ${result.assistantMessage}`);
  assert(repliesOf(result) === JSON.stringify(["create it", "View draft"]), `got ${repliesOf(result)}`);
}

const IMPORTED = { locationName: "Lotapata", rtuCount: 1, assetCount: 2 };

/**
 * F4.195 — after an import, an all-templated draft with no point key and no
 * mapping is asked for neither; the follow-up goes on to commit.
 */
export function assertTheImportFollowUpSendsAnAllTemplatedDraftToCommit(): void {
  const result = chatService().excelImportFollowUp(allTemplatedDraft(), IMPORTED, ["kw"]);
  assert(
    JSON.stringify(result.suggestedReplies) === JSON.stringify(["View draft", "Commit"]),
    `the commit step answers, got ${JSON.stringify(result.suggestedReplies)}`,
  );
}

/** F4.195, the positive control — a plain asset with no mapping is still asked to map. */
export function assertTheImportFollowUpStillAsksAPlainAssetToMap(): void {
  const draft: OnboardingDraft = { ...allTemplatedDraft(), pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }] };
  draft.assets!.push({ rtuIndex: 0, code: "PLAIN-1", name: "Plain 1", siteName: "Lotapata", domain: "electrical" });
  const result = chatService().excelImportFollowUp(draft, IMPORTED, ["kw"]);
  assert(result.suggestedReplies[0] === "auto map", `the mapping step answers, got ${JSON.stringify(result.suggestedReplies)}`);
}

// ---------------------------------------------------------------------------
// F4.199 (review finding 1) — every reply button reaches the branch its label
// names. The commit answer takes the whole message only, so "confirm <step>"
// reaches its step, and the step answers from `inferPhase`: it goes on when the
// draft has met the step, and says what is missing when it has not.
// ---------------------------------------------------------------------------

const PLACE: NonNullable<OnboardingDraft["location"]> = {
  name: "Berhampur",
  slug: "berhampur",
  code: "BERHAMPUR",
  type: "smoc_campus",
  latitude: 19.3,
  longitude: 84.8,
};

const KW = { code: "kw", name: "Active Power", domain: "electrical", unit: "kW" } as const;

function mqttRtu(ready: boolean): NonNullable<OnboardingDraft["rtus"]>[number] {
  return {
    code: "RTU-1",
    displayName: "RTU-1",
    protocol: "mqtt",
    config: { host: "broker", port: 8883, tls: true, topic: ready ? "plant/rtu-1" : "" },
    credentialsSet: ready,
    ingestEnabled: true,
  };
}

const MODBUS_RTU: NonNullable<OnboardingDraft["rtus"]>[number] = {
  code: "RTU-1",
  displayName: "RTU-1",
  protocol: "modbus_tcp",
  config: { host: "10.0.0.5", port: 502 },
  credentialsSet: false,
  ingestEnabled: false,
};

const PLAIN_ASSET = { rtuIndex: 0, code: "PLAIN-1", name: "Plain 1", siteName: "Berhampur", domain: "electrical" } as const;

function turnSummary(result: ChatTurnResult): string {
  return `phase ${result.currentPhase}, replies ${repliesOf(result)}, message ${result.assistantMessage}`;
}

/** "confirm rtu" while the MQTT RTU has no credentials: the RTU step says so and adds no RTU. */
export async function assertConfirmRtuSaysTheCredentialsAreMissing(): Promise<void> {
  const result = await ruleBasedTurn("confirm rtu", { location: PLACE, rtus: [mqttRtu(false)] }, "rtu");
  assert(result.assistantMessage.startsWith("The RTU step is not complete yet."), turnSummary(result));
  assert(result.assistantMessage.includes("**Credentials** field"), turnSummary(result));
  assert(result.currentPhase === "rtu", turnSummary(result));
  assert(result.draftPatch.rtus === undefined, `no RTU is added, got ${JSON.stringify(result.draftPatch.rtus)}`);
  assert(repliesOf(result) === JSON.stringify(["confirm rtu", "View draft"]), turnSummary(result));
}

/** "confirm rtu" once the MQTT RTU is set up: the turn goes on to the point keys and adds no RTU. */
export async function assertConfirmRtuGoesOnWhenTheRtuIsSetUp(): Promise<void> {
  const result = await ruleBasedTurn("confirm rtu", { location: PLACE, rtus: [mqttRtu(true)] }, "rtu");
  assert(result.assistantMessage.startsWith("The RTU step is complete."), turnSummary(result));
  assert(result.currentPhase === "point_keys", turnSummary(result));
  assert(result.draftPatch.rtus === undefined, `no RTU is added, got ${JSON.stringify(result.draftPatch.rtus)}`);
  assert(repliesOf(result) === JSON.stringify(["kw", "View draft"]), turnSummary(result));
}

/** "confirm point keys" with no key and no existing catalog: the step says so and adds no key. */
export async function assertConfirmPointKeysSaysAKeyIsMissing(): Promise<void> {
  const result = await ruleBasedTurn("confirm point keys", { location: PLACE, rtus: [MODBUS_RTU] }, "point_keys");
  assert(result.assistantMessage.startsWith("The point keys step is not complete yet."), turnSummary(result));
  assert(result.currentPhase === "point_keys", turnSummary(result));
  assert(result.draftPatch.pointKeys === undefined, `no point key is added, got ${JSON.stringify(result.draftPatch.pointKeys)}`);
  assert(repliesOf(result) === JSON.stringify(["kw", "View draft"]), turnSummary(result));
}

/** "confirm assets" with no asset: the step says so and adds no asset. */
export async function assertConfirmAssetsSaysAnAssetIsMissing(): Promise<void> {
  const result = await ruleBasedTurn("confirm assets", { location: PLACE, rtus: [MODBUS_RTU], pointKeys: [KW] }, "assets");
  assert(result.assistantMessage.startsWith("The assets step is not complete yet."), turnSummary(result));
  assert(result.currentPhase === "assets", turnSummary(result));
  assert(result.draftPatch.assets === undefined, `no asset is added, got ${JSON.stringify(result.draftPatch.assets)}`);
  assert(repliesOf(result) === JSON.stringify(["One asset", "View draft"]), turnSummary(result));
}

/** "confirm mappings" with a plain asset and no mapping: the step says so and adds no mapping. */
export async function assertConfirmMappingsSaysAMappingIsMissing(): Promise<void> {
  const draft: OnboardingDraft = { location: PLACE, rtus: [MODBUS_RTU], pointKeys: [KW], assets: [PLAIN_ASSET] };
  const result = await ruleBasedTurn("confirm mappings", draft, "mappings");
  assert(result.assistantMessage.startsWith("The mappings step is not complete yet."), turnSummary(result));
  assert(result.currentPhase === "mappings", turnSummary(result));
  assert(result.draftPatch.assetPoints === undefined, `no mapping is added, got ${JSON.stringify(result.draftPatch.assetPoints)}`);
  assert(repliesOf(result) === JSON.stringify(["auto map", "View draft"]), turnSummary(result));
}

/** "confirm assets" while the RTU step is open: the answer names the earlier step and changes nothing. */
export async function assertConfirmingALaterStepNamesTheEarlierOne(): Promise<void> {
  const result = await ruleBasedTurn("confirm assets", { location: PLACE, rtus: [mqttRtu(false)] }, "rtu");
  assert(result.assistantMessage.startsWith("The assets step comes later."), turnSummary(result));
  assert(result.assistantMessage.includes("**Credentials** field"), turnSummary(result));
  assert(result.currentPhase === "rtu", turnSummary(result));
  assert(
    result.draftPatch.rtus === undefined && result.draftPatch.assets === undefined,
    `nothing is added, got ${JSON.stringify(result.draftPatch)}`,
  );
}

/** ADR 0090 decision 5 is untouched: "confirm" alone is still the commit answer, which commits nothing. */
export async function assertConfirmAloneStillGivesTheCommitAnswer(): Promise<void> {
  const result = await ruleBasedTurn("confirm", { location: PLACE, rtus: [mqttRtu(false)] }, "rtu");
  assert(result.assistantMessage.startsWith("I'll prepare the commit"), turnSummary(result));
  assert(result.draftPatch.rtus === undefined, `no RTU is added, got ${JSON.stringify(result.draftPatch.rtus)}`);
}

/** The import follow-up's "Commit" reply goes as text and still gets the commit answer. */
export async function assertCommitStillGivesTheCommitAnswer(): Promise<void> {
  const result = await ruleBasedTurn("Commit", { location: PLACE, rtus: [mqttRtu(false)] }, "rtu");
  assert(result.assistantMessage.startsWith("I'll prepare the commit"), turnSummary(result));
  assert(result.draftPatch.rtus === undefined, `no RTU is added, got ${JSON.stringify(result.draftPatch.rtus)}`);
}

/** An added MQTT RTU waits for its credentials, so its list offers "confirm rtu", not "Add point key kw". */
export async function assertAnAddedMqttRtuOffersConfirmRtu(): Promise<void> {
  const result = await ruleBasedTurn("MQTT", { location: PLACE }, "rtu");
  assert(result.draftPatch.rtus?.[0]?.protocol === "mqtt", `an MQTT RTU is added, got ${JSON.stringify(result.draftPatch.rtus)}`);
  assert(repliesOf(result) === JSON.stringify(["confirm rtu", "View draft", "Add another RTU"]), turnSummary(result));
}

/** On the MQTT path, "Add another RTU" adds a second RTU. */
export async function assertAddAnotherRtuAddsAnRtuOnTheMqttPath(): Promise<void> {
  const first = await ruleBasedTurn("MQTT", { location: PLACE }, "rtu");
  const draft = mergeDraftPatch({ location: PLACE }, first.draftPatch);
  const result = await ruleBasedTurn("Add another RTU", draft, first.currentPhase);
  assert(result.draftPatch.rtus?.length === 2, `a second RTU is added, got ${turnSummary(result)}`);
}

/** An added Modbus RTU needs a point key next, so its list offers "Add point key kw". */
export async function assertAnAddedModbusRtuOffersAddPointKey(): Promise<void> {
  const result = await ruleBasedTurn("Modbus", { location: PLACE }, "rtu");
  assert(result.draftPatch.rtus?.[0]?.protocol === "modbus_tcp", `a Modbus RTU is added, got ${JSON.stringify(result.draftPatch.rtus)}`);
  assert(repliesOf(result) === JSON.stringify(["Add point key kw", "View draft", "Add another RTU"]), turnSummary(result));
}

/** On the Modbus path, "Add point key kw" adds kw and no RTU. */
export async function assertAddPointKeyAddsKwOnTheModbusPath(): Promise<void> {
  const first = await ruleBasedTurn("Modbus", { location: PLACE }, "rtu");
  const draft = mergeDraftPatch({ location: PLACE }, first.draftPatch);
  const result = await ruleBasedTurn("Add point key kw", draft, first.currentPhase);
  assert(result.draftPatch.pointKeys?.[0]?.code === "kw", `kw is added, got ${turnSummary(result)}`);
  assert(result.draftPatch.rtus === undefined, `no RTU is added, got ${JSON.stringify(result.draftPatch.rtus)}`);
}

/**
 * The protocol answer, which needs an organization. It returns before the
 * provider is resolved, so the resolver, crypto and catalog are never read.
 */
async function protocolTurn(draft: OnboardingDraft): Promise<ChatTurnResult> {
  const service = new OnboardingChatService(
    new OnboardingValidateService(),
    {} as never,
    { getContextForOrganization: async () => ({}), formatForAssistant: () => "MQTT, Modbus TCP" } as never,
    {} as never,
    { listLocationTypes: async () => [{ code: "smoc_campus", label: "SMOC campus" }] } as never,
    {} as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
  );
  return service.handleTurn("which protocols are available?", draft, "rtu", "Ion Exchange", "org-1", { sessionId: "s-1", history: [] });
}

/** At the RTU step the protocol answer offers protocol replies, which add an RTU there. */
export async function assertTheProtocolAnswerOffersProtocolsAtTheRtuStep(): Promise<void> {
  const result = await protocolTurn({ location: PLACE });
  assert(result.assistantMessage.startsWith("Here are the protocols"), turnSummary(result));
  assert(repliesOf(result) === JSON.stringify(["MQTT", "Modbus TCP", "View draft"]), turnSummary(result));
}

/** Past the RTU step a protocol reply would add `kw` or an asset, so only "View draft" is offered. */
export async function assertTheProtocolAnswerOffersNoProtocolPastTheRtuStep(): Promise<void> {
  const result = await protocolTurn({ location: PLACE, rtus: [MODBUS_RTU] });
  assert(result.assistantMessage.startsWith("Here are the protocols"), turnSummary(result));
  assert(repliesOf(result) === JSON.stringify(["View draft"]), turnSummary(result));
}

/** On the Modbus path, "Add another RTU" adds a second RTU and no point key. */
export async function assertAddAnotherRtuAddsAnRtuOnTheModbusPath(): Promise<void> {
  const first = await ruleBasedTurn("Modbus", { location: PLACE }, "rtu");
  const draft = mergeDraftPatch({ location: PLACE }, first.draftPatch);
  const result = await ruleBasedTurn("Add another RTU", draft, first.currentPhase);
  assert(result.draftPatch.rtus?.length === 2, `a second RTU is added, got ${turnSummary(result)}`);
  assert(result.draftPatch.pointKeys === undefined, `no point key is added, got ${JSON.stringify(result.draftPatch.pointKeys)}`);
}

/** The second RTU repeats the Modbus protocol, so it does not wait for MQTT credentials. */
export async function assertAnotherRtuOnTheModbusPathIsModbus(): Promise<void> {
  const first = await ruleBasedTurn("Modbus", { location: PLACE }, "rtu");
  const draft = mergeDraftPatch({ location: PLACE }, first.draftPatch);
  const result = await ruleBasedTurn("Add another RTU", draft, first.currentPhase);
  assert(result.draftPatch.rtus?.[1]?.protocol === "modbus_tcp", `the second RTU is Modbus, got ${JSON.stringify(result.draftPatch.rtus)}`);
  assert(repliesOf(result) === JSON.stringify(["Add point key kw", "View draft", "Add another RTU"]), turnSummary(result));
}

/** A Modbus RTU added once a key exists goes past the point keys, so "Add point key kw" is not offered. */
export async function assertAnRtuAddedPastThePointKeysOffersNoPointKey(): Promise<void> {
  const draft: OnboardingDraft = { location: PLACE, rtus: [MODBUS_RTU], pointKeys: [KW] };
  const result = await ruleBasedTurn("Add another RTU", draft, "assets");
  assert(result.draftPatch.rtus?.length === 2, `a second RTU is added, got ${turnSummary(result)}`);
  assert(repliesOf(result) === JSON.stringify(["View draft", "Add another RTU"]), turnSummary(result));
}

/** "confirm rtu" with no RTU asks for a protocol and offers the protocol replies. */
export async function assertConfirmRtuWithNoRtuAsksForAProtocol(): Promise<void> {
  const result = await ruleBasedTurn("confirm rtu", { location: PLACE }, "rtu");
  assert(result.assistantMessage.startsWith("The RTU step is not complete yet. Add an RTU first."), turnSummary(result));
  assert(result.draftPatch.rtus === undefined, `no RTU is added, got ${JSON.stringify(result.draftPatch.rtus)}`);
  assert(
    repliesOf(result) === JSON.stringify(["MQTT", "Modbus", "BACnet", "OPC-UA", "SNMP", "REST", "Simulator"]),
    turnSummary(result),
  );
}

/** "confirm mappings" on a ready draft says the step is complete and offers the review replies. */
export async function assertConfirmMappingsOnAReadyDraftGoesOnToReview(): Promise<void> {
  const draft: OnboardingDraft = {
    location: PLACE,
    rtus: [MODBUS_RTU],
    pointKeys: [KW],
    assets: [PLAIN_ASSET],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s09_r01", unit: "kW" }],
  };
  const result = await ruleBasedTurn("confirm mappings", draft, "mappings");
  assert(result.assistantMessage.startsWith("The mappings step is complete."), turnSummary(result));
  assert(result.currentPhase === "review", turnSummary(result));
  assert(repliesOf(result) === JSON.stringify(["create it", "View draft"]), turnSummary(result));
}

/** "confirm rtu" before the location has a type names the location step. */
export async function assertConfirmRtuBeforeTheLocationNamesIt(): Promise<void> {
  const result = await ruleBasedTurn("confirm rtu", { location: { name: "Berhampur" } as OnboardingDraft["location"] }, "location");
  assert(result.assistantMessage.startsWith("The RTU step comes later. The location needs a name and a type"), turnSummary(result));
  assert(result.draftPatch.location === undefined, `the location is not changed, got ${JSON.stringify(result.draftPatch.location)}`);
  assert(repliesOf(result) === JSON.stringify(["View draft"]), turnSummary(result));
}
