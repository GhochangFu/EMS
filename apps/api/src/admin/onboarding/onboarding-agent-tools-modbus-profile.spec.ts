import { MODBUS_DRAFT_PROFILE_NEEDS_UNIT_ID_MESSAGE, type OnboardingDraft } from "@bms/shared";

import { runTool, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import { EMPTY_PLACEMENT } from "./onboarding-location-parent";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F1.2` PR 11 review L3 / compliance S2 — the agent path and `profileId`. Decision 23 names the
 * guided chat and the workbook only; the catalog does not offer the field to the model. A
 * `profileId` the model writes anyway meets the protocol's draft schema through `update_rtu`:
 * refused on an MQTT RTU (the MQTT schema's fixed unknown-key sentence), and refused on a Modbus RTU
 * with no unit id (the schema's fixed sentence).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const PROFILE_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

function context(): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }],
    catalog: { listPointKeys: async () => [], listInUsePointKeys: async () => new Set<string>() },
    protocols: {
      getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }),
      formatForAssistant: () => "",
    },
    validator: new OnboardingValidateService(),
    templates: EMPTY_TEMPLATE_CONTEXT,
    pointKeyQuota: { createdByOrganization: 0 },
    inventory: { listExisting: async () => ({ rows: [], total: 0 }) },
    placement: EMPTY_PLACEMENT,
  } as unknown as ToolContext;
}

async function updateConfig(rtu: NonNullable<OnboardingDraft["rtus"]>[number], config: Record<string, unknown>) {
  const state: ToolState = { working: { rtus: [rtu] } as OnboardingDraft };
  const call = { id: "c1", name: "update_rtu", arguments: JSON.stringify({ index: 0, patch: { config } }) };
  const out = await runTool(call, state, context());
  return { out, error: String((JSON.parse(out.content) as { error?: unknown }).error ?? ""), state };
}

/** AP1 — the model's `profileId` on an MQTT RTU is refused with a fixed sentence and nothing is written. */
export async function assertAProfileIdOnAnMqttRtuIsRefused(): Promise<void> {
  const mqtt = { code: "RTU-1", displayName: "RTU-1", protocol: "mqtt" as const, config: { host: "broker", topic: "a/b" } };
  const { out, error, state } = await updateConfig(mqtt, { profileId: PROFILE_ID });
  assert(!out.ok, "refused");
  // The MQTT draft schema names each unknown key at its own path with a fixed sentence (F4.339);
  // the value never appears.
  assert(error.includes("unknown MQTT config key"), `the MQTT schema's fixed sentence, got ${error}`);
  assert(!error.includes(PROFILE_ID), `no value, got ${error}`);
  assert(!("profileId" in (state.working.rtus?.[0]?.config ?? {})), "nothing written");
}

/** AP2 — the model's `profileId` on a Modbus RTU with no unit id is the schema's fixed sentence. */
export async function assertAProfileIdWithoutAUnitIdIsRefused(): Promise<void> {
  const modbus = { code: "RTU-1", displayName: "RTU-1", protocol: "modbus_tcp" as const, config: { host: "meter" } };
  const { out, error } = await updateConfig(modbus, { profileId: PROFILE_ID });
  assert(!out.ok, "refused");
  assert(error.includes(MODBUS_DRAFT_PROFILE_NEEDS_UNIT_ID_MESSAGE), `the unit-id sentence, got ${error}`);
  assert(!error.includes(PROFILE_ID), `no value, got ${error}`);
}
