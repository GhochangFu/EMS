import { draftRtuMqttTopic, metaTimezone, topicHolderMessage, unitOf } from "./onboarding-commit-values";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** F4.339 (plan R10): a valid string `meta.timezone` is the fallback; anything else is ignored. */
export function assertMetaTimezoneReadsOnlyAValidZone(): void {
  assert(metaTimezone({ timezone: "Asia/Kolkata" }) === "Asia/Kolkata", "a valid zone");
  assert(metaTimezone({ timezone: "Kolkata" }) === undefined, "an invalid name");
  assert(metaTimezone({ timezone: 5 }) === undefined, "a number");
  assert(metaTimezone({ timezone: `Asia/${"K".repeat(70)}` }) === undefined, "over the column width");
  assert(metaTimezone(undefined) === undefined && metaTimezone({}) === undefined, "absent");
}

/** F4.339 (ADR 0117 decision 11): the draft's declaration first, then the catalog; nothing → undefined. */
export function assertUnitOfPrefersTheDeclarationThenTheCatalog(): void {
  const catalog = new Map([
    ["treated_water_flow_klh", { unit: "KL/hr", domain: "water" }],
    ["no_unit", { unit: null, domain: "water" }],
  ]);
  assert(unitOf("treated_water_flow_klh", [], catalog) === "KL/hr", "the catalog's unit");
  assert(unitOf("new_key", [{ code: "new_key", name: "New", unit: "kWh" }], catalog) === "kWh", "a declared key's unit");
  assert(
    unitOf("treated_water_flow_klh", [{ code: "treated_water_flow_klh", name: "Flow", unit: "m3/h" }], catalog) === "m3/h",
    "the declaration wins over the catalog",
  );
  assert(unitOf("no_unit", undefined, catalog) === undefined && unitOf("absent", undefined, catalog) === undefined, "no unit anywhere");
}

/** F4.339 (plan R8): the topic the commit writes, and the sentence naming a same-organization holder. */
export function assertTheTopicRuleAndTheHolderSentence(): void {
  assert(draftRtuMqttTopic({ topic: "a/b", mqttTopic: "c/d" }) === "a/b", "topic wins");
  assert(draftRtuMqttTopic({ mqttTopic: "c/d" }) === "c/d", "the legacy key");
  assert(draftRtuMqttTopic({ topic: "" }) === null && draftRtuMqttTopic({}) === null, "empty → NULL");
  assert(
    topicHolderMessage("BCPL-LAL-02", "BCPL-LAL-01", true) ===
      "The MQTT topic of draft RTU BCPL-LAL-02 is already used by RTU BCPL-LAL-01 (active) in this organization. Choose a different topic, or clear that RTU's topic.",
    "the sentence (exact)",
  );
  assert(topicHolderMessage("A", "B", false).includes("RTU B (inactive)"), "an inactive holder says so");
}
