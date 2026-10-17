import type { AiAssistantSettingsDto, AiAssistantTestStatus } from "@bms/shared";

import {
  buildPutBody,
  buildTestBody,
  defaultModelPlaceholder,
  effectiveModel,
  keyFieldEnabled,
  keySetLine,
  platformSummaryLine,
  providerLabel,
  saveAction,
  testAvailable,
  testResultLines,
  testStatusSentence,
  VISION_MODEL_HELP,
} from "./ai-assistant-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}: expected ${e}, got ${a}`);
  }
}

const PLATFORM_OPENAI: AiAssistantSettingsDto["platform"] = {
  provider: "openai",
  model: "gpt-4o-mini",
  visionModel: null,
  keySet: true,
};

/**
 * `F3.21` (ADR 0090 Amendment 1 A6) — the model field's placeholder is the
 * provider's default model, and OpenRouter says it has none.
 */
export function defaultModelPlaceholderPerProvider(): void {
  assertEqual(defaultModelPlaceholder("openai"), "gpt-4o-mini", "openai default");
  assertEqual(defaultModelPlaceholder("anthropic"), "claude-sonnet-5-5", "anthropic default");
  assertEqual(defaultModelPlaceholder("openrouter"), "required — no default", "openrouter has none");
  assertEqual(defaultModelPlaceholder("off"), "", "off takes no model");
  assertEqual(defaultModelPlaceholder("platform"), "", "the platform default takes no model");
  // The default stands in for an empty field; a typed model wins, trimmed.
  assertEqual(effectiveModel("openai", "  "), "gpt-4o-mini", "empty openai model uses the default");
  assertEqual(effectiveModel("anthropic", ""), "claude-sonnet-5-5", "empty anthropic model uses the default");
  assertEqual(effectiveModel("openrouter", ""), null, "empty openrouter model has no default");
  assertEqual(effectiveModel("openrouter", " z-ai/glm "), "z-ai/glm", "a typed model is trimmed");
}

/** The key line names the last four characters and the date, never more. */
export function keySetLineShowsLast4AndDate(): void {
  assertEqual(
    keySetLine({ keySet: true, keyLast4: "abcd", updatedAt: "2026-10-03T08:15:00.000Z" }),
    "Key set, ends in …abcd, saved 2026-10-03",
    "a stored key",
  );
  assertEqual(
    keySetLine({ keySet: true, keyLast4: "abcd", updatedAt: null }),
    "Key set, ends in …abcd",
    "no date known",
  );
  assertEqual(keySetLine({ keySet: true, keyLast4: null, updatedAt: null }), "Key set", "no last four");
  assertEqual(
    keySetLine({ keySet: false, keyLast4: null, updatedAt: "2026-10-03T08:15:00.000Z" }),
    "No key set",
    "no key",
  );
}

/** Platform default removes the organization row; every other choice writes one. */
export function platformChoiceSavesAsDelete(): void {
  assertEqual(saveAction("platform"), "delete", "platform default is a DELETE");
  for (const choice of ["off", "openai", "openrouter", "anthropic"] as const) {
    assertEqual(saveAction(choice), "put", `${choice} is a PUT`);
  }
}

/** One plain sentence per test status, each distinct and naming no key. */
export function testStatusSentences(): void {
  const statuses: AiAssistantTestStatus[] = [
    "ok",
    "invalid_key",
    "unknown_model",
    "no_tool_support",
    "rate_limited",
    "unreachable",
    "provider_error",
    "no_image_support",
  ];
  const sentences = statuses.map((status) => testStatusSentence(status));
  assertEqual(new Set(sentences).size, 8, "eight distinct sentences");
  for (const sentence of sentences) {
    assert(/^[A-Z].*\.$/.test(sentence), `a plain sentence: ${sentence}`);
    assert(!sentence.includes("_"), `no status code in the sentence: ${sentence}`);
  }
  assertEqual(
    testStatusSentence("ok"),
    "The connection works: the provider answered and can call tools.",
    "ok",
  );
  assertEqual(
    testStatusSentence("invalid_key"),
    "The provider refused the key. Check the key and try again.",
    "invalid_key",
  );
  assert(testStatusSentence("unknown_model").includes("model"), "unknown_model names the model");
  assert(testStatusSentence("no_tool_support").includes("tools"), "no_tool_support names tools");
}

/** The PUT body: Off carries nothing else, a blank key is omitted, OpenRouter needs a model. */
export function putBodyRules(): void {
  assertEqual(buildPutBody("off", "gpt-4o", "sk-typed-key"), { ok: true, body: { provider: "off" } }, "off");
  assertEqual(
    buildPutBody("openai", "", "  "),
    { ok: true, body: { provider: "openai", model: "gpt-4o-mini" } },
    "a blank key is omitted and the default model sent",
  );
  assertEqual(
    buildPutBody("anthropic", "claude-x", " sk-ant-12345678 "),
    { ok: true, body: { provider: "anthropic", model: "claude-x", apiKey: "sk-ant-12345678" } },
    "a typed key is sent trimmed",
  );
  const refused = buildPutBody("openrouter", "", "");
  assert(!refused.ok, "openrouter without a model is refused before any request");
}

/** The Test body: the platform default as it is, or the chosen provider and model. */
export function testBodyRules(): void {
  assertEqual(
    buildTestBody("platform", PLATFORM_OPENAI, "ignored", "sk-ignored"),
    { ok: true, body: { provider: "openai", model: "gpt-4o-mini" } },
    "the platform default is tested exactly as configured, with no typed key",
  );
  assert(
    !buildTestBody("platform", { provider: "openai", model: null, visionModel: null, keySet: false }, "", "").ok,
    "a platform default without a model cannot be tested",
  );
  assert(!buildTestBody("platform", { ...PLATFORM_OPENAI, provider: "off" }, "", "").ok, "an off platform");
  assert(!buildTestBody("off", PLATFORM_OPENAI, "", "").ok, "off has nothing to test");
  assert(!buildTestBody("openrouter", PLATFORM_OPENAI, "", "").ok, "openrouter needs a model");
  assertEqual(
    buildTestBody("openrouter", PLATFORM_OPENAI, "z-ai/glm", "sk-or-12345678"),
    { ok: true, body: { provider: "openrouter", model: "z-ai/glm", apiKey: "sk-or-12345678" } },
    "a typed key is sent",
  );
  assertEqual(
    buildTestBody("openai", PLATFORM_OPENAI, "", ""),
    { ok: true, body: { provider: "openai", model: "gpt-4o-mini" } },
    "no typed key: the stored key is used server-side",
  );
}

/** Which controls a choice enables, and how the platform default reads. */
export function choiceControlsAndLabels(): void {
  assert(keyFieldEnabled("openai"), "a provider takes a key");
  assert(!keyFieldEnabled("off"), "off takes no key (ruling 14)");
  assert(!keyFieldEnabled("platform"), "the platform default stores no key");
  assert(testAvailable("openai", "off"), "a provider can be tested");
  assert(!testAvailable("off", "openai"), "off cannot be tested");
  assert(testAvailable("platform", "anthropic"), "a platform provider can be tested");
  assert(!testAvailable("platform", "off"), "an off platform cannot be tested");
  assertEqual(providerLabel("openrouter"), "OpenRouter", "label");
  assertEqual(
    platformSummaryLine(PLATFORM_OPENAI),
    "The platform default is OpenAI, model gpt-4o-mini, key set.",
    "platform summary",
  );
  assertEqual(
    platformSummaryLine({ provider: "anthropic", model: null, visionModel: null, keySet: false }),
    "The platform default is Anthropic, model not set, no key set.",
    "an incomplete platform",
  );
  assertEqual(
    platformSummaryLine({ provider: "off", model: null, visionModel: null, keySet: false }),
    "The platform default is Off: the guided mode answers.",
    "an off platform",
  );
}

/**
 * `F4.267` (ADR 0090 Amendment 3 C5) — the PUT body carries a typed vision
 * model, trimmed; an empty field omits it (the server then stores none), and
 * Off never carries one (D1: the server refuses Off with a vision model).
 */
export function putBodyCarriesTheVisionModel(): void {
  assertEqual(
    buildPutBody("openrouter", "z-ai/glm", "", " qwen/qwen3-vl "),
    { ok: true, body: { provider: "openrouter", model: "z-ai/glm", visionModel: "qwen/qwen3-vl" } },
    "a typed vision model is sent trimmed",
  );
  assertEqual(
    buildPutBody("openrouter", "z-ai/glm", "", "   "),
    { ok: true, body: { provider: "openrouter", model: "z-ai/glm" } },
    "an empty vision model field is omitted",
  );
  assertEqual(
    buildPutBody("off", "", "", "qwen/qwen3-vl"),
    { ok: true, body: { provider: "off" } },
    "off carries no vision model",
  );
}

/**
 * The Test body carries the typed vision model for a provider, and the
 * platform default's own vision model when it has one.
 */
export function testBodyCarriesTheVisionModel(): void {
  assertEqual(
    buildTestBody("openrouter", PLATFORM_OPENAI, "z-ai/glm", "", " qwen/qwen3-vl "),
    { ok: true, body: { provider: "openrouter", model: "z-ai/glm", visionModel: "qwen/qwen3-vl" } },
    "a typed vision model is tested",
  );
  assertEqual(
    buildTestBody("openrouter", PLATFORM_OPENAI, "z-ai/glm", "", ""),
    { ok: true, body: { provider: "openrouter", model: "z-ai/glm" } },
    "an empty vision model field is omitted",
  );
  assertEqual(
    buildTestBody("platform", { ...PLATFORM_OPENAI, visionModel: "gpt-4o" }, "", "", "typed-ignored"),
    { ok: true, body: { provider: "openai", model: "gpt-4o-mini", visionModel: "gpt-4o" } },
    "the platform default's vision model is tested as configured, never a typed one",
  );
  assertEqual(
    buildTestBody("platform", PLATFORM_OPENAI, "", "", "typed-ignored"),
    { ok: true, body: { provider: "openai", model: "gpt-4o-mini" } },
    "a platform default with no vision model sends none",
  );
}

/** The platform summary names the model for images when the platform has one. */
export function platformSummaryNamesTheVisionModel(): void {
  assertEqual(
    platformSummaryLine({ ...PLATFORM_OPENAI, visionModel: "gpt-4o" }),
    "The platform default is OpenAI, model gpt-4o-mini, model for images gpt-4o, key set.",
    "a platform vision model",
  );
}

/** One line for a test without a vision model; a second line when the result carries one. */
export function testResultLinesOneOrTwo(): void {
  assertEqual(
    testResultLines({ status: "ok" }),
    ["Model: The connection works: the provider answered and can call tools."],
    "one check",
  );
  assertEqual(
    testResultLines({ status: "ok", visionStatus: "no_image_support" }),
    [
      "Model: The connection works: the provider answered and can call tools.",
      "Model for images: This model cannot read an image. Choose a model that supports image input.",
    ],
    "two checks",
  );
}

/** The help line under the field says when the vision model is used and what empty means. */
export function visionModelHelpText(): void {
  assertEqual(
    VISION_MODEL_HELP,
    "Used only for a copilot turn that carries an image. Empty sends those turns to the model above.",
    "help line",
  );
}
