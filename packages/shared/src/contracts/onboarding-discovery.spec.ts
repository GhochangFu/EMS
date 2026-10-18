import { expect } from "vitest";

import {
  MQTT_DISCOVERY_MAX_TOTAL_KEYS,
  MQTT_DISCOVERY_RTU_CODE_MAX,
  MQTT_DISCOVERY_SOURCE_KEY_MAX,
  MQTT_DISCOVERY_TOPIC_MAX,
  discoveryDtoOf,
  onboardingDiscoveryDeviceSchema,
  onboardingDiscoveryResultDtoSchema,
  onboardingDiscoveryStoredSchema,
  startOnboardingDiscoveryBodySchema,
} from "./onboarding-discovery";
import {
  MAX_RTU_TOPIC_CHARS,
  ONBOARDING_DRAFT_STRING_MAX,
  onboardingDraftAssetPointSchema,
  onboardingSessionDtoSchema,
} from "./onboarding";

/**
 * `F3.24b` / ADR 0103 — the discovery contracts. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */

const BODY = { rtuCode: "R1", topicPrefix: "Airsprint-1051/Data" };

const DEVICE = {
  topic: "Airsprint-1051/Data/1051",
  devId: "1051",
  messageCount: 3,
  keys: [{ sourceKey: "flow", sampleValue: 12.5 }],
};

const DTO = {
  discoveryId: "11111111-1111-4111-8111-111111111111",
  rtuCode: "R1",
  topicFilter: "Airsprint-1051/Data/#",
  windowSeconds: 60,
  status: "done",
  startedAt: "2026-10-18T00:00:00.000Z",
  finishedAt: "2026-10-18T00:01:00.000Z",
  truncated: false,
  devices: [DEVICE],
};

const STORED = { ...DTO, queuedAt: "2026-10-18T00:00:00.000Z", messages: 3, skipped: 0 };

const SESSION = {
  id: "s",
  organizationId: "o",
  organizationCode: "ORG",
  organizationName: "Org",
  status: "draft",
  currentPhase: "rtu",
  draft: {},
  messages: [],
  createdAt: "x",
  updatedAt: "x",
  committedAt: null,
  result: null,
  checkpoints: [],
  draftHash: null,
  discovery: null,
};

export function theBodyAcceptsAPrefixAndNoWindow(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse(BODY).success).toBe(true);
}
export function theBodyRefusesAPlusWildcard(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, topicPrefix: "a/+/b" }).success).toBe(false);
}
export function theBodyRefusesAHashWildcard(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, topicPrefix: "a/#" }).success).toBe(false);
}
export function theBodyRefusesASysPrefix(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, topicPrefix: "$SYS/broker" }).success).toBe(false);
}
export function theBodyRefusesAnEmptyPrefix(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, topicPrefix: "" }).success).toBe(false);
}
export function theBodyRefusesA256CharPrefix(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, topicPrefix: "a".repeat(256) }).success).toBe(false);
}
export function theBodyRefusesWindow4(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, windowSeconds: 4 }).success).toBe(false);
}
export function theBodyRefusesWindow121(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, windowSeconds: 121 }).success).toBe(false);
}
export function theBodyAcceptsWindow120(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, windowSeconds: 120 }).success).toBe(true);
}
export function theBodyRefusesAnUnknownKey(): void {
  expect(startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, host: "x" }).success).toBe(false);
}
export function theBodyIssueNeverEchoesTheValue(): void {
  const r = startOnboardingDiscoveryBodySchema.safeParse({ ...BODY, topicPrefix: "secret/+" });
  expect(r.success).toBe(false);
  expect(JSON.stringify(r.success ? "" : r.error.issues)).not.toContain("secret");
}

export function theSessionDtoRefusesAMissingDiscovery(): void {
  const { discovery: _omitted, ...without } = SESSION;
  expect(onboardingSessionDtoSchema.safeParse(without).success).toBe(false);
}
export function theSessionDtoAcceptsANullDiscovery(): void {
  expect(onboardingSessionDtoSchema.safeParse(SESSION).success).toBe(true);
}
export function theSessionDtoAcceptsADiscoveryResult(): void {
  expect(onboardingSessionDtoSchema.safeParse({ ...SESSION, discovery: DTO }).success).toBe(true);
}

export function theResultRefusesA65CharSample(): void {
  const device = { ...DEVICE, keys: [{ sourceKey: "k", sampleValue: "x".repeat(65) }] };
  expect(onboardingDiscoveryResultDtoSchema.safeParse({ ...DTO, devices: [device] }).success).toBe(false);
}
export function theResultRefusesASixthErrorClass(): void {
  expect(onboardingDiscoveryResultDtoSchema.safeParse({ ...DTO, status: "failed", error: "weird" }).success).toBe(false);
}
export function theResultAcceptsAKnownErrorClass(): void {
  expect(
    onboardingDiscoveryResultDtoSchema.safeParse({ ...DTO, status: "failed", error: "blocked host" }).success,
  ).toBe(true);
}
export function theDeviceRefusesA256CharTopic(): void {
  expect(onboardingDiscoveryDeviceSchema.safeParse({ ...DEVICE, topic: "t".repeat(256) }).success).toBe(false);
}
export function theDeviceRefusesA129CharDevId(): void {
  expect(onboardingDiscoveryDeviceSchema.safeParse({ ...DEVICE, devId: "d".repeat(129) }).success).toBe(false);
}
export function theDeviceAccepts255And128(): void {
  const r = onboardingDiscoveryDeviceSchema.safeParse({ ...DEVICE, topic: "t".repeat(255), devId: "d".repeat(128) });
  expect(r.success).toBe(true);
}
export function theTotalKeysCapIs5000(): void {
  expect(MQTT_DISCOVERY_MAX_TOTAL_KEYS).toBe(5_000);
}

export function theStoredSchemaParsesQueuedAtAndCounters(): void {
  expect(onboardingDiscoveryStoredSchema.safeParse(STORED).success).toBe(true);
}
export function theStoredSchemaRequiresQueuedAt(): void {
  const { queuedAt: _q, ...without } = STORED;
  expect(onboardingDiscoveryStoredSchema.safeParse(without).success).toBe(false);
}
export function theDtoRefusesTheStoredOnlyKeys(): void {
  expect(onboardingDiscoveryResultDtoSchema.safeParse(STORED).success).toBe(false);
}
export function theMapperDropsTheStoredOnlyKeys(): void {
  const stored = onboardingDiscoveryStoredSchema.parse(STORED);
  expect(onboardingDiscoveryResultDtoSchema.safeParse(discoveryDtoOf(stored)).success).toBe(true);
  expect(Object.keys(discoveryDtoOf(stored))).not.toContain("queuedAt");
}

export function anAssetPointAcceptsSourceDiscovery(): void {
  const row = { assetIndex: 0, pointKey: "p", sourceDataKey: "k" };
  expect(onboardingDraftAssetPointSchema.safeParse({ ...row, source: "discovery" }).success).toBe(true);
}
export function anAssetPointRefusesSourceManual(): void {
  const row = { assetIndex: 0, pointKey: "p", sourceDataKey: "k" };
  expect(onboardingDraftAssetPointSchema.safeParse({ ...row, source: "manual" }).success).toBe(false);
}

/** The three bounds restated here (to avoid an import cycle) equal the onboarding constants. */
export function theMirroredBoundsEqualTheOnboardingConstants(): void {
  expect(MQTT_DISCOVERY_TOPIC_MAX).toBe(MAX_RTU_TOPIC_CHARS);
  expect(MQTT_DISCOVERY_SOURCE_KEY_MAX).toBe(ONBOARDING_DRAFT_STRING_MAX["assetPoints.sourceDataKey"]);
  expect(MQTT_DISCOVERY_RTU_CODE_MAX).toBe(ONBOARDING_DRAFT_STRING_MAX["rtus.code"]);
}
