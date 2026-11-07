import { MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE, parseMqttPlaintextHosts, type OnboardingDraft } from "@bms/shared";
import { expect } from "vitest";

import { EMPTY_PLACEMENT } from "./onboarding-location-parent";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.326` / ADR 0114 decision 5 and ruling 6 — the onboarding validator refuses
 * an MQTT RTU with `tls: false` whose host is absent or not on the API's
 * `MQTT_PLAINTEXT_HOSTS`, at `rtus.<i>.config.tls`, with the fixed message. The
 * commit runs `validate` first, so a refused draft commits nothing.
 *
 * The set is injected `@Optional()`: a bare `new OnboardingValidateService()`
 * (86 call sites) has the empty set and fails closed.
 */

type DraftRtu = NonNullable<OnboardingDraft["rtus"]>[number];

const LOCATION: NonNullable<OnboardingDraft["location"]> = {
  name: "Lalmati",
  slug: "lalmati",
  code: "LALMATI",
  type: "smoc_campus",
  latitude: 27.4,
  longitude: 94.9,
};

function rtu(config: Record<string, unknown>, protocol: DraftRtu["protocol"] = "mqtt"): DraftRtu {
  return { code: "LALRLY1", displayName: "LALRLY1", protocol, ingestEnabled: false, credentialsSet: true, config };
}

function tlsErrors(service: OnboardingValidateService, config: Record<string, unknown>, protocol?: DraftRtu["protocol"]) {
  const draft: OnboardingDraft = { location: { ...LOCATION }, rtus: [rtu(config, protocol)] };
  return service
    .validate(draft, ["smoc_campus"], EMPTY_TEMPLATE_CONTEXT, EMPTY_PLACEMENT)
    .errors.filter((e) => e.path === "rtus.0.config.tls");
}

const PLAIN = { host: "Broker.Example", port: 1883, tls: false, topic: "BCPL_LAL_RAILWAY_01_LALMATI" };
const LISTED = new OnboardingValidateService(parseMqttPlaintextHosts("broker.example"));

/** V1 — unlisted, or a bare instance: refused at `config.tls` with the fixed message. */
export function anUnlistedPlainRtuIsRefused(): void {
  for (const service of [new OnboardingValidateService(), new OnboardingValidateService(parseMqttPlaintextHosts("other.example"))]) {
    expect(tlsErrors(service, PLAIN)).toEqual([{ path: "rtus.0.config.tls", message: MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE }]);
  }
}

/** V2 — listed (case-insensitive): no `config.tls` error. */
export function aListedPlainRtuPasses(): void {
  expect(tlsErrors(LISTED, PLAIN)).toEqual([]);
}

/** V3 — a TLS twin (absent or `true`) on an unlisted host: no `config.tls` error. */
export function aTlsRtuIsUnaffected(): void {
  const bare = new OnboardingValidateService();
  expect(tlsErrors(bare, { ...PLAIN, tls: true })).toEqual([]);
  const { tls: _omitted, ...absent } = PLAIN;
  expect(tlsErrors(bare, absent)).toEqual([]);
}

/** V4 — the string `"false"` is the schema issue only, never the plaintext refusal. */
export function aStringFalseIsTheSchemaIssueOnly(): void {
  const errors = tlsErrors(new OnboardingValidateService(), { ...PLAIN, tls: "false" });
  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).not.toBe(MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE);
}

/** V5 — ruling 6: `tls: false` with no host is refused, even when the list is not empty. */
export function aPlainRtuWithNoHostIsRefused(): void {
  const { host: _omitted, ...noHost } = PLAIN;
  expect(tlsErrors(LISTED, noHost)).toEqual([{ path: "rtus.0.config.tls", message: MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE }]);
}

/** V6 — the rule is MQTT's: another protocol's `tls` key is not checked against the list. */
export function aNonMqttRtuIsNotChecked(): void {
  const errors = tlsErrors(new OnboardingValidateService(), { host: "10.0.0.5", port: 502, tls: false }, "modbus_tcp");
  expect(errors.map((e) => e.message)).not.toContain(MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE);
}
