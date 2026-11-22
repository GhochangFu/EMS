import type { OnboardingDraft, OnboardingPhase } from "@bms/shared";

import {
  INGEST_ON_NEEDS_PROFILE,
  PROFILE_NEEDS_MODBUS_RTU,
  PROFILE_NOT_FOUND,
  PROFILES_UNAVAILABLE,
} from "./onboarding-chat-profile";
import type { ChatTurnResult } from "./onboarding-chat-rule-based";
import { ruleBasedChatService } from "./onboarding-chat.service.spec";
import type { DeviceProfileLookup } from "./onboarding-device-profiles";

/**
 * `F1.2` plan PR 11 (ADR 0141 Amendment 1 (f), decision 23) — the guided chat names a device
 * profile (`profile: <code>`) on the draft's last Modbus TCP RTU and may switch ingest on at
 * commit for it (`ingest on`). Driven through the real `handleTurn` in its rule-based branch.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const PROFILE_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const PLACE = { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", type: "smoc_campus", latitude: 22.3, longitude: 87.3 };
const MODBUS = {
  code: "RTU-1",
  displayName: "RTU-1",
  protocol: "modbus_tcp" as const,
  config: { host: "192.168.1.20", port: 502, pollIntervalMs: 10000, device: { unitId: 1 } },
  credentialsSet: false,
  ingestEnabled: false,
};
const MQTT = {
  code: "RTU-2",
  displayName: "RTU-2",
  protocol: "mqtt" as const,
  config: { host: "broker", port: 8883, tls: true, topic: "a/b" },
  credentialsSet: false,
  ingestEnabled: true,
  rtuCode: "RTU-2",
};

/** Holds one profile, `pm5110` version 3, and records each code it was asked for. */
function lookup(asked: string[] = []): DeviceProfileLookup {
  return async (code) => {
    asked.push(code);
    return code === "pm5110" ? { id: PROFILE_ID, code: "pm5110", version: 3 } : null;
  };
}

async function turn(
  message: string,
  draft: OnboardingDraft,
  deviceProfiles: DeviceProfileLookup | null = lookup(),
  phase: OnboardingPhase = "point_keys",
): Promise<ChatTurnResult> {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await ruleBasedChatService().handleTurn(message, draft, phase, "Ion Exchange", "org-1", {
      sessionId: "s-1",
      history: [],
      pointKeyQuota: { createdByOrganization: 0 },
      deviceProfiles: deviceProfiles ?? undefined,
    });
  } finally {
    if (saved !== undefined) {
      process.env.OPENAI_API_KEY = saved;
    }
  }
}

const config = (result: ChatTurnResult, index: number) =>
  (result.draftPatch.rtus?.[index]?.config ?? {}) as Record<string, unknown>;

/** CP1 — `profile: <code>` writes the newest version's id on the last Modbus RTU and offers `ingest on`. */
export async function assertAProfileTurnNamesTheProfileOnTheModbusRtu(): Promise<void> {
  const asked: string[] = [];
  const result = await turn("profile: pm5110", { location: PLACE, rtus: [MODBUS, MQTT] }, lookup(asked));
  assert(asked.length === 1 && asked[0] === "pm5110", `the typed code was looked up, got ${JSON.stringify(asked)}`);
  assert(config(result, 0).profileId === PROFILE_ID, `profileId on RTU 0, got ${JSON.stringify(result.draftPatch)}`);
  assert(config(result, 0).host === "192.168.1.20", "the rest of the config is kept");
  assert(config(result, 1).profileId === undefined, "the MQTT RTU is untouched");
  assert(
    result.assistantMessage.startsWith(
      "Device profile **pm5110** version 3 set on **'RTU-1'**: its registers are copied at commit. Say **ingest on** to start reading it when the draft is committed.",
    ),
    `got ${result.assistantMessage}`,
  );
  assert(result.suggestedReplies?.[0] === "ingest on", `ingest on is offered, got ${JSON.stringify(result.suggestedReplies)}`);
  assert(result.actionLines.length === 1, `one action line, got ${JSON.stringify(result.actionLines)}`);
}

/** CP2 — an unknown code (or another organization's) changes nothing and repeats no value. */
export async function assertAnUnknownCodeIsRefusedWithoutEcho(): Promise<void> {
  const result = await turn("profile: s3ntinel-code", { location: PLACE, rtus: [MODBUS] });
  assert(result.assistantMessage.startsWith(`I did not change the draft. ${PROFILE_NOT_FOUND}`), `got ${result.assistantMessage}`);
  assert(!result.assistantMessage.includes("s3ntinel"), "the typed code is not repeated");
  assert(result.draftPatch.rtus === undefined, `nothing written, got ${JSON.stringify(result.draftPatch)}`);
}

/** CP3 — with no Modbus RTU, or no lookup, the turn refuses; it never reads the code as a location or a protocol. */
export async function assertAProfileTurnNeedsAModbusRtuAndALookup(): Promise<void> {
  const asked: string[] = [];
  const none = await turn("profile: pm5110", { location: PLACE, rtus: [MQTT] }, lookup(asked));
  assert(none.assistantMessage.startsWith(`I did not change the draft. ${PROFILE_NEEDS_MODBUS_RTU}`), `got ${none.assistantMessage}`);
  assert(asked.length === 0, "nothing is looked up without a Modbus RTU");
  const early = await turn("profile: modbus-meter", {}, lookup(), "location");
  assert(early.draftPatch.location === undefined, `not read as a location name, got ${JSON.stringify(early.draftPatch)}`);
  const blind = await turn("profile: pm5110", { location: PLACE, rtus: [MODBUS] }, null);
  assert(blind.assistantMessage.startsWith(`I did not change the draft. ${PROFILES_UNAVAILABLE}`), `got ${blind.assistantMessage}`);
}

/** CP4 — `ingest on` switches ingest on for the Modbus RTU naming a profile, and refuses without one. */
export async function assertIngestOnNeedsAProfile(): Promise<void> {
  const refused = await turn("ingest on", { location: PLACE, rtus: [MODBUS] });
  assert(refused.assistantMessage.startsWith(`I did not change the draft. ${INGEST_ON_NEEDS_PROFILE}`), `got ${refused.assistantMessage}`);
  assert(refused.draftPatch.rtus === undefined, "nothing written without a profile");
  const bound = { ...MODBUS, config: { ...MODBUS.config, profileId: PROFILE_ID } };
  const result = await turn("Ingest on.", { location: PLACE, rtus: [bound, MQTT] });
  assert(result.draftPatch.rtus?.[0]?.ingestEnabled === true, `ingest on for RTU 0, got ${JSON.stringify(result.draftPatch)}`);
  assert(
    result.assistantMessage.startsWith("Ingest is on for **'RTU-1'**: it is read from the moment the draft is committed."),
    `got ${result.assistantMessage}`,
  );
}

/** CP5 — a profile beside the RTU's own registers is the draft schema's refusal, and nothing is written. */
export async function assertAProfileBesideRegistersIsRefusedBySchema(): Promise<void> {
  const listed = {
    ...MODBUS,
    config: { ...MODBUS.config, device: { unitId: 1, registers: [{ sourceKey: "kw", table: "holding", address: 0, type: "uint16" }] } },
  };
  const result = await turn("profile: pm5110", { location: PLACE, rtus: [listed] });
  assert(result.assistantMessage.startsWith("I did not change the draft. "), `got ${result.assistantMessage}`);
  assert(result.draftPatch.rtus === undefined, `nothing written, got ${JSON.stringify(result.draftPatch)}`);
}
