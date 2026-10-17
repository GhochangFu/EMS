import {
  aiAssistantSettingsDtoSchema,
  aiAssistantTestResultDtoSchema,
  aiAssistantTestStatusSchema,
} from "./ai-assistant";

/**
 * F3.21 (ADR 0090 Amendment 1, A5 and A7) — the AI assistant settings DTO.
 *
 * Assertions live here; `ai-assistant.test.ts` is the vitest entry point
 * (ADR 0014). Everything below is a plain object and needs no connection.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const platform = { provider: "openai", model: "gpt-4o", visionModel: null, keySet: true } as const;

const organizationRow = {
  source: "organization",
  provider: "anthropic",
  model: "claude-sonnet-4",
  visionModel: "claude-sonnet-4-vision",
  keySet: true,
  keyLast4: "a1b2",
  updatedAt: "2026-10-03T08:00:00.000Z",
  platform,
};

export function assertSettingsDtoParsesAnOrganizationRow(): void {
  const result = aiAssistantSettingsDtoSchema.safeParse(organizationRow);
  assert(
    result.success,
    `an organization row must parse: ${result.success ? "" : JSON.stringify(result.error.issues)}`,
  );
}

export function assertSettingsDtoParsesAPlatformDefault(): void {
  const result = aiAssistantSettingsDtoSchema.safeParse({
    ...organizationRow,
    source: "platform",
    provider: "openai",
    model: null,
    keyLast4: null,
    updatedAt: null,
  });
  assert(
    result.success,
    `a platform default (keyLast4 and updatedAt null) must parse: ${result.success ? "" : JSON.stringify(result.error.issues)}`,
  );
}

/** Owner ruling 12 — a leaked key field must fail the parse, not be stripped. */
export function assertSettingsDtoRefusesAKeyField(): void {
  for (const field of ["apiKey", "keyCiphertext"]) {
    const result = aiAssistantSettingsDtoSchema.safeParse({ ...organizationRow, [field]: "sk-secret" });
    assert(!result.success, `a response carrying \`${field}\` must fail the parse`);
    assert(
      !result.success && result.error.issues.some((i) => i.code === "unrecognized_keys"),
      `\`${field}\` must be refused as an unrecognized key: ${JSON.stringify(!result.success && result.error.issues)}`,
    );
  }
  const nested = aiAssistantSettingsDtoSchema.safeParse({
    ...organizationRow,
    platform: { ...platform, apiKey: "sk-secret" },
  });
  assert(!nested.success, "a key field inside `platform` must fail the parse too");
}

/** F4.267 / ADR 0090 Amendment 3 C2 appends `no_image_support` last. */
export function assertTestStatusEnumIsTheSevenPlusOk(): void {
  const expected = [
    "ok",
    "invalid_key",
    "unknown_model",
    "no_tool_support",
    "rate_limited",
    "unreachable",
    "provider_error",
    "no_image_support",
  ];
  assert(
    JSON.stringify([...aiAssistantTestStatusSchema.options]) === JSON.stringify(expected),
    `test status options drifted: ${JSON.stringify(aiAssistantTestStatusSchema.options)}`,
  );
}

/**
 * F4.267 / ADR 0090 Amendment 3 C4 — the settings DTO always names the vision
 * model (null for none), for the organization and for the platform default.
 */
export function assertSettingsDtoRequiresTheVisionModel(): void {
  const { visionModel: _omitted, ...withoutVisionModel } = organizationRow;
  assert(!aiAssistantSettingsDtoSchema.safeParse(withoutVisionModel).success, "a DTO without visionModel must fail the parse");
  const { visionModel: _platformOmitted, ...platformWithout } = platform;
  assert(
    !aiAssistantSettingsDtoSchema.safeParse({ ...organizationRow, platform: platformWithout }).success,
    "a platform without visionModel must fail the parse",
  );
  const named = aiAssistantSettingsDtoSchema.safeParse({ ...organizationRow, platform: { ...platform, visionModel: "qwen/qwen3-vl" } });
  assert(named.success && named.data.platform.visionModel === "qwen/qwen3-vl", "a platform vision model parses and is kept");
}

/** F4.267 / ADR 0090 Amendment 3 C4 — the test result carries an optional second status for the vision model. */
export function assertTestResultCarriesAnOptionalVisionStatus(): void {
  const plain = aiAssistantTestResultDtoSchema.safeParse({ status: "ok" });
  assert(plain.success && plain.data.visionStatus === undefined, "a result without visionStatus parses");
  const both = aiAssistantTestResultDtoSchema.safeParse({ status: "ok", visionStatus: "no_image_support" });
  assert(both.success && both.data.visionStatus === "no_image_support", "a result with visionStatus parses and keeps it");
  assert(!aiAssistantTestResultDtoSchema.safeParse({ status: "ok", visionStatus: "maybe" }).success, "an unknown visionStatus fails");
  const extra = aiAssistantTestResultDtoSchema.safeParse({ status: "ok", detail: "sk-secret" });
  assert(
    !extra.success && extra.error.issues.some((i) => i.code === "unrecognized_keys"),
    "an unknown key in the test result must fail the parse",
  );
}
