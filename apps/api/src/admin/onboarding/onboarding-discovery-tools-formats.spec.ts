import type { OnboardingDiscoveryStored, OnboardingDraft } from "@bms/shared";

import { runTool, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.334` / `F4.335` (ADR 0116 decision 8, plan T4.4) — the copilot's
 * discovery tools: the empty sentence says how many messages arrived and were
 * not decoded, the devices page carries each device's payload format, and
 * `add_rtu` copies a discovered device's format when the call names none.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const TOPIC = "BCPL_LAK_PLANT_03_LAKWA/data";

function context(): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }],
    catalog: { listPointKeys: async () => [], listInUsePointKeys: async () => new Set<string>() },
    protocols: { getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }), formatForAssistant: () => "MQTT" },
    validator: new OnboardingValidateService(),
    templates: EMPTY_TEMPLATE_CONTEXT,
    pointKeyQuota: { createdByOrganization: 0 },
    inventory: { listExisting: async () => ({ rows: [], total: 0 }) },
    placement: { candidates: [] },
  };
}

function stored(overrides: Partial<OnboardingDiscoveryStored> = {}): OnboardingDiscoveryStored {
  return {
    discoveryId: "11111111-1111-4111-8111-111111111111",
    rtuCode: "BCPL-SRC",
    topicFilter: "BCPL_LAK_PLANT_03_LAKWA/#",
    windowSeconds: 60,
    status: "done",
    startedAt: "2026-11-08T00:00:00.000Z",
    finishedAt: "2026-11-08T00:01:00.000Z",
    truncated: false,
    devices: [
      {
        topic: TOPIC,
        devId: "BCPL_LAKWA_02",
        messageCount: 6,
        payloadFormat: "thinkiot-register-array",
        keys: [{ sourceKey: "treated_water_flow_klh", sampleValue: 1.2999999523162842 }],
      },
    ],
    queuedAt: "2026-11-08T00:00:00.000Z",
    messages: 6,
    skipped: 0,
    ...overrides,
  };
}

function draft(discovery: OnboardingDiscoveryStored): OnboardingDraft {
  return {
    location: { name: "Lakwa", slug: "lakwa", code: "LAKWA", latitude: 27, longitude: 94.8, type: "smoc_campus" },
    rtus: [
      {
        code: "BCPL-SRC",
        displayName: "BCPL source",
        protocol: "mqtt",
        credentialsSet: false,
        ingestEnabled: false,
        config: { host: "broker.example.com", port: 1883, tls: true, topic: "BCPL_LAK_PLANT_03_LAKWA" },
      },
    ],
    _discovery: discovery,
  } as unknown as OnboardingDraft;
}

const call = (name: string, args: unknown) => ({ id: "c1", name, arguments: JSON.stringify(args) });

/** T1 — `skipped: 6`, every one `no-format`, no device: the sentence names the count and echoes nothing. */
export async function theEmptyResultSaysHowManyArrived(): Promise<void> {
  const discovery = stored({ devices: [], messages: 0, skipped: 6, skippedReasons: { "no-format": 6 } });
  const outcome = await runTool(call("get_discovery_results", {}), { working: draft(discovery) }, context());
  const body = JSON.parse(outcome.content) as { empty?: string };
  assert(
    body.empty === "6 messages arrived but none matched a known payload format. Say so to the user.",
    `the F4.335 sentence, got ${outcome.content}`,
  );
  const plain = await runTool(call("get_discovery_results", {}), { working: draft(stored({ devices: [], messages: 0, skipped: 0 })) }, context());
  // F4.339: nothing arrived → the sentence names the chosen filter and window.
  assert(
    plain.content.includes("No message arrived on topic 'BCPL_LAK_PLANT_03_LAKWA/#' in 60 s — check the topic name and the window."),
    `nothing arrived: the topic sentence, got ${plain.content}`,
  );
}

/** T2 — the devices page carries each device's payload format. */
export async function theDevicesPageCarriesTheFormat(): Promise<void> {
  const outcome = await runTool(call("get_discovery_results", {}), { working: draft(stored()) }, context());
  const body = JSON.parse(outcome.content) as { devices?: { devId: string; payloadFormat?: string }[] };
  assert(
    body.devices?.[0]?.payloadFormat === "thinkiot-register-array",
    `the device row names its format, got ${outcome.content}`,
  );
}

/** T3 — `add_rtu` for the discovered device (on a later turn) copies its format; a stated format wins. */
export async function addRtuCopiesTheDiscoveredFormat(): Promise<void> {
  const rtu = (config: Record<string, unknown>) => ({
    code: "BCPL_LAKWA_02",
    displayName: "LAKWA 02",
    protocol: "mqtt",
    ingestEnabled: false,
    config: { host: "broker.example.com", port: 1883, tls: true, topic: TOPIC, ...config },
  });
  // A later turn (no read in this one, so the H2 write scope does not apply).
  const read: ToolState = { working: draft(stored()) };
  const copied = await runTool(call("add_rtu", rtu({})), read, context());
  assert(copied.ok, `add_rtu runs, got ${copied.error ?? ""}`);
  assert(
    copied.actionLine?.includes("(payload format thinkiot-register-array)") === true,
    `the action line names the copied format, got ${copied.actionLine ?? ""}`,
  );
  const added = read.working.rtus?.find((r) => r.code === "BCPL_LAKWA_02");
  assert(
    (added?.config as { payloadFormat?: unknown } | undefined)?.payloadFormat === "thinkiot-register-array",
    `the discovered format is copied, got ${JSON.stringify(added)}`,
  );

  const stated: ToolState = { working: draft(stored()) };
  await runTool(call("add_rtu", rtu({ payloadFormat: "thinkiot-envelope" })), stated, context());
  const kept = stated.working.rtus?.find((r) => r.code === "BCPL_LAKWA_02");
  assert(
    (kept?.config as { payloadFormat?: unknown } | undefined)?.payloadFormat === "thinkiot-envelope",
    `a stated format wins, got ${JSON.stringify(kept)}`,
  );
}
