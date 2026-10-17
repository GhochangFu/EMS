import { putAiAssistantSettingsBodySchema, testAiAssistantBodySchema } from "./ai-assistant-settings.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertPutIsStrict(): void {
  const base = { provider: "openai", model: "gpt-4o-mini" };
  assert(putAiAssistantSettingsBodySchema.safeParse(base).success, "positive control: a plain body parses");
  for (const extra of [{ keyLast4: "abcd" }, { source: "organization" }, { platform: {} }]) {
    assert(!putAiAssistantSettingsBodySchema.safeParse({ ...base, ...extra }).success, `${Object.keys(extra)[0]} is refused`);
  }
}

export function assertPutRequiresAModelUnlessOff(): void {
  assert(!putAiAssistantSettingsBodySchema.safeParse({ provider: "anthropic" }).success, "a provider needs a model");
  assert(putAiAssistantSettingsBodySchema.safeParse({ provider: "off" }).success, "off needs none");
}

export function assertPutRefusesAKeyWithOff(): void {
  assert(!putAiAssistantSettingsBodySchema.safeParse({ provider: "off", apiKey: "sk-12345678" }).success, "off with a key is refused");
}

export function assertPutBoundsTheKey(): void {
  const body = (apiKey: string) => ({ provider: "openai", model: "gpt-4o-mini", apiKey });
  assert(!putAiAssistantSettingsBodySchema.safeParse(body("short")).success, "a key under 8 characters is refused");
  assert(!putAiAssistantSettingsBodySchema.safeParse(body("k".repeat(513))).success, "a key over 512 characters is refused");
  assert(putAiAssistantSettingsBodySchema.safeParse(body("k".repeat(512))).success, "512 is the bound");
}

export function assertTestRefusesOff(): void {
  assert(!testAiAssistantBodySchema.safeParse({ provider: "off", model: "x" }).success, "off cannot be tested");
  assert(testAiAssistantBodySchema.safeParse({ provider: "openrouter", model: "z-ai/glm-5.3-flash" }).success, "a provider can");
}

/** ADR 0090 Amendment 3 C4: the vision model is optional, nullable, and bounded like `model`. */
export function assertPutTakesAnOptionalVisionModel(): void {
  const base = { provider: "openrouter", model: "z-ai/glm-5.3-flash" };
  assert(putAiAssistantSettingsBodySchema.safeParse(base).success, "an omitted vision model parses");
  assert(putAiAssistantSettingsBodySchema.safeParse({ ...base, visionModel: null }).success, "null parses");
  const trimmed = putAiAssistantSettingsBodySchema.safeParse({ ...base, visionModel: "  google/gemini-3-flash  " });
  assert(trimmed.success && trimmed.data.visionModel === "google/gemini-3-flash", "a vision model parses trimmed");
  assert(!putAiAssistantSettingsBodySchema.safeParse({ ...base, visionModel: "" }).success, "an empty vision model is refused");
  assert(!putAiAssistantSettingsBodySchema.safeParse({ ...base, visionModel: "m".repeat(201) }).success, "201 characters are refused");
  assert(putAiAssistantSettingsBodySchema.safeParse({ ...base, visionModel: "m".repeat(200) }).success, "200 is the bound");
}

/** Plan D1: an off setting stores no vision model; null is the absence of one. */
export function assertPutRefusesAVisionModelWithOff(): void {
  const refused = putAiAssistantSettingsBodySchema.safeParse({ provider: "off", visionModel: "google/gemini-3-flash" });
  assert(!refused.success, "off with a vision model is refused");
  assert(
    !refused.success && refused.error.issues.some((issue) => issue.path.join(".") === "visionModel"),
    "the issue is at visionModel",
  );
  assert(putAiAssistantSettingsBodySchema.safeParse({ provider: "off", visionModel: null }).success, "off with null parses");
}

export function assertTestTakesAnOptionalVisionModel(): void {
  const base = { provider: "openrouter", model: "z-ai/glm-5.3-flash" };
  assert(testAiAssistantBodySchema.safeParse({ ...base, visionModel: "google/gemini-3-flash" }).success, "a vision model parses");
  assert(!testAiAssistantBodySchema.safeParse({ ...base, visionModel: null }).success, "null is not a model to test");
  assert(!testAiAssistantBodySchema.safeParse({ ...base, visionModel: "" }).success, "an empty one is refused");
}
