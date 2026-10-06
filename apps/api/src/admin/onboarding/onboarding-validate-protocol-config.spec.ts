import { MAX_RTU_TOPIC_CHARS, MQTT_REJECT_UNAUTHORIZED_DRAFT_MESSAGE, type OnboardingDraft } from "@bms/shared";

import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

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

/** An enabled, credentialed MQTT RTU; only `config` varies. */
function mqttRtu(config: Record<string, unknown>, overrides: Partial<DraftRtu> = {}): DraftRtu {
  return {
    code: "RTU-1",
    displayName: "RTU-1",
    protocol: "mqtt",
    ingestEnabled: true,
    credentialsSet: true,
    config,
    ...overrides,
  };
}

function errorsOf(...rtus: DraftRtu[]): { path: string; message: string }[] {
  const draft: OnboardingDraft = { location: { ...LOCATION }, rtus };
  return new OnboardingValidateService().validate(draft, ACTIVE_TYPES, EMPTY_TEMPLATE_CONTEXT).errors;
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

/** V2 — an absent host and port pass: the ingest host's env fallback supplies them. */
export function assertAnAbsentHostAndPortStillPass(): void {
  const errors = errorsOf(mqttRtu({ topic: "a/b" })).filter(
    (error) => error.path === "rtus.0.config.host" || error.path === "rtus.0.config.port",
  );
  assert(errors.length === 0, `no host or port error, got ${JSON.stringify(errors)}`);
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
