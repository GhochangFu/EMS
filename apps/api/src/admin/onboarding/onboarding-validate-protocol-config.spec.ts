import {
  MAX_RTU_TOPIC_CHARS,
  MQTT_PAYLOAD_FORMAT_UNKNOWN_MESSAGE,
  MQTT_REJECT_UNAUTHORIZED_DRAFT_MESSAGE,
  type OnboardingDraft,
} from "@bms/shared";

import { EMPTY_PLACEMENT } from "./onboarding-location-parent";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { MQTT_RTU_CODE_REQUIRED_MESSAGE, MQTT_RTU_HOST_REQUIRED_MESSAGE, OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F3.24a` (ADR 0093 decisions 5, 6) — `validate` parses each RTU's `config`
 * with its protocol's draft schema from the code catalog and reports paths
 * only. The hand-written, owner-ruled checks (F4.208, F4.215, F4.221, "topic
 * is required", "requires credentials") stay; a schema issue at a path one of
 * them already reported is dropped, so each path carries one sentence.
 *
 * Split from `onboarding-validate.service.spec.ts`, which is near AGENTS.md
 * §4.5's line ceiling.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type DraftRtu = NonNullable<OnboardingDraft["rtus"]>[number];

const LOCATION: NonNullable<OnboardingDraft["location"]> = {
  name: "Lotapata",
  slug: "lotapata",
  code: "LOTAPATA",
  type: "smoc_campus",
  latitude: 20.1,
  longitude: 85.1,
};

const ACTIVE_TYPES = ["smoc_campus"] as const;

const WILDCARD_MESSAGE = "MQTT topic must name one device; # and + are wildcards";

/**
 * An enabled, credentialed MQTT RTU; only `config` varies. F4.339 (ADR 0117
 * decision 10, ruling Q5): a broker host and an `rtuCode` are now required, so
 * the fixture carries both unless the case names `host` itself.
 */
function mqttRtu(config: Record<string, unknown>, overrides: Partial<DraftRtu> = {}): DraftRtu {
  return {
    code: "RTU-1",
    displayName: "RTU-1",
    protocol: "mqtt",
    ingestEnabled: true,
    credentialsSet: true,
    rtuCode: "RTU-1",
    config: "host" in config ? config : { host: "broker", ...config },
    ...overrides,
  };
}

function errorsOf(...rtus: DraftRtu[]): { path: string; message: string }[] {
  const draft: OnboardingDraft = { location: { ...LOCATION }, rtus };
  return new OnboardingValidateService().validate(draft, ACTIVE_TYPES, EMPTY_TEMPLATE_CONTEXT, EMPTY_PLACEMENT).errors;
}

function configErrors(errors: { path: string; message: string }[], index: number): { path: string; message: string }[] {
  return errors.filter((error) => error.path.startsWith(`rtus.${index}.config`));
}

/** V1 — a string port is reported at its path, and the message does not echo the value. */
export function assertAStringPortIsReportedAtItsPath(): void {
  const errors = errorsOf(mqttRtu({ host: "h", port: "8883", topic: "a/b" }));
  const port = errors.filter((error) => error.path === "rtus.0.config.port");
  assert(port.length === 1, `one error at rtus.0.config.port, got ${JSON.stringify(errors)}`);
  assert(!port[0].message.includes("8883"), `the port message does not echo the value, got ${port[0].message}`);
}

/** V1, the adjacent positive — a numeric port leaves no config error. */
export function assertANumericPortHasNoConfigError(): void {
  const errors = configErrors(errorsOf(mqttRtu({ host: "h", port: 8883, topic: "a/b" })), 0);
  assert(errors.length === 0, `no rtus.0.config.* error for a numeric port, got ${JSON.stringify(errors)}`);
}

/**
 * V2 — an absent port passes (the ingest host's env fallback supplies it).
 * F4.339 (ADR 0117 decision 10): an absent host no longer does — it is the one
 * fixed error at `config.host` (closes F4.327).
 */
export function assertAnAbsentHostAndPortStillPass(): void {
  const errors = errorsOf(mqttRtu({ host: undefined, topic: "a/b" })).filter(
    (error) => error.path === "rtus.0.config.host" || error.path === "rtus.0.config.port",
  );
  assert(
    JSON.stringify(errors) === JSON.stringify([{ path: "rtus.0.config.host", message: MQTT_RTU_HOST_REQUIRED_MESSAGE }]),
    `the host error alone, no port error, got ${JSON.stringify(errors)}`,
  );
}

/** F4.339 (plan R9): a stored stray key is an error at its own path with the hint; validate does not rewrite the draft. */
export function assertAStoredStrayKeyIsReportedAndKept(): void {
  const rtu = mqttRtu({ brokerHost: "h", topic: "a/b" });
  const draft: OnboardingDraft = { location: { ...LOCATION }, rtus: [rtu] };
  const before = JSON.stringify(draft);
  const errors = new OnboardingValidateService().validate(draft, ACTIVE_TYPES, EMPTY_TEMPLATE_CONTEXT, EMPTY_PLACEMENT).errors;
  const stray = errors.filter((error) => error.path === "rtus.0.config.brokerHost");
  assert(stray.length === 1 && stray[0]!.message === "use host for the broker host", `the hint at its path, got ${JSON.stringify(errors)}`);
  assert(JSON.stringify(draft) === before, "validate does not rewrite the draft");
}

/** F4.339 (ruling Q5): an ingest-enabled MQTT RTU with no rtuCode is an error at `rtus.0.rtuCode`. */
export function assertIngestOnWithoutAnRtuCodeIsAnError(): void {
  const errors = errorsOf(mqttRtu({ topic: "a/b" }, { rtuCode: undefined }));
  assert(
    errors.some((error) => error.path === "rtus.0.rtuCode" && error.message === MQTT_RTU_CODE_REQUIRED_MESSAGE),
    `the rtuCode error, got ${JSON.stringify(errors)}`,
  );
  const off = errorsOf(mqttRtu({ topic: "a/b" }, { rtuCode: undefined, ingestEnabled: false, credentialsSet: false }));
  assert(!off.some((error) => error.path === "rtus.0.rtuCode"), "ingest off needs no rtuCode");
}

/** V3 — a nested device wildcard is reported once, with the F4.221 sentence. */
export function assertANestedDeviceWildcardIsReportedOnce(): void {
  const errors = errorsOf(mqttRtu({ topic: "a/b", device: { topic: "a/#" } })).filter(
    (error) => error.path === "rtus.0.config.device.topic",
  );
  assert(errors.length === 1, `exactly one error at rtus.0.config.device.topic, got ${JSON.stringify(errors)}`);
  assert(errors[0].message === WILDCARD_MESSAGE, `the F4.221 sentence, got ${errors[0].message}`);
}

/** V4 — a head-topic wildcard is reported once, with the F4.215 sentence. */
export function assertAHeadTopicWildcardIsReportedOnce(): void {
  const errors = errorsOf(mqttRtu({ topic: "a/#" })).filter((error) => error.path === "rtus.0.config.topic");
  assert(errors.length === 1, `exactly one error at rtus.0.config.topic, got ${JSON.stringify(errors)}`);
  assert(errors[0].message === WILDCARD_MESSAGE, `the F4.215 sentence, got ${errors[0].message}`);
}

/**
 * V4b (F3.24a review L1) — a wildcard in the `mqttTopic` fallback is one fault and
 * gives one row: the F4.215 sentence at `config.topic`, where `rtuTopic` reads it,
 * and no schema row at `config.mqttTopic`.
 */
export function assertAFallbackTopicWildcardIsReportedOnce(): void {
  const rows = configErrors(errorsOf(mqttRtu({ mqttTopic: "a/#" })), 0);
  assert(rows.length === 1, `exactly one config error, got ${JSON.stringify(rows)}`);
  assert(rows[0].path === "rtus.0.config.topic", `the row is at rtus.0.config.topic, got ${rows[0].path}`);
  assert(rows[0].message === WILDCARD_MESSAGE, `the F4.215 sentence, got ${rows[0].message}`);
}

/** V4c — with `topic` set, `rtuTopic` does not read `mqttTopic`, so a wildcard there keeps its schema row. */
export function assertAShadowedFallbackWildcardKeepsItsSchemaRow(): void {
  const rows = configErrors(errorsOf(mqttRtu({ topic: "a/b", mqttTopic: "a/#" })), 0);
  assert(rows.length === 1, `exactly one config error, got ${JSON.stringify(rows)}`);
  assert(rows[0].path === "rtus.0.config.mqttTopic", `the row is at rtus.0.config.mqttTopic, got ${rows[0].path}`);
}

/** V5 — a draft that sets `rejectUnauthorized` is refused (plan Q1): ingest would skip the RTU. */
export function assertRejectUnauthorizedIsRefused(): void {
  const errors = errorsOf(mqttRtu({ topic: "a/b", rejectUnauthorized: false })).filter(
    (error) => error.path === "rtus.0.config.rejectUnauthorized",
  );
  assert(errors.length === 1, `one error at rtus.0.config.rejectUnauthorized, got ${JSON.stringify(errors)}`);
  assert(
    errors[0].message === MQTT_REJECT_UNAUTHORIZED_DRAFT_MESSAGE,
    `the fixed refusal message, got ${errors[0].message}`,
  );
}

/** V6 — a protocol with no adapter accepts any config (decision 6). */
export function assertAModbusRtuAcceptsAnyConfig(): void {
  const errors = configErrors(
    errorsOf(
      mqttRtu(
        { port: "not a number", anything: { deep: true } },
        { protocol: "modbus_tcp", ingestEnabled: false, credentialsSet: false },
      ),
    ),
    0,
  );
  assert(errors.length === 0, `no rtus.0.config.* error for modbus_tcp, got ${JSON.stringify(errors)}`);
}

/** V6 — a simulator RTU with an empty config has no config error. */
export function assertASimulatorRtuAcceptsAnEmptyConfig(): void {
  const errors = configErrors(
    errorsOf(mqttRtu({}, { protocol: "simulator", ingestEnabled: false, credentialsSet: false })),
    0,
  );
  assert(errors.length === 0, `no rtus.0.config.* error for simulator, got ${JSON.stringify(errors)}`);
}

/** V7 — the F4.208 over-long topic row still appears. */
export function assertTheOverLongTopicRowStays(): void {
  const errors = errorsOf(mqttRtu({ topic: "t".repeat(MAX_RTU_TOPIC_CHARS + 1) }));
  const expected = `MQTT topic is longer than ${MAX_RTU_TOPIC_CHARS} characters`;
  assert(
    errors.some((error) => error.path === "rtus.0.config.topic" && error.message === expected),
    `the F4.208 row at rtus.0.config.topic, got ${JSON.stringify(errors)}`,
  );
}

/** V7 — the "MQTT topic is required" row still appears. */
export function assertTheTopicRequiredRowStays(): void {
  const errors = errorsOf(mqttRtu({ topic: "" }));
  assert(
    errors.some((error) => error.path === "rtus.0.config.topic" && error.message === "MQTT topic is required"),
    `the topic-required row at rtus.0.config.topic, got ${JSON.stringify(errors)}`,
  );
}

/** V7 — the "MQTT ingest requires credentials" row still appears. */
export function assertTheCredentialsRequiredRowStays(): void {
  const errors = errorsOf(mqttRtu({ topic: "a/b" }, { credentialsSet: false }));
  assert(
    errors.some(
      (error) => error.path === "rtus.0.credentialsSet" && error.message === "MQTT ingest requires credentials",
    ),
    `the credentials row at rtus.0.credentialsSet, got ${JSON.stringify(errors)}`,
  );
}

const REQUIRED_MESSAGE = "MQTT topic is required";

function requiredRows(config: Record<string, unknown>): { path: string; message: string }[] {
  return errorsOf(mqttRtu(config)).filter(
    (error) => error.path === "rtus.0.config.topic" && error.message === REQUIRED_MESSAGE,
  );
}

/** R1a (F4.234) — an empty `topic` beside a legacy `mqttTopic` is an empty topic: the required row appears. */
export function assertAnEmptyTopicBesideALegacyKeyIsRequired(): void {
  const rows = requiredRows({ topic: "", mqttTopic: "a/b" });
  assert(rows.length >= 1, `the required row at rtus.0.config.topic, got ${JSON.stringify(rows)}`);
}

/** R1b (F4.234) — that fault gives exactly one config row, so a second row at the path cannot hide. */
export function assertAnEmptyTopicBesideALegacyKeyGivesOneConfigRow(): void {
  const rows = configErrors(errorsOf(mqttRtu({ topic: "", mqttTopic: "a/b" })), 0);
  assert(rows.length === 1, `exactly one config error, got ${JSON.stringify(rows)}`);
}

/** R2 (F4.234), the adjacent positive — a legacy `mqttTopic` alone leaves no config error. */
export function assertALegacyTopicAloneHasNoConfigError(): void {
  const rows = configErrors(errorsOf(mqttRtu({ mqttTopic: "a/b" })), 0);
  assert(rows.length === 0, `no config error, got ${JSON.stringify(rows)}`);
}

/** R3a (F4.234) — an MQTT RTU with no topic key at all gets the required row. */
export function assertAnAbsentTopicIsRequired(): void {
  const rows = requiredRows({});
  assert(rows.length >= 1, `the required row at rtus.0.config.topic, got ${JSON.stringify(rows)}`);
}

/** R3b (F4.234) — and exactly one config row. */
export function assertAnAbsentTopicGivesOneConfigRow(): void {
  const rows = configErrors(errorsOf(mqttRtu({})), 0);
  assert(rows.length === 1, `exactly one config error, got ${JSON.stringify(rows)}`);
}

/** R4 (F4.234), the adjacent positive — a plain `topic` leaves no config error. */
export function assertAPlainTopicHasNoConfigError(): void {
  const rows = configErrors(errorsOf(mqttRtu({ topic: "a/b" })), 0);
  assert(rows.length === 0, `no config error, got ${JSON.stringify(rows)}`);
}

/**
 * R5 (F4.234, owner ruling OQ1) — a whitespace-only topic is kept as sent, so the
 * required check does not fire (R5a); `needsMqttSetup` holds the draft at the
 * `rtu` phase (R5b). One claim per cell, so a trim in either place reddens its own.
 */
function validateAWhitespaceTopic() {
  const draft: OnboardingDraft = { location: { ...LOCATION }, rtus: [mqttRtu({ topic: "  " })] };
  return new OnboardingValidateService().validate(draft, ACTIVE_TYPES, EMPTY_TEMPLATE_CONTEXT, EMPTY_PLACEMENT);
}

export function assertAWhitespaceTopicPassesTheRequiredCheck(): void {
  const result = validateAWhitespaceTopic();
  assert(
    !result.errors.some((error) => error.message === REQUIRED_MESSAGE),
    `no required row for a whitespace topic, got ${JSON.stringify(result.errors)}`,
  );
}

export function assertAWhitespaceTopicHoldsTheDraftAtTheRtuPhase(): void {
  const result = validateAWhitespaceTopic();
  assert(result.suggestedPhase === "rtu", `the draft stays at phase rtu, got ${String(result.suggestedPhase)}`);
}

/**
 * P1–P5 (`F4.334`, ADR 0116 decision 4, plan R10) — `config.payloadFormat` must
 * name a catalog row; with no catalog set the check fails closed.
 */
const FORMAT_PATH = "rtus.0.config.payloadFormat";

function formatErrors(config: Record<string, unknown>, known?: ReadonlySet<string>) {
  const draft: OnboardingDraft = { location: { ...LOCATION }, rtus: [mqttRtu({ topic: "a/b", ...config })] };
  const templates = known === undefined ? EMPTY_TEMPLATE_CONTEXT : { ...EMPTY_TEMPLATE_CONTEXT, payloadFormats: known };
  return new OnboardingValidateService()
    .validate(draft, ACTIVE_TYPES, templates, EMPTY_PLACEMENT)
    .errors.filter((error) => error.path === FORMAT_PATH);
}

export function assertAKnownPayloadFormatPasses(): void {
  const rows = formatErrors({ payloadFormat: "thinkiot-register-array" }, new Set(["thinkiot-register-array"]));
  assert(rows.length === 0, `a known code passes, got ${JSON.stringify(rows)}`);
}

export function assertAnUnknownPayloadFormatIsReported(): void {
  const rows = formatErrors({ payloadFormat: "thinkiot-register-array" }, new Set(["thinkiot-envelope"]));
  assert(
    JSON.stringify(rows) === JSON.stringify([{ path: FORMAT_PATH, message: MQTT_PAYLOAD_FORMAT_UNKNOWN_MESSAGE }]),
    `an unknown code is one fixed row, got ${JSON.stringify(rows)}`,
  );
  assert(!rows[0]?.message.includes("thinkiot"), "the message names no code");
}

export function assertNoCatalogSetFailsClosed(): void {
  const rows = formatErrors({ payloadFormat: "thinkiot-register-array" });
  assert(
    rows.length === 1 && rows[0]?.message === MQTT_PAYLOAD_FORMAT_UNKNOWN_MESSAGE,
    `no set fails closed, got ${JSON.stringify(rows)}`,
  );
}

export function assertNoPayloadFormatNeedsNoSet(): void {
  const rows = formatErrors({});
  assert(rows.length === 0, `a draft naming no format is unaffected, got ${JSON.stringify(rows)}`);
}

export function assertAMalformedCodeCarriesTheSchemaIssueOnly(): void {
  const rows = formatErrors({ payloadFormat: "Bad Code" }, new Set(["thinkiot-register-array"]));
  assert(
    rows.length === 1 && rows[0]?.message !== MQTT_PAYLOAD_FORMAT_UNKNOWN_MESSAGE,
    `a malformed code has the schema issue alone, got ${JSON.stringify(rows)}`,
  );
  assert(!rows[0]?.message.includes("Bad Code"), "the schema issue echoes no value");
}
