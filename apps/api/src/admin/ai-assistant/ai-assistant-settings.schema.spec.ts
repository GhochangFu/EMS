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
