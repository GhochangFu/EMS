import { MODBUS_DRAFT_PROFILE_NEEDS_UNIT_ID_MESSAGE, type OnboardingDraft } from "@bms/shared";

import { EMPTY_PLACEMENT } from "./onboarding-location-parent";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { ONBOARDING_PROFILE_MODBUS_ONLY_MESSAGE, OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F1.2` plan PR 11 (ADR 0141 Amendment 1 (f), decision 23) — the validator and a draft that names
 * a device profile. The Modbus draft schema's own issues reach the wizard at their paths with
 * their fixed text; a profile named on an RTU of another protocol is refused at
 * `config.profileId` (the commit binds a profile to a Modbus TCP RTU only, never to an MQTT one).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type DraftRtu = NonNullable<OnboardingDraft["rtus"]>[number];

const PROFILE_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

function modbusRtu(config: Record<string, unknown>, overrides: Partial<DraftRtu> = {}): DraftRtu {
  return { code: "RTU-1", displayName: "RTU-1", protocol: "modbus_tcp", config, ...overrides };
}

function errorsOf(rtu: DraftRtu): { path: string; message: string }[] {
  const draft: OnboardingDraft = {
    location: { name: "Lotapata", slug: "lotapata", code: "LOTAPATA", type: "smoc_campus", latitude: 1, longitude: 1 },
    rtus: [rtu],
  };
  return new OnboardingValidateService()
    .validate(draft, ["smoc_campus"], EMPTY_TEMPLATE_CONTEXT, EMPTY_PLACEMENT)
    .errors.filter((error) => error.path.startsWith("rtus.0"));
}

/** VP1 — a Modbus RTU naming a profile beside a unit id has no RTU error. */
export function assertAModbusProfileWithAUnitIdValidates(): void {
  const errors = errorsOf(modbusRtu({ host: "meter", profileId: PROFILE_ID, device: { unitId: 1 } }));
  assert(errors.length === 0, `no rtus.0 error, got ${JSON.stringify(errors)}`);
}

/** VP2 — the schema's unit-id issue reaches the wizard at its path, as fixed text. */
export function assertAProfileWithoutAUnitIdIsReportedAtTheUnitId(): void {
  const errors = errorsOf(modbusRtu({ host: "meter", profileId: PROFILE_ID }));
  assert(
    errors.some((e) => e.path === "rtus.0.config.device.unitId" && e.message === MODBUS_DRAFT_PROFILE_NEEDS_UNIT_ID_MESSAGE),
    `the unit-id issue at rtus.0.config.device.unitId, got ${JSON.stringify(errors)}`,
  );
}

/** VP3 — a profile on an MQTT RTU (or any non-Modbus one) is refused at config.profileId. */
export function assertAProfileOnAnotherProtocolIsRefused(): void {
  for (const protocol of ["mqtt", "snmp", "catalog"] as const) {
    const errors = errorsOf(
      modbusRtu(
        { host: "broker", topic: "a/b", profileId: PROFILE_ID },
        { protocol, credentialsSet: true, rtuCode: "RTU-1", ingestEnabled: protocol === "mqtt" },
      ),
    );
    assert(
      errors.some((e) => e.path === "rtus.0.config.profileId" && e.message === ONBOARDING_PROFILE_MODBUS_ONLY_MESSAGE),
      `${protocol}: the Modbus-only refusal at rtus.0.config.profileId, got ${JSON.stringify(errors)}`,
    );
  }
}

/** VP4 — §9.6: no forwarded message repeats a refused profile reference. */
export function assertNoProfileMessageEchoesTheValue(): void {
  const SENTINEL = "s3ntinel-profile-ref";
  for (const rtu of [
    modbusRtu({ host: "meter", profileId: SENTINEL, device: { unitId: 1 } }),
    modbusRtu({ host: "b", topic: "a/b", profileId: SENTINEL }, { protocol: "snmp" }),
  ]) {
    const errors = errorsOf(rtu);
    assert(errors.length > 0, `the reference is refused, got ${JSON.stringify(errors)}`);
    for (const error of errors) {
      assert(!error.message.includes(SENTINEL), `no echo of the value, got ${error.message}`);
    }
  }
}
